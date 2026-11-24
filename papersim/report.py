"""HTML / JSON / CSV 报告。"""
import csv
import html
import json
import math

CAT_COLORS = {"disclaimer": "#e8604c", "contrast": "#d9822b", "limitation": "#8e6bbf",
              "scope": "#3a8fb7", "hedge": "#5aa469"}
DUP_COLORS = {"exact": "#f4b6ad", "paraphrase": "#f7dc9c", "excluded": "#d9d9d4"}

CSS = """
body{font-family:-apple-system,'PingFang SC','Microsoft YaHei',sans-serif;max-width:1120px;margin:32px auto;padding:0 20px;color:#1f1f1f;background:#fbfbf9;line-height:1.55}
h1{font-size:26px;margin-bottom:4px}h2{margin-top:44px;border-bottom:2px solid #1f1f1f;padding-bottom:6px}
.sub{color:#777;font-size:13px}.card{background:#fff;border:1px solid #e4e4df;border-radius:10px;padding:16px 20px;margin:14px 0}
table{border-collapse:collapse;width:100%;font-size:13.5px}th,td{padding:7px 10px;border-bottom:1px solid #eee;text-align:left}
th{background:#f4f4f0;font-weight:600}td.num{font-variant-numeric:tabular-nums;white-space:nowrap}
.bar{display:inline-block;height:9px;border-radius:5px;vertical-align:middle;margin-right:6px}
.tag{display:inline-block;font-size:11.5px;padding:1px 7px;border-radius:9px;color:#fff;margin-right:4px}
.sent{margin:7px 0;padding:6px 10px;border-left:3px solid #ddd;font-size:13.5px;background:#fdfdfb}
mark{padding:0 1px;border-radius:2px}.fulltext{font-size:13px;max-height:520px;overflow:auto;white-space:pre-wrap}
.legend span{margin-right:14px;font-size:12.5px}.legend i{display:inline-block;width:12px;height:12px;border-radius:2px;vertical-align:-1px;margin-right:4px}
details summary{cursor:pointer;font-weight:600;margin:8px 0}.pair{font-size:13px;margin:8px 0;padding:6px 10px;background:#fffaf0;border-radius:6px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}@media(max-width:760px){.grid{grid-template-columns:1fr}}
"""


def pct(x):
    return "—" if x is None or (isinstance(x, float) and math.isnan(x)) else f"{x * 100:.1f}%"


def bar(x, color, scale=1.0):
    if x is None or (isinstance(x, float) and math.isnan(x)):
        return ""
    return f'<span class="bar" style="width:{max(2, min(120, x / scale * 120)):.0f}px;background:{color}"></span>'


def _highlight_dup(text, spans):
    prio = {"excluded": 1, "paraphrase": 2, "exact": 3}
    kind = [None] * len(text)
    src = [""] * len(text)
    for a, b, k, s in spans:
        for i in range(a, min(b, len(text))):
            if kind[i] is None or prio[k] > prio[kind[i]]:
                kind[i], src[i] = k, s
    out, i = [], 0
    while i < len(text):
        j = i
        while j < len(text) and kind[j] == kind[i] and src[j] == src[i]:
            j += 1
        seg = html.escape(text[i:j])
        if kind[i]:
            tip = {"exact": f"逐字重复 · {src[i]}", "paraphrase": "改写相似", "excluded": "赛题原文"}[kind[i]]
            out.append(f'<mark style="background:{DUP_COLORS[kind[i]]}" title="{html.escape(tip)}">{seg}</mark>')
        else:
            out.append(seg)
        i = j
    return "".join(out)


def _highlight_def(sent, matches):
    out, pos = [], 0
    for a, b, c in matches:
        if a < pos:
            continue
        out.append(html.escape(sent[pos:a]))
        out.append(f'<mark style="background:{CAT_COLORS[c]}33;border-bottom:2px solid {CAT_COLORS[c]}">{html.escape(sent[a:b])}</mark>')
        pos = b
    out.append(html.escape(sent[pos:]))
    return "".join(out)


def write_html(path, docs, dup, dfn, lex, meta, prompts=None):
    prompts = prompts or [None] * len(docs)
    cats = lex["categories"]
    H = [f"<!DOCTYPE html><html lang='zh'><head><meta charset='utf-8'><title>重复率与防御性语言率报告</title><style>{CSS}</style></head><body>",
         "<h1>重复率与防御性语言率报告</h1>",
         f"<p class='sub'>{len(docs)} 篇被测论文 · 比对库 {meta['n_corpus']} 篇额外文献 · 排除 {meta['n_exclude']} 篇赛题原文 · "
         f"指纹长度 n={meta['n'] or '自动(英文8词/中文13字)'} · 防御阈值 {lex.get('threshold', 1.0)}</p>"]

    # 总览
    H.append("<h2>总览</h2><div class='card'><table><tr><th>论文</th><th>总重复率</th><th>文字复制比</th><th>改写相似比</th>"
             "<th>赛题引用</th><th>最相似来源</th><th>防御性语言率</th><th>摘要 / 正文</th><th>防御强度<br><span class='sub'>分/千词</span></th>"
             + ("<th>LLM 防御率</th>" if any(r and r.llm_rate is not None for r in dfn) else "") + "</tr>")
    for d, u, f in zip(docs, dup, dfn):
        top = next(iter(u.by_source.items()), ("—", 0)) if u else ("—", 0)
        H.append(f"<tr><td><b>{html.escape(d.name)}</b><br><span class='sub'>{d.n_words} 词 · {len(d.sentences)} 句</span></td>"
                 + (f"<td class='num'>{bar(u.total_rate, '#d64834', .3)}<b>{pct(u.total_rate)}</b></td><td class='num'>{pct(u.exact_rate)}</td>"
                    f"<td class='num'>{pct(u.paraphrase_rate)}</td><td class='num'>{pct(u.excluded_rate)}</td>"
                    f"<td>{html.escape(top[0][:28])}<br><span class='sub'>{pct(top[1])}</span></td>" if u else "<td colspan=5>—</td>")
                 + (f"<td class='num'>{bar(f.rate, '#3a8fb7', .6)}<b>{pct(f.rate)}</b></td><td class='num'>{pct(f.summary_rate)} / {pct(f.body_rate)}</td>"
                    f"<td class='num'>{f.intensity:.1f}</td>" if f else "<td colspan=3>—</td>")
                 + (f"<td class='num'>{pct(f.llm_rate)}</td>" if f and f.llm_rate is not None else "")
                 + "</tr>")
    H.append("</table></div>")
    H.append("""<div class='card sub'><b>指标定义</b><br>
总重复率 = 与比对库重复的词（中文为字）数 / 全文词数，包括逐字重复和改写相似两部分；与赛题原文相同的部分单列为"赛题引用"，不计入。<br>
文字复制比：与任一来源连续 n 个词完全相同。改写相似比：句子级字符相似度 ≥ 阈值但不逐字相同（换词、调语序）。<br>
防御性语言率 = 防御性句数 / 总句数。防御性句：命中的类别权重之和 ≥ 阈值。强类（否定式免责、对照纠偏、局限声明）权重 1，
弱类（范围限定、模糊限定）权重 0.5，需两个弱类同时出现。防御强度 = 全部句子得分之和 / 千词。</div>""")

    # 防御类别分布
    if any(dfn):
        H.append("<h2>防御性语言：类别分布</h2><div class='card'><table><tr><th>类别</th>"
                 + "".join(f"<th>{html.escape(d.name[:22])}</th>" for d in docs) + "</tr>")
        for k, c in cats.items():
            H.append(f"<tr><td><span class='tag' style='background:{CAT_COLORS.get(k, '#888')}'>{c['label']}</span>"
                     f"<span class='sub'>权重 {c['weight']} · {html.escape(c['desc'])}</span></td>"
                     + "".join(f"<td class='num'>{bar(f.by_category[k], CAT_COLORS.get(k, '#888'), .5)}{pct(f.by_category[k])}</td>" if f else "<td>—</td>" for f in dfn)
                     + "</tr>")
        H.append("</table><p class='sub'>数值为命中该类的句子占全部句子的比例，一句可同时命中多类。</p></div>")

    # 逐篇
    H.append("<h2>逐篇明细</h2>")
    for d, u, f, pr in zip(docs, dup, dfn, prompts):
        H.append(f"<div class='card'><h3>{html.escape(d.name)}</h3>")
        if pr:
            H.append("<details><summary>专项优化提示词（复制后连同论文全文发给 AI）</summary>"
                     "<button onclick=\"navigator.clipboard.writeText(this.nextElementSibling.value);this.textContent='已复制'\">复制提示词</button>"
                     f"<textarea readonly style='width:100%;height:320px;font-size:12.5px;margin-top:6px'>{html.escape(pr)}</textarea></details>")
        if u:
            H.append("<details><summary>重复内容高亮（全文）</summary><div class='legend'>"
                     + "".join(f"<span><i style='background:{DUP_COLORS[k]}'></i>{v}</span>" for k, v in
                               [("exact", "逐字重复"), ("paraphrase", "改写相似"), ("excluded", "赛题原文")])
                     + f"</div><div class='fulltext'>{_highlight_dup(d.text, u.spans)}</div></details>")
            if u.by_source:
                H.append("<details><summary>按来源</summary><table>" + "".join(
                    f"<tr><td>{html.escape(s)}</td><td class='num'>{bar(v, '#d64834', .3)}{pct(v)}</td></tr>" for s, v in u.by_source.items()) + "</table></details>")
            if u.pairs:
                H.append(f"<details><summary>改写相似句（{len(u.pairs)}）</summary>" + "".join(
                    f"<div class='pair'><b>{r:.0%}</b> · 来源 {html.escape(s)}<br>本文：{html.escape(a)}<br>来源：{html.escape(b)}</div>"
                    for r, a, s, b in u.pairs[:40]) + "</details>")
        if f:
            H.append(f"<details open><summary>防御性句（{len(f.hits)} / {f.n_sentences}）</summary>")
            for h in sorted(f.hits, key=lambda h: -h.score)[:60]:
                tags = "".join(f"<span class='tag' style='background:{CAT_COLORS.get(c, '#888')}'>{cats[c]['label']}</span>" for c in h.categories)
                zone = "摘要" if h.index < d.summary_cutoff else "正文"
                H.append(f"<div class='sent'>{tags}<span class='sub'>{zone} · 第 {h.index + 1} 句 · 得分 {h.score:g}</span><br>{_highlight_def(h.text, h.matches)}</div>")
            H.append("</details>")
            if f.llm_hits:
                H.append(f"<details><summary>LLM 判定的防御性句（{len(f.llm_hits)}）</summary>" + "".join(
                    f"<div class='sent'><span class='sub'>{html.escape(str(x['category']))}</span><br>{html.escape(x['text'])}</div>" for x in f.llm_hits) + "</details>")
        H.append("</div>")
    H.append("<p class='sub'>由 papersim 生成。词典可在 papersim/lexicon.json 中修改。</p></body></html>")
    with open(path, "w", encoding="utf-8") as fh:
        fh.write("\n".join(H))


def write_json(path, docs, dup, dfn):
    out = [{"name": d.name, "words": d.n_words, "sentences": len(d.sentences),
            "duplication": u.to_dict() if u else None, "defensive": f.to_dict() if f else None}
           for d, u, f in zip(docs, dup, dfn)]
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(out, fh, ensure_ascii=False, indent=1, default=float)


def write_csv(path, docs, dup, dfn):
    with open(path, "w", newline="", encoding="utf-8-sig") as fh:
        w = csv.writer(fh)
        w.writerow(["论文", "词数", "句数", "总重复率", "文字复制比", "改写相似比", "赛题引用比", "最相似来源", "最相似来源重复率",
                    "防御性语言率", "摘要防御率", "正文防御率", "防御强度", "LLM防御率"])
        for d, u, f in zip(docs, dup, dfn):
            top = next(iter(u.by_source.items()), ("", 0)) if u else ("", 0)
            w.writerow([d.name, d.n_words, len(d.sentences),
                        *(f"{x:.4f}" for x in ((u.total_rate, u.exact_rate, u.paraphrase_rate, u.excluded_rate) if u else ())),
                        *([""] * 4 if not u else []), top[0], f"{top[1]:.4f}",
                        *((f"{f.rate:.4f}", f"{f.summary_rate:.4f}", f"{f.body_rate:.4f}", f"{f.intensity:.2f}",
                           "" if f.llm_rate is None else f"{f.llm_rate:.4f}") if f else [""] * 5)])
