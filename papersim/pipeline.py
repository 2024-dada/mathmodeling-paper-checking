"""检测流程：命令行和网页共用。"""
from dataclasses import dataclass, field

from .defensive import analyze as def_analyze, llm_review, load_lexicon
from .duplication import check_all
from .prompt import build as build_prompt


@dataclass
class Options:
    only: str = None                 # None / "dup" / "def"
    n: int = None
    para_threshold: float = 0.6
    lexicon: str = None
    threshold: float = None
    llm_review: bool = False         # 大模型复核防御句
    llm_embed: bool = False          # 语义向量参与改写检测
    apply: bool = False              # 直接执行优化提示词
    prompt: bool = True
    embed_text: bool = False
    target_summary: float = 0.10
    target_body: float = 0.08
    level: int = None               # 1–10 挡，设置后覆盖两个目标值


@dataclass
class Result:
    docs: list
    dup: list
    dfn: list
    prompts: list
    suggestions: list
    lex: dict
    meta: dict = field(default_factory=dict)


def run(docs, corpus=(), exclude=(), opt: Options = None, client=None, log=print):
    opt = opt or Options()
    corpus, exclude = list(corpus), list(exclude)
    if opt.only != "def" and len(docs) + len(corpus) < 2:
        raise ValueError("重复率至少需要两篇（被测论文 + 比对库）。只测防御性语言请选“只看防御性语言”")
    lex = load_lexicon(opt.lexicon)
    if opt.threshold is not None:
        lex["threshold"] = opt.threshold
    k = len(docs)

    dup = [None] * k
    if opt.only != "def":
        log("计算重复率…")
        embed = client.embed if (client and opt.llm_embed and client.embed_model) else None
        dup = check_all(docs, corpus, exclude, n=opt.n, para_threshold=opt.para_threshold, embed_fn=embed)

    dfn = [None] * k
    if opt.only != "dup":
        log("计算防御性语言率…")
        dfn = [def_analyze(d, lex) for d in docs]
        if client and opt.llm_review:
            for d, r in zip(docs, dfn):
                log(f"大模型复核防御句：{d.name}")
                llm_review(d, r, client)

    prompts, sugg = [None] * k, [None] * k
    if opt.prompt:
        log("生成优化提示词…")
        for i, (d, u, f) in enumerate(zip(docs, dup, dfn)):
            prompts[i] = build_prompt(d, u, f, lex, opt.target_summary, opt.target_body, embed_text=opt.embed_text, level=opt.level)
            if client and opt.apply:
                log(f"大模型执行优化提示词：{d.name}")
                full = prompts[i] if opt.embed_text else prompts[i] + "\n\n## 附：论文全文\n\n" + d.text
                sugg[i] = client.chat_text(full)
    log("完成")
    return Result(docs, dup, dfn, prompts, sugg, lex,
                  {"n_corpus": len(corpus), "n_exclude": len(exclude), "n": opt.n})
