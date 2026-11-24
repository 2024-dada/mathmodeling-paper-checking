"""重复率检测。

三个指标（都以"被测论文的词/字数"为分母）：
  - 文字复制比 exact_rate     : 与比对库中任一篇连续 n 个词（中文 n 个字）完全相同的部分
  - 改写相似比 paraphrase_rate: 不是逐字相同、但与比对库某句高度相似的句子（换词、调语序）；
                               相似度 = max(字符序列相似度, 实词 Jaccard)，默认阈值 0.6
  - 总重复率   total_rate     : 两者的并集
另外单列：
  - 赛题引用比 excluded_rate  : 与 --exclude 指定的赛题原文相同的部分，不计入重复率
"""
import re
from collections import defaultdict
from dataclasses import dataclass, field
from difflib import SequenceMatcher

import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

from .extract import Document, tokenize


def _is_cjk(text):
    return sum('一' <= c <= '鿿' for c in text) > 0.3 * max(1, len(text))


def auto_n(doc: Document):
    return 13 if _is_cjk(doc.text) else 8


_STOP = set("the a an of and or to in on at for is are was were be by with as that this it its while when "
             "we our from than then into which these those can".split())


def content_words(sent):
    if _is_cjk(sent):     # 中文用字二元组
        cs = re.sub(r"[^\u4e00-\u9fff]", "", sent)
        return {cs[i:i + 2] for i in range(len(cs) - 1)}
    return {w for w in re.findall(r"[a-z]+|\d+(?:\.\d+)?", sent.lower()) if w not in _STOP}


def sentence_similarity(a, b):
    """改写相似度 = max(字符序列相似度, 实词 Jaccard)。换词用前者，调语序用后者。"""
    A, B = content_words(a), content_words(b)
    jac = len(A & B) / max(1, len(A | B))
    return max(SequenceMatcher(None, a.lower(), b.lower()).ratio(), jac), min(len(A), len(B))


def shingle_index(tokens, n):
    """{shingle: [起始 token 下标...]}"""
    idx = defaultdict(list)
    words = [t[0] for t in tokens]
    for i in range(len(words) - n + 1):
        idx[" ".join(words[i:i + n])].append(i)
    return idx


@dataclass
class DupResult:
    name: str
    n_tokens: int
    exact_rate: float
    paraphrase_rate: float
    total_rate: float
    excluded_rate: float
    by_source: dict                       # {来源: 该来源贡献的总重复率}
    spans: list = field(default_factory=list)   # [(start, end, kind, source)] kind ∈ exact/paraphrase/excluded
    pairs: list = field(default_factory=list)   # 改写句证据 [(相似度, 本文句, 来源, 来源句)]

    def to_dict(self):
        d = self.__dict__.copy()
        d["pairs"] = [list(p) for p in self.pairs]
        return d


def _sentence_spans(doc: Document):
    spans, pos = [], 0
    for s in doc.sentences:
        i = doc.text.find(s, pos)
        if i < 0:
            i = doc.text.find(s)
        if i >= 0:
            spans.append((i, i + len(s), s))
            pos = i + len(s)
    return spans


def check(target: Document, sources: list, exclude: list = (), n: int = None,
          para_threshold: float = 0.6, embed_fn=None, embed_threshold: float = 0.92) -> DupResult:
    n = n or auto_n(target)
    toks = tokenize(target.text)
    T = len(toks)
    words = [t[0] for t in toks]

    # 1) 赛题等排除内容
    excl = set()
    for e in exclude:
        excl |= set(shingle_index(tokenize(e.text), n))
    excluded = np.zeros(T, bool)
    for i in range(T - n + 1):
        if " ".join(words[i:i + n]) in excl:
            excluded[i:i + n] = True

    # 2) 逐字重复
    exact = {s.name: np.zeros(T, bool) for s in sources}
    for src in sources:
        sidx = shingle_index(tokenize(src.text), n)
        for i in range(T - n + 1):
            if " ".join(words[i:i + n]) in sidx:
                exact[src.name][i:i + n] = True
        exact[src.name] &= ~excluded
    exact_any = np.zeros(T, bool)
    for v in exact.values():
        exact_any |= v

    # 3) 改写相似句
    para = {s.name: np.zeros(T, bool) for s in sources}
    pairs = []
    tspans = _sentence_spans(target)
    tok_starts = np.array([t[1] for t in toks]) if toks else np.array([])
    src_sents = [(s.name, x) for s in sources for x in s.sentences]
    if tspans and src_sents:
        tsent = [x[2] for x in tspans]
        ssent = [x[1] for x in src_sents]
        vec = TfidfVectorizer(analyzer="char_wb", ngram_range=(3, 3), sublinear_tf=True).fit(tsent + ssent)
        S = cosine_similarity(vec.transform(tsent), vec.transform(ssent))
        E = None
        if embed_fn is not None:
            ea, eb = embed_fn(tsent), embed_fn(ssent)
            E = cosine_similarity(ea, eb)
        for k, (a, b, sent) in enumerate(tspans):
            lo, hi = np.searchsorted(tok_starts, a), np.searchsorted(tok_starts, b)
            if hi <= lo:
                continue
            if exact_any[lo:hi].mean() > 0.6 or excluded[lo:hi].mean() > 0.6:
                continue          # 已算作逐字重复/赛题引用
            hit, ratio = False, 0.0
            for j in np.argsort(-S[k])[:3]:        # 粗筛取前 3 个候选精算
                if S[k, j] < 0.45:
                    break
                r, nwords = sentence_similarity(sent, ssent[j])
                if nwords >= 5 and r >= para_threshold and r > ratio:
                    hit, ratio, best = True, r, int(j)
            if hit:
                j = best
            if not hit and E is not None:
                j2 = int(E[k].argmax())
                if E[k, j2] >= embed_threshold:
                    j, ratio, hit = j2, float(E[k, j2]), True
            if hit:
                src_name = src_sents[j][0]
                para[src_name][lo:hi] = True
                pairs.append((round(float(ratio), 3), sent, src_name, ssent[j]))
    para_any = np.zeros(T, bool)
    for v in para.values():
        para_any |= v
    para_only = para_any & ~exact_any & ~excluded

    total = exact_any | para_only
    by_source = {s.name: float(((exact[s.name] | para[s.name]) & ~excluded).sum() / max(1, T)) for s in sources}

    # 4) 高亮区间（连续 token 合并）
    def runs(mask, kind, src=""):
        out, i = [], 0
        while i < T:
            if mask[i]:
                j = i
                while j + 1 < T and mask[j + 1]:
                    j += 1
                out.append((toks[i][1], toks[j][2], kind, src))
                i = j + 1
            else:
                i += 1
        return out

    spans = runs(excluded, "excluded")
    for s in sources:
        spans += runs(exact[s.name], "exact", s.name)
    spans += runs(para_only, "paraphrase")
    spans.sort()

    pairs.sort(reverse=True)
    return DupResult(
        name=target.name, n_tokens=T,
        exact_rate=float(exact_any.sum() / max(1, T)),
        paraphrase_rate=float(para_only.sum() / max(1, T)),
        total_rate=float(total.sum() / max(1, T)),
        excluded_rate=float(excluded.sum() / max(1, T)),
        by_source=dict(sorted(by_source.items(), key=lambda x: -x[1])),
        spans=spans, pairs=pairs)


def check_all(docs: list, corpus: list = (), exclude: list = (), **kw):
    """每篇 docs 都与（其余 docs + corpus）比对。"""
    res = []
    for d in docs:
        others = [x for x in docs if x is not d] + list(corpus)
        res.append(check(d, others, exclude, **kw))
    return res
