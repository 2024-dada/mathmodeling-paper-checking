"""命令行入口：papersim a.pdf b.pdf ... [选项]"""
import argparse
import sys
from pathlib import Path

from . import __version__
from .extract import Document
from .pipeline import Options, run
from .report import write_csv, write_html, write_json

SUPPORTED = {".pdf", ".txt", ".md", ".tex"}


def _collect(paths):
    out = []
    for p in paths:
        p = Path(p)
        if p.is_dir():
            out += sorted(x for x in p.rglob("*") if x.suffix.lower() in SUPPORTED)
        else:
            out.append(p)
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(prog="papersim", description="论文重复率 + 防御性语言率检测")
    ap.add_argument("files", nargs="+", help="被测论文（PDF/TXT/MD/TEX 或文件夹）。多篇时互相比对")
    ap.add_argument("-c", "--corpus", nargs="*", default=[], help="额外比对库（只作为来源，不出报告）")
    ap.add_argument("-x", "--exclude", nargs="*", default=[], help="赛题原文等，与其相同的部分不计重复")
    ap.add_argument("-o", "--out", default="papersim_report.html", help="HTML 报告路径")
    ap.add_argument("--json", help="另存 JSON")
    ap.add_argument("--csv", help="另存 CSV 汇总")
    ap.add_argument("--only", choices=["dup", "def"], help="只跑重复率(dup)或防御性语言(def)")
    ap.add_argument("-n", type=int, help="指纹长度（默认英文 8 词、中文 13 字）")
    ap.add_argument("--para-threshold", type=float, default=0.6, help="改写相似句阈值 0-1，默认 0.6")
    ap.add_argument("--lexicon", help="自定义防御词典 JSON")
    ap.add_argument("--threshold", type=float, help="防御句得分阈值，覆盖词典中的设置")
    ap.add_argument("--keep-references", action="store_true", help="保留参考文献部分")
    ap.add_argument("--llm", action="store_true", help="用大模型复核防御句；若设 PAPERSIM_EMBED_MODEL 也用于改写检测")
    ap.add_argument("--prompt-dir", help="优化提示词输出目录（默认与报告同目录下 prompts/）")
    ap.add_argument("--no-prompt", action="store_true", help="不生成优化提示词")
    ap.add_argument("--embed-text", action="store_true", help="提示词里附上论文全文，可直接整段粘贴给 AI")
    ap.add_argument("--target-summary", type=float, default=0.10, help="摘要防御率目标，默认 0.10")
    ap.add_argument("--target-body", type=float, default=0.08, help="正文防御率目标，默认 0.08")
    ap.add_argument("--level", type=int, choices=range(1, 11), metavar="1-10",
                    help="防御率挡位：1 最硬气 … 10 最保守，默认 5（均衡）；设置后覆盖 --target-summary/--target-body")
    ap.add_argument("--apply", action="store_true", help="直接调用 API 执行提示词，输出 AI 的修改建议（需 API 配置）")
    ap.add_argument("-V", "--version", action="version", version=__version__)
    a = ap.parse_args(argv)

    drop = not a.keep_references
    files = _collect(a.files)
    if not files:
        sys.exit("没有找到可读文件")
    docs = [Document.load(p, drop_references=drop) for p in files]
    corpus = [Document.load(p, drop_references=drop) for p in _collect(a.corpus)]
    exclude = [Document.load(p, drop_references=False) for p in _collect(a.exclude)]

    client = None
    if a.llm or a.apply:
        from .llm import LLMClient
        try:
            client = LLMClient()
        except RuntimeError as e:
            print(f"[warn] {e}，跳过大模型步骤", file=sys.stderr)

    opt = Options(only=a.only, n=a.n, para_threshold=a.para_threshold, lexicon=a.lexicon, threshold=a.threshold,
                  llm_review=a.llm, llm_embed=a.llm, apply=a.apply, prompt=not a.no_prompt,
                  embed_text=a.embed_text, target_summary=a.target_summary, target_body=a.target_body,
                  level=a.level)
    try:
        res = run(docs, corpus, exclude, opt, client, log=lambda m: print(f"[papersim] {m}", file=sys.stderr))
    except ValueError as e:
        sys.exit(str(e))
    dup, dfn = res.dup, res.dfn

    if opt.prompt:
        pdir = Path(a.prompt_dir or Path(a.out).resolve().parent / "prompts")
        pdir.mkdir(parents=True, exist_ok=True)
        for d, pr, sg in zip(docs, res.prompts, res.suggestions):
            (pdir / f"{d.name}_优化提示词.md").write_text(pr, encoding="utf-8")
            if sg:
                (pdir / f"{d.name}_AI修改建议.md").write_text(sg, encoding="utf-8")
        print(f"优化提示词已写入：{pdir}")

    write_html(a.out, docs, dup, dfn, res.lex, res.meta, res.prompts)
    if a.json:
        write_json(a.json, docs, dup, dfn)
    if a.csv:
        write_csv(a.csv, docs, dup, dfn)

    w = max(len(d.name) for d in docs)
    w = min(w, 40)
    print(f"{'论文':<{w}}  总重复率  复制比  改写比  防御率  摘要/正文")
    for d, u, f in zip(docs, dup, dfn):
        s = f"{d.name[:w]:<{w}}  "
        s += f"{u.total_rate:7.1%}  {u.exact_rate:6.1%}  {u.paraphrase_rate:6.1%}  " if u else " " * 27
        s += f"{f.rate:6.1%}  {f.summary_rate:.0%}/{f.body_rate:.0%}" if f else ""
        print(s)
    print(f"报告已生成：{a.out}")


if __name__ == "__main__":
    main()
