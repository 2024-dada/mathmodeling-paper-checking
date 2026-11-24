"""根据检测结果生成"专项优化提示词"，交给任意 AI 改稿。

两个目标：
  1. 底气：把满篇的免责、限定改成"结论 → 数据证据 → 稳健性"的写法，局限集中写、配应对措施
  2. 区分度：与其他论文/同一 AI 产出雷同的段落，改成体现本队独有建模选择和证据的表述
"""
import re

from .defensive import DefResult
from .duplication import DupResult
from .extract import Document

# 常见的 AI 模板腔（大家用同一个模型时最容易撞的表达）
AI_TEMPLATE = [
    r"\bit is worth (noting|mentioning)\b", r"\bplays? an? (crucial|pivotal|vital|key|important) role\b",
    r"\bdelv(e|es|ing)\b", r"\bin the realm of\b", r"\b(comprehensive|holistic|multifaceted|intricate)\b",
    r"\brobust framework\b", r"\bnovel (approach|framework|method)\b", r"\bsheds? light on\b",
    r"\bpaves? the way\b", r"\b(in conclusion|in summary|to summari[sz]e)\b", r"\b(furthermore|moreover|additionally)\b",
    r"\bleverag(e|es|ing)\b", r"\bunderscor(e|es|ing)\b", r"\blandscape\b", r"\bseamless(ly)?\b",
    r"\b(auditable|traceable|reproducible witness)\b", r"\breconstruction consistency\b",
    "值得注意的是", "综上所述", "具有重要(的)?意义", "起着?至关重要的作用", "深入探讨", "全面(地)?(分析|探讨)",
]
_AI_RE = [re.compile(p, re.I) for p in AI_TEMPLATE]

STRATEGY = {
    "disclaimer": "遇到“这不是预测/估计”，改成正面陈述它**是什么**，并紧跟支撑它的验证数字。"
                  "确实需要的边界声明，全文只在摘要留一句、在局限一节留一处。",
    "contrast": "“A 而非 B”只保留全文最关键的一处；其余改成直接陈述 A 及其证据。",
    "limitation": "合并到 Strengths and Weaknesses（或 Limitations）一节；"
                  "每条局限都配一句“我们如何控制它”（灵敏度分析、区间界、替代数据、稳健性检验）。正文其他地方删掉重复声明。",
    "scope": "假设集中在 Assumptions 一节写清并给理由；"
             "结果处最多用一次“在基准假设下”，不要每句重复。",
    "hedge": "may/likely/approximately 能量化就量化（区间、误差、弹性、扰动 ±x% 后结论是否改变），"
             "用检验结论替代“可能”。",
}


# 1 最硬气 … 10 最保守（与 site/engine.js 的 LEVELS 一致）
LEVELS = [
    ("绝对自信", 0.02, 0.01, "除 Limitations 一节外，删除全部免责、限定和模糊语；每个结论直接用数字正面陈述。"),
    ("强势", 0.04, 0.03, "只保留会改变结论适用范围的限定，其余全部改成正面陈述加证据。"),
    ("果断", 0.06, 0.04, "摘要不出现免责句；正文每节最多保留一句必要的边界说明。"),
    ("自信", 0.08, 0.06, "摘要最多一句适用范围说明；正文的限定尽量换成灵敏度或检验结果。"),
    ("均衡", 0.10, 0.08, "摘要保留一句关键边界；正文的限定集中到假设和局限两节，并配应对措施。"),
    ("稳健", 0.13, 0.10, "保留主要假设前提的说明，删掉重复、空泛的免责；不确定性尽量量化。"),
    ("审慎", 0.16, 0.13, "保留各结论的适用条件，但每条都要具体（哪个假设、多大范围），不要笼统否定。"),
    ("严谨", 0.20, 0.16, "保留学术上必要的限定和可识别性讨论，只删去没有信息量的套话。"),
    ("学术保守", 0.25, 0.20, "基本保留原有限定，只合并重复声明，并把模糊语替换成具体数字。"),
    ("原样保留", 0.30, 0.25, "不主动删减限定，只改写明显空泛或自相矛盾的免责句。"),
]
DEFAULT_LEVEL = 5


def ai_template_hits(doc: Document, limit=15):
    hits = []
    for s in doc.sentences:
        found = [m.group() for rx in _AI_RE for m in [rx.search(s)] if m]
        if found:
            hits.append((found, s))
    return hits[:limit]


def _q(s, n=260):
    s = s.strip()
    return s if len(s) <= n else s[:n] + "…"


def build(doc: Document, dup: DupResult = None, dfn: DefResult = None, lex=None,
          target_summary=0.10, target_body=0.08, max_items=30, embed_text=False, level=None) -> str:
    lv = LEVELS[level - 1] if level else None
    if lv:
        target_summary, target_body = lv[1], lv[2]
    cats = (lex or {}).get("categories", {})
    lang = "中文" if re.search(r"[一-鿿]{20,}", doc.text) else "英文"
    L = [f"# 论文专项优化提示词：{doc.name}",
         "",
         "> 使用方法：把整段提示词连同论文全文（或 LaTeX 源码）一起发给 AI。"
         + ("本提示词已附全文。" if embed_text else "本提示词只列出问题句，请另外附上论文全文。"),
         "",
         "## 角色与硬约束",
         f"你是一名数学建模竞赛（MCM/ICM）的资深评委兼写作教练。请按下面的诊断结果修改这篇{lang}论文，输出语言与原文一致（{lang}）。",
         "必须遵守：",
         "1. **不改动任何数字、公式、模型设定和结论方向**；不新增论文里没有的数据、实验或文献。",
         "2. 需要新增分析才能支撑的地方，不要编造，写成 `[需补充分析：具体做什么]` 留给作者。",
         "3. 保留论文的 Report on Use of AI Tools（竞赛要求如实披露 AI 使用）。",
         "4. 不做同义词替换式的“降重”；每处修改都必须让论证更扎实或更有本队特色。",
         ""]

    # ---------- 底气
    if dfn and dfn.hits:
        L += ["## 底气：防御性语言优化",
              f"诊断：全文防御性语言率 **{dfn.rate:.1%}**（摘要 {dfn.summary_rate:.0%}，正文 {dfn.body_rate:.0%}），"
              f"防御强度 {dfn.intensity:.1f} 分/千词。目标：摘要 ≤ {target_summary:.0%}，正文 ≤ {target_body:.0%}。",
              *([f"改写口径（第 {level} 挡 · {lv[0]}）：{lv[3]}"] if lv else []),
              "",
              "评委读到满篇“这不是预测”“仅为示意”“无法识别”时，会觉得作者对自己的结果没底气。改写原则：",
              "- 每个核心结论写成三步：**结论（带数字）→ 支撑证据（验证/对比/检验结果）→ 稳健性（扰动后是否仍成立）**。",
              "- 不确定性用数字表达（区间、误差、灵敏度），不用语气词表达。",
              "- 必要的局限集中写一次，并且每条都说明如何控制或缓解它。",
              "- 摘要只保留一句最关键的适用范围声明，其余位置给出具体发现。",
              "",
              "分类改写策略："]
        used = sorted({c for h in dfn.hits for c in h.categories})
        for c in used:
            L.append(f"- **{cats.get(c, {}).get('label', c)}**：{STRATEGY.get(c, '')}")
        L += ["", f"需要处理的句子（按防御强度排序，最多 {max_items} 条）：", "",
              "| # | 位置 | 类别 | 原句 |", "|---|---|---|---|"]
        for k, h in enumerate(sorted(dfn.hits, key=lambda h: -h.score)[:max_items], 1):
            zone = "摘要" if h.index < doc.summary_cutoff else f"正文第{h.index + 1}句"
            lab = "、".join(cats.get(c, {}).get("label", c) for c in h.categories)
            L.append(f"| {k} | {zone} | {lab} | {_q(h.text).replace('|', '/')} |")
        L.append("")

    # ---------- 区分度
    tmpl = ai_template_hits(doc)
    if (dup and (dup.pairs or dup.exact_rate > 0)) or tmpl:
        L += ["## 区分度：去同质化",
              "大家用同一个 AI 写同一道题，表述和段落结构会高度趋同。评委一天看几十篇，雷同的段落会直接被略过。"]
        if dup:
            top = list(dup.by_source.items())[:3]
            L.append(f"诊断：总重复率 **{dup.total_rate:.1%}**（逐字 {dup.exact_rate:.1%}，改写相似 {dup.paraphrase_rate:.1%}）。"
                     + ("最相似的来源：" + "；".join(f"{s}（{v:.1%}）" for s, v in top) if top else ""))
        L += ["",
              "改写原则：",
              "- **写出选择的理由**：为什么用这个模型、这个参数、这种数据处理方式，而不用常见做法。理由正是别人写不出来的部分。",
              "- **用本文独有的证据开头**：具体到某一季、某个对象、某个反常案例，不要用题目背景复述开头。",
              "- **重组结构**：问题驱动（先给答案，再说怎么得到），而不是千篇一律的“背景 → 方法 → 结果”。",
              "- **给模型和关键指标起本队的名字**，并在图表、结论中前后呼应。",
              "- 和赛题原文、公共数据描述相同的句子可以保留，但尽量压缩成一句。",
              "",
              "请先基于论文已有结果，提出 **3 个能让本文与众不同的切入角度**（每个一句话，标明依据的是文中哪个结果），"
              "再按这些角度改写下面的段落。", ""]
        if dup and dup.spans:
            ex = [(a, b, s) for a, b, k, s in dup.spans if k == "exact" and b - a > 40][:max_items // 2]
            if ex:
                L += ["逐字重复的片段：", ""]
                L += [f"- 「{_q(doc.text[a:b], 200)}」（与 {s} 相同）" for a, b, s in ex]
                L.append("")
        if dup and dup.pairs:
            L += ["与其他论文高度相似的句子：", "", "| # | 本文 | 相似来源 | 来源原句 | 相似度 |", "|---|---|---|---|---|"]
            for k, (r, a, s, b) in enumerate(dup.pairs[:max_items], 1):
                L.append(f"| {k} | {_q(a, 180).replace('|', '/')} | {s} | {_q(b, 180).replace('|', '/')} | {r:.0%} |")
            L.append("")
        if tmpl:
            L += ["AI 模板腔（换成具体内容或直接删除）：", ""]
            L += [f"- `{'`, `'.join(f)}` → {_q(s, 160)}" for f, s in tmpl]
            L.append("")

    # ---------- 输出格式
    L += ["## 输出格式",
          "1. 先给出 3 个差异化切入角度（如果有“区分度”部分）。",
          "2. 再用表格逐条给出：`原句 | 修改后 | 修改理由（对应上面哪条原则）`。",
          "3. 最后给出改写后的**摘要全文**（这是评委最先读、也最影响印象的部分）。",
          "4. 列出所有 `[需补充分析：…]` 的位置，作为作者的待办清单。",
          ""]
    if embed_text:
        L += ["## 附：论文全文", "", "```", doc.text, "```"]
    return "\n".join(L)
