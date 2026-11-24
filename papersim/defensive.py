"""防御性语言率检测。

定义
  防御性句：主动为结论设限、免责、划界的句子。按词典分 5 类（见 lexicon.json），
            每条正则有权重；一句话在某类的得分 = 命中的不同正则权重之和（每类上限 1），
            各类相加 >= 阈值（默认 1.0）即记为防御性句。强类（免责/对照/局限）一次命中即计入；
            弱类（范围限定/模糊限定）单条 0.5，需两处弱信号同时出现（"illustrative" 等强限定词例外）。
  防御性语言率 = 防御性句数 / 总句数
  防御强度     = 所有句子得分之和 / 千词
  另分别给出摘要区和正文区的防御率（摘要里大量免责是很强的信号）。

可选 --llm：把每句交给大模型复核，输出 LLM 版防御率，与词典版并列。
"""
import json
import re
from dataclasses import dataclass, field
from pathlib import Path

from .extract import Document

DEFAULT_LEXICON = Path(__file__).with_name("lexicon.json")


def load_lexicon(path=None):
    lex = json.loads(Path(path or DEFAULT_LEXICON).read_text(encoding="utf-8"))
    for c in lex["categories"].values():
        c["_re"] = []
        for p in c["patterns"]:
            rx, w = (p[0], float(p[1])) if isinstance(p, list) else (p, float(c["weight"]))
            c["_re"].append((re.compile(rx, re.I), w))
    return lex


@dataclass
class SentenceHit:
    index: int
    text: str
    score: float
    categories: list
    matches: list          # [(start, end, category)]


@dataclass
class DefResult:
    name: str
    n_sentences: int
    n_words: int
    rate: float
    intensity: float
    summary_rate: float
    body_rate: float
    by_category: dict                  # {类别: 命中该类的句子占比}
    hits: list = field(default_factory=list)
    llm_rate: float = None
    llm_hits: list = field(default_factory=list)

    def to_dict(self):
        d = self.__dict__.copy()
        d["hits"] = [h.__dict__ for h in self.hits]
        return d


def score_sentence(sent, lex):
    cats, matches, score = [], [], 0.0
    for key, c in lex["categories"].items():
        cat_score = 0.0
        for rx, w in c["_re"]:
            hit = False
            for m in rx.finditer(sent):
                matches.append((m.start(), m.end(), key))
                hit = True
            if hit:
                cat_score += w
        if cat_score:
            cats.append(key)
            score += min(cat_score, c.get("cap", 1.0))
    return score, cats, sorted(matches)


def analyze(doc: Document, lex=None) -> DefResult:
    lex = lex or load_lexicon()
    thr = lex.get("threshold", 1.0)
    hits, total_score = [], 0.0
    cat_count = {k: 0 for k in lex["categories"]}
    flags = []
    for i, s in enumerate(doc.sentences):
        sc, cats, ms = score_sentence(s, lex)
        total_score += sc
        for c in cats:
            cat_count[c] += 1
        is_def = sc >= thr
        flags.append(is_def)
        if is_def:
            hits.append(SentenceHit(i, s, sc, cats, ms))
    n = max(1, len(doc.sentences))
    cut = doc.summary_cutoff
    summ, body = flags[:cut], flags[cut:]
    return DefResult(
        name=doc.name, n_sentences=len(doc.sentences), n_words=doc.n_words,
        rate=sum(flags) / n,
        intensity=total_score / max(1, doc.n_words) * 1000,
        summary_rate=(sum(summ) / len(summ)) if summ else float("nan"),
        body_rate=(sum(body) / len(body)) if body else float("nan"),
        by_category={k: v / n for k, v in cat_count.items()},
        hits=hits)


LLM_PROMPT = """下面是一篇论文的若干句子（带编号）。判断每句是否属于"防御性语言"：
即作者主动为结论设限、免责或划清边界，例如声明"这不是预测/估计"、"结果仅在某假设下成立"、
"无法识别/数据不可得"、"应理解为 X 而非 Y"。普通的方法描述、结果陈述不算。
输出 JSON：{"items":[{"i":编号,"defensive":true/false,"category":"disclaimer|contrast|limitation|scope|hedge|none"}]}
句子：
%s"""


def llm_review(doc: Document, res: DefResult, client, batch=40):
    flags = []
    for b in range(0, len(doc.sentences), batch):
        chunk = doc.sentences[b:b + batch]
        listing = "\n".join(f"[{b + k}] {s}" for k, s in enumerate(chunk))
        out = client.chat_json(LLM_PROMPT % listing)
        got = {int(x["i"]): x for x in out.get("items", [])}
        for k in range(len(chunk)):
            x = got.get(b + k, {"defensive": False, "category": "none"})
            flags.append(bool(x.get("defensive")))
            if x.get("defensive"):
                res.llm_hits.append({"index": b + k, "text": chunk[k], "category": x.get("category")})
    res.llm_rate = sum(flags) / max(1, len(flags))
    return res
