"""文本抽取、清洗、分句、分词。中英文通用，无需 jieba。"""
import re
import subprocess
from dataclasses import dataclass, field
from pathlib import Path

HEADER_PAT = re.compile(
    r"(Team\s*(#|Control)|Page\s+\d+(\s+of\s+\d+)?|Problem Chosen|Summary Sheet|^\s*\d+\s*$|第\s*\d+\s*页)", re.I)
TOC_PAT = re.compile(r"(\.{4,}|(\s\.){4,}|…{2,})")
REF_PAT = re.compile(r"\n\s*(References|Bibliography|参考文献)\s*\n", re.I)
SUMMARY_END = re.compile(r"\n\s*(Keywords?|关键词)\s*[:：]?", re.I)
TOKEN_PAT = re.compile(r"[一-鿿]|[A-Za-z]+(?:['’][A-Za-z]+)?|\d+(?:\.\d+)?")
SENT_SPLIT = re.compile(r"(?<=[\.\!\?;])\s+(?=[A-Z\(\"“])|(?<=[。！？；])")


def read_raw(path) -> str:
    path = Path(path)
    if path.suffix.lower() == ".pdf":
        try:
            return subprocess.run(["pdftotext", "-layout", str(path), "-"],
                                  capture_output=True, text=True, check=True).stdout
        except (FileNotFoundError, subprocess.CalledProcessError):
            from pypdf import PdfReader
            return "\n".join((p.extract_text() or "") for p in PdfReader(str(path)).pages)
    return path.read_text(encoding="utf-8", errors="ignore")


def clean(raw: str, drop_references: bool = True) -> str:
    out = []
    for ln in raw.splitlines():
        s = ln.strip()
        if not s or HEADER_PAT.search(s) or TOC_PAT.search(s):
            continue
        letters = sum(c.isalpha() for c in s)
        if letters < 0.45 * len(s):          # 公式、表格残行
            continue
        out.append(re.sub(r"\s{2,}", " ", s))
    txt = "\n".join(out)
    if drop_references:
        m = REF_PAT.search(txt)
        if m:
            txt = txt[:m.start()]
    txt = re.sub(r"(\w)-\n(\w)", r"\1\2", txt)
    return txt


def _is_heading(line: str) -> bool:
    """标题行：短、无句末标点，且有编号 / 图表题前缀 / 英文标题式大写 / 中文短行。"""
    s = line.strip()
    toks = TOKEN_PAT.findall(s)
    if not (0 < len(toks) <= 12) or re.search(r"[\.。:：;；,，\?？!！)）]$", s):
        return False
    if re.match(r"^(\d+(\.\d+)*\.?\s+\S|[一二三四五六七八九十]+、|(Table|Figure|Fig\.|表|图)\s*\d)", s):
        return True
    words = [w for w in re.findall(r"[A-Za-z][\w’'-]*", s)]
    if words:
        minor = {"and", "of", "the", "a", "an", "for", "in", "on", "to", "by", "with", "vs", "or", "from", "at"}
        caps = sum(w[0].isupper() for w in words if w.lower() not in minor)
        content = sum(1 for w in words if w.lower() not in minor)
        return content > 0 and caps / content >= 0.6 and s[0].isupper()
    return len(toks) <= 15 and bool(re.match(r"^[\u4e00-\u9fff]", s))


def split_sentences(text: str):
    """先按标题行/图表题切块（避免标题粘进句子），再在块内按句末标点切句。"""
    blocks, cur = [], []
    for ln in text.splitlines():
        if _is_heading(ln):
            if cur:
                blocks.append(" ".join(cur)); cur = []
        else:
            cur.append(ln.strip())
    if cur:
        blocks.append(" ".join(cur))
    out = []
    for b in blocks:
        flat = re.sub(r"\s+", " ", b)
        out += [s.strip() for s in SENT_SPLIT.split(flat) if len(TOKEN_PAT.findall(s)) >= 4]
    return out


def tokenize(text: str):
    """返回 [(token, start, end)]；中文按字，英文按词，数字整体。"""
    return [(m.group().lower(), m.start(), m.end()) for m in TOKEN_PAT.finditer(text)]


@dataclass
class Document:
    name: str
    text: str
    sentences: list = field(default_factory=list)
    summary_cutoff: int = 0   # 摘要结束于第几句（用于分区统计）

    @classmethod
    def load(cls, path, name=None, drop_references=True):
        raw = read_raw(path)
        text = clean(raw, drop_references)
        name = name or re.sub(r"^[0-9a-f]{8}-", "", Path(path).stem)
        return cls.from_text(text, name)

    @classmethod
    def from_text(cls, text, name="doc"):
        sents = split_sentences(text)
        cut = 0
        m = SUMMARY_END.search(text)
        if m:
            cut = len(split_sentences(text[:m.start()]))
        return cls(name=name, text=re.sub(r"\s+", " ", text), sentences=sents, summary_cutoff=cut)

    @property
    def n_words(self):
        return len(tokenize(self.text))
