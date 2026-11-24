import * as E from "./engine.js";
import { pdfToText } from "./pdftext.js";

const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const pct = (x, d = 1) => x == null ? "—" : (x * 100).toFixed(d) + "%";
const ALLOWED = /\.(pdf|txt|md|tex)$/i;
const files = { papers: [], corpus: [], exclude: [] };
const CAT_COLOR = { disclaimer: "#e8604c", contrast: "#d9822b", limitation: "#8e6bbf", scope: "#3a8fb7", hedge: "#5aa469" };
let mode = "", LEX = null, last = null;

const store = { get(k) { try { return localStorage.getItem(k) } catch (e) { return null } }, set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v) } catch (e) { } } };
function toast(m) { const t = $("#toast"); t.textContent = m; t.classList.add("on"); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("on"), 1800); }
const tick = () => new Promise(r => setTimeout(r, 0));

/* ---------------- 初始化 ---------------- */
const lexReady = fetch("lexicon.json").then(r => r.json()).then(j => (LEX = j));
(/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) ? fetch("api/ping") : Promise.resolve(null)).then(r => r && r.ok ? r.json() : null).then(j => {
  if (j && j.papersim) {
    E.useLocalProxy("api/proxy");
    const n = $("#notice"); n.classList.add("local");
    n.textContent = "本地模式：论文只在这台电脑上处理，大模型请求经本机转发，不受浏览器跨域限制。";
  }
}).catch(() => { });

let pdfjs = null;
async function loadPdfjs() {
  if (!pdfjs) {
    pdfjs = await import("./vendor/pdf.min.mjs");
    pdfjs.GlobalWorkerOptions.workerSrc = new URL("./vendor/pdf.worker.min.mjs", import.meta.url).href;
  }
  return pdfjs;
}
async function readDoc(f, isExclude) {
  let raw;
  if (/\.pdf$/i.test(f.name)) raw = await pdfToText(await loadPdfjs(), new Uint8Array(await f.arrayBuffer()));
  else raw = await f.text();
  return E.makeDocument(raw, f.name.replace(/\.[^.]+$/, ""), false, !isExclude);
}

/* ---------------- 文件 ---------------- */
function addFiles(g, list) {
  let n = 0;
  for (const f of list) {
    if (!ALLOWED.test(f.name)) continue;
    if (files[g].some(x => x.name === f.name && x.size === f.size)) continue;
    files[g].push(f); n++;
  }
  if (!n && list.length) toast("没有可用的文件（支持 PDF / TXT / MD / TEX）");
  render();
}
function render() {
  document.querySelectorAll(".zone").forEach(z => {
    const g = z.dataset.g, box = z.querySelector(".chips");
    box.innerHTML = files[g].map((f, i) => `<div class="chip"><span class="ext">${esc(f.name.split(".").pop())}</span><span class="fn" title="${esc(f.name)}">${esc(f.name)}</span><span class="sz">${(f.size / 1024).toFixed(0)} KB</span><button class="x" data-i="${i}" title="移除">×</button></div>`).join("");
    z.querySelector(".empty").style.display = files[g].length ? "none" : "";
    box.querySelectorAll(".x").forEach(b => b.onclick = e => { e.stopPropagation(); files[g].splice(+b.dataset.i, 1); render(); });
  });
  const ok = files.papers.length > 0, busy = $("#run").dataset.busy === "1";
  $("#run").disabled = !ok || busy;
  if (!busy) { $("#log").style.color = ""; $("#log").textContent = ok ? `已放入 ${files.papers.length} 篇被测论文${files.corpus.length ? `、${files.corpus.length} 篇比对库` : ""}` : "先放入至少一篇被测论文"; }
}
async function entriesToFiles(items) {
  const out = [];
  async function walk(entry) {
    if (entry.isFile) out.push(await new Promise(r => entry.file(r)));
    else if (entry.isDirectory) {
      const reader = entry.createReader(); let batch;
      do { batch = await new Promise(r => reader.readEntries(r)); for (const e of batch) await walk(e); } while (batch.length);
    }
  }
  const entries = [...items].map(i => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean);
  if (!entries.length) return null;
  for (const e of entries) await walk(e);
  return out;
}
async function handleDrop(e, g) {
  e.preventDefault(); e.stopPropagation();
  const list = (e.dataTransfer.items && await entriesToFiles(e.dataTransfer.items)) || [...e.dataTransfer.files];
  addFiles(g, list);
}
let pickTarget = "papers";
document.querySelectorAll(".zone").forEach(z => {
  z.onclick = () => { pickTarget = z.dataset.g; $("#picker").click(); };
  z.ondragover = e => { e.preventDefault(); e.stopPropagation(); z.classList.add("drag"); $("#overlay").classList.remove("on"); };
  z.ondragleave = () => z.classList.remove("drag");
  z.ondrop = e => { z.classList.remove("drag"); dragDepth = 0; $("#overlay").classList.remove("on"); handleDrop(e, z.dataset.g); };
});
$("#picker").onchange = e => { addFiles(pickTarget, [...e.target.files]); e.target.value = ""; };
let dragDepth = 0;
window.addEventListener("dragenter", e => { if ([...(e.dataTransfer?.types || [])].includes("Files")) { dragDepth++; $("#overlay").classList.add("on"); } });
window.addEventListener("dragleave", () => { if (--dragDepth <= 0) { dragDepth = 0; $("#overlay").classList.remove("on"); } });
window.addEventListener("dragover", e => e.preventDefault());
window.addEventListener("drop", e => { dragDepth = 0; $("#overlay").classList.remove("on"); handleDrop(e, "papers"); });

/* ---------------- 设置 ---------------- */
document.querySelectorAll("#mode button").forEach(b => b.onclick = () => {
  document.querySelectorAll("#mode button").forEach(x => x.classList.toggle("on", x === b)); mode = b.dataset.v;
});
$("#para").oninput = e => $("#paraV").textContent = (+e.target.value).toFixed(2);

/* ---------------- 下拉选择 ---------------- */
function Combo(el, { placeholder, onChange }) {
  el.innerHTML = `<div class="cv disabled"><span class="ph">${placeholder}</span><i>▾</i></div><div class="pop"><input type="text" placeholder="搜索或直接输入模型名"><ul></ul></div>`;
  const cv = el.querySelector(".cv"), pop = el.querySelector(".pop"), q = pop.querySelector("input"), ul = pop.querySelector("ul");
  const st = { groups: [], value: "", def: "", enabled: false, act: -1 };
  function draw() {
    const k = q.value.trim().toLowerCase();
    let html = "";
    for (const g of st.groups) {
      const items = g.items.filter(x => !k || x.toLowerCase().includes(k));
      if (!items.length) continue;
      html += `<li class="grp">${esc(g.title)} · ${items.length}</li>`;
      for (const x of items) html += `<li data-v="${esc(x)}" class="${x === st.value ? "sel" : ""}">${esc(x)}${x === st.def ? '<span class="tag">推荐</span>' : ""}</li>`;
    }
    if (k && !st.groups.some(g => g.items.includes(q.value.trim()))) html += `<li data-v="${esc(q.value.trim())}" class="custom">使用「${esc(q.value.trim())}」</li>`;
    ul.innerHTML = html || `<li class="grp">没有匹配的模型，可直接输入模型名</li>`;
    st.act = -1;
    ul.querySelectorAll("li[data-v]").forEach(li => li.onmousedown = e => { e.preventDefault(); set(li.dataset.v); close(); });
  }
  function set(v) { st.value = v; cv.querySelector("span").outerHTML = v ? `<span>${esc(v)}</span>` : `<span class="ph">${placeholder}</span>`; onChange && onChange(v); }
  function open() { if (!st.enabled) return; pop.classList.add("open"); q.value = ""; draw(); setTimeout(() => q.focus(), 0); ul.querySelector(".sel")?.scrollIntoView({ block: "center" }); }
  function close() { pop.classList.remove("open"); }
  cv.onclick = () => pop.classList.contains("open") ? close() : open();
  q.oninput = draw;
  q.onkeydown = e => {
    const lis = [...ul.querySelectorAll("li[data-v]")];
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); st.act = Math.max(0, Math.min(lis.length - 1, st.act + (e.key === "ArrowDown" ? 1 : -1))); lis.forEach((l, i) => l.classList.toggle("act", i === st.act)); lis[st.act]?.scrollIntoView({ block: "nearest" }); }
    else if (e.key === "Enter") { e.preventDefault(); const li = lis[st.act] || lis[0]; if (li) { set(li.dataset.v); close(); } }
    else if (e.key === "Escape") close();
  };
  q.onblur = () => setTimeout(close, 120);
  return {
    load(groups, def, autoOpen) {
      st.groups = groups; st.def = def || ""; st.enabled = true; cv.classList.remove("disabled");
      const all = groups.flatMap(g => g.items); set(all.includes(st.value) ? st.value : (def || "")); if (autoOpen) open();
    },
    disable(text) { st.groups = []; st.enabled = false; cv.classList.add("disabled"); set(""); if (text) cv.querySelector("span").textContent = text; },
    enableManual() { st.enabled = true; cv.classList.remove("disabled"); },
    get value() { return st.value; }
  };
}
const chat = Combo($("#cmChat"), { placeholder: "填好 key 后自动列出", onChange: v => { if (v) store.set("ps_model", v); syncOpts(); } });
const embed = Combo($("#cmEmbed"), { placeholder: "不使用", onChange: v => { if (v) store.set("ps_embed", v); syncOpts(); } });
function syncOpts() {
  const hasChat = !!chat.value, hasEmbed = !!embed.value;
  for (const [l, i, ok] of [["#lReview", "#oReview", hasChat], ["#lApply", "#oApply", hasChat], ["#lEmbed", "#oEmbed", hasEmbed]]) {
    $(l).classList.toggle("disabled", !ok); $(i).disabled = !ok;
  }
  if (hasEmbed && !$("#oEmbed")._touched) $("#oEmbed").checked = true;
}
$("#oEmbed").onchange = e => e.target._touched = true;

/* ---------------- API 识别 ---------------- */
$("#prov").innerHTML = `<option value="">自动识别</option>` + Object.entries(E.PROVIDERS).map(([k, p]) => `<option value="${k}">${esc(p.name)}</option>`).join("") + `<option value="custom">自定义地址</option>`;
let seq = 0, timer = null;
function status(kind, text) { $("#st").className = "status " + kind; $("#stT").textContent = text; }
function showErr(t) { const e = $("#err"); e.textContent = t || ""; e.style.display = t ? "block" : "none"; }

async function detectModels(autoOpen = true) {
  const key = $("#key").value.trim(), my = ++seq;
  showErr("");
  if (!key) { status("", "未填写"); chat.disable(); embed.disable(); syncOpts(); return; }
  if (key.length < 16) { status("", "key 太短"); return; }
  status("busy", "识别中…");
  const base = $("#base").value.trim();
  const r = await E.detect(key, base || null);
  if (my !== seq) return;
  if (r.base && !base) $("#base").value = r.base;
  if (r.provider) $("#prov").value = E.PROVIDERS[r.provider] ? r.provider : "custom";
  if (r.ok) {
    status("ok", `${r.providerName} · ${r.chat.length} 个对话模型`);
    const saved = store.get("ps_model");
    chat.load([{ title: "对话模型", items: r.chat }], r.chat.includes(saved) ? saved : r.defaultChat, autoOpen);
    if (r.embed.length) { const se = store.get("ps_embed"); embed.load([{ title: "向量模型", items: r.embed }], r.embed.includes(se) ? se : ""); }
    else embed.disable("该服务商没有向量模型");
  } else {
    status("err", r.providerName ? `${r.providerName} · 无法获取列表` : "识别失败");
    showErr(r.error + (!E.net.proxied && /浏览器无法访问/.test(r.error) ? "。可以在“服务商与地址”里换中转地址，或使用本地版 papersim-web。" : ""));
    if (r.chat && r.chat.length) chat.load([{ title: "常用模型（未验证）", items: r.chat }], r.chat[0], false);
    else { chat.disable("可在下拉框里直接输入模型名"); chat.enableManual(); }
    $("#adv").open = true;
  }
  syncOpts();
}
$("#key").addEventListener("input", () => {
  clearTimeout(timer);
  if ($("#remember").checked) store.set("ps_key", $("#key").value.trim());
  timer = setTimeout(detectModels, 650);
});
$("#key").addEventListener("paste", () => { clearTimeout(timer); timer = setTimeout(detectModels, 50); });
$("#eye").onclick = () => { const k = $("#key"); k.type = k.type === "password" ? "text" : "password"; };
$("#remember").onchange = e => { store.set("ps_remember", e.target.checked ? "1" : null); store.set("ps_key", e.target.checked ? $("#key").value.trim() : null); };
$("#prov").onchange = e => {
  const p = E.PROVIDERS[e.target.value];
  $("#base").value = p ? p.base : "";
  if (e.target.value === "custom") { $("#base").focus(); return; }
  detectModels();
};
$("#base").addEventListener("change", () => detectModels());
const client = () => chat.value ? new E.Client({ key: $("#key").value.trim(), base: $("#base").value.trim(), model: chat.value, embedModel: embed.value || null }) : null;
$("#testBtn").onclick = async () => {
  const out = $("#testOut");
  if (!chat.value) { out.textContent = "请先选择模型"; return; }
  out.style.color = ""; out.textContent = "测试中…";
  try { const r = await client().chatText("只回复两个字：可用", 0); out.textContent = `✓ 可用（模型回复：${r.trim().slice(0, 30)}）`; out.style.color = "var(--ok)"; }
  catch (e) { out.textContent = `✗ ${e.message}`; out.style.color = "var(--dup)"; }
};
if (store.get("ps_remember")) { $("#remember").checked = true; const k = store.get("ps_key"); if (k) { $("#key").value = k; setTimeout(() => detectModels(false), 300); } }
chat.disable(); embed.disable(); syncOpts();

/* ---------------- 运行 ---------------- */
$("#run").onclick = async () => {
  const btn = $("#run"), log = $("#log");
  btn.dataset.busy = "1"; btn.disabled = true; $("#spin").style.display = "block"; log.style.color = "";
  const say = async m => { log.textContent = m; await tick(); };
  try {
    await lexReady;
    const lex = E.compileLexicon(LEX);
    const all = [...files.papers.map(f => ["papers", f]), ...files.corpus.map(f => ["corpus", f]), ...files.exclude.map(f => ["exclude", f])];
    const got = { papers: [], corpus: [], exclude: [] };
    for (let i = 0; i < all.length; i++) {
      const [g, f] = all[i];
      await say(`读取文件 ${i + 1}/${all.length}：${f.name}`);
      try { got[g].push(await readDoc(f, g === "exclude")); }
      catch (e) { throw new Error(`读取 ${f.name} 失败：${e.message}`); }
    }
    for (const d of got.papers) if (d.sentences.length < 3) toast(`${d.name} 几乎没抽出文字，可能是扫描版 PDF`);
    const useLLM = chat.value && ($("#oReview").checked || $("#oApply").checked || (embed.value && $("#oEmbed").checked));
    const res = await E.run({
      docs: got.papers, corpus: got.corpus, exclude: got.exclude, lex, client: useLLM ? client() : null, log: say,
      opt: {
        only: mode || null, paraThreshold: +$("#para").value, targetSummary: $("#tSum").value / 100, targetBody: $("#tBody").value / 100,
        embedText: $("#embedText").checked, llmReview: $("#oReview").checked && !$("#oReview").disabled,
        llmEmbed: $("#oEmbed").checked && !$("#oEmbed").disabled, apply: $("#oApply").checked && !$("#oApply").disabled,
      }
    });
    last = { ...res, lex, targets: [$("#tSum").value / 100, $("#tBody").value / 100] };
    showResults(last);
    log.textContent = "完成";
  } catch (e) { log.textContent = "出错：" + e.message; log.style.color = "var(--dup)"; console.error(e); }
  btn.dataset.busy = ""; $("#spin").style.display = "none"; render();
  if (last) $("#log").textContent = "完成";
};

/* ---------------- 结果 ---------------- */
function track(x, color, tgt, scale = 1) {
  const w = Math.min(100, (x || 0) / scale * 100);
  return `<div class="track"><div class="fill" style="width:${w}%;background:${color}"></div>${tgt != null ? `<div class="tgt" style="left:${Math.min(100, tgt / scale * 100)}%" title="目标 ${pct(tgt, 0)}"></div>` : ""}</div>`;
}
function highlightDup(text, spans) {
  const prio = { excluded: 1, paraphrase: 2, exact: 3 }, kind = new Array(text.length).fill(null), src = new Array(text.length).fill("");
  for (const [a, b, k, s] of spans) for (let i = a; i < Math.min(b, text.length); i++) if (!kind[i] || prio[k] > prio[kind[i]]) { kind[i] = k; src[i] = s; }
  const col = { exact: "#f4b6ad", paraphrase: "#f7dc9c", excluded: "#d9d9d4" }, tip = { exact: "逐字重复", paraphrase: "改写相似", excluded: "赛题原文" };
  let out = "", i = 0;
  while (i < text.length) {
    let j = i; while (j < text.length && kind[j] === kind[i] && src[j] === src[i]) j++;
    const seg = esc(text.slice(i, j));
    out += kind[i] ? `<mark style="background:${col[kind[i]]}" title="${tip[kind[i]]}${src[i] ? " · " + esc(src[i]) : ""}">${seg}</mark>` : seg;
    i = j;
  }
  return out;
}
function highlightDef(sent, matches) {
  let out = "", pos = 0;
  for (const [a, b, c] of matches) { if (a < pos) continue; out += esc(sent.slice(pos, a)) + `<mark style="background:${CAT_COLOR[c]}2e;border-bottom:2px solid ${CAT_COLOR[c]}">${esc(sent.slice(a, b))}</mark>`; pos = b; }
  return out + esc(sent.slice(pos));
}
function paperCard(r, k) {
  const { docs, dup, dfn, prompts, suggestions, lex, targets: [tS, tB] } = r;
  const doc = docs[k], d = dup[k], f = dfn[k], p = prompts[k], sg = suggestions[k], cats = lex.categories;
  const dupBox = d ? `<div class="metric dup"><div class="lab">总重复率</div><div class="big">${pct(d.total)}</div>${track(d.total, "var(--dup)", null, .5)}
    <div class="kv"><span>逐字 <b>${pct(d.exact)}</b></span><span>改写 <b>${pct(d.paraphrase)}</b></span><span>赛题引用 <b>${pct(d.excluded)}</b></span>
    ${Object.keys(d.bySource).length ? `<span>最相似：<b>${esc(Object.keys(d.bySource)[0])}</b> ${pct(Object.values(d.bySource)[0])}</span>` : ""}</div></div>` : "";
  const cls = (x, t) => x == null ? "" : (x <= t ? "good" : "bad");
  const defBox = f ? `<div class="metric def"><div class="lab">防御性语言率</div><div class="big">${pct(f.rate)}</div>${track(f.rate, "var(--def)", tB, .5)}
    <div class="kv"><span>摘要 <b class="${cls(f.summary, tS)}">${pct(f.summary, 0)}</b> / 目标 ${pct(tS, 0)}</span><span>正文 <b class="${cls(f.body, tB)}">${pct(f.body, 0)}</b> / 目标 ${pct(tB, 0)}</span>
    <span>强度 <b>${f.intensity.toFixed(1)}</b> 分/千词</span>${f.llmRate != null ? `<span>大模型复核 <b>${pct(f.llmRate)}</b></span>` : ""}</div>
    <div class="cats">${Object.entries(f.byCategory).map(([c, v]) => `<span>${esc(cats[c].label)}</span><div class="bar" style="width:${Math.max(2, v * 200)}%;background:${CAT_COLOR[c]}"></div><span>${pct(v, 0)}</span>`).join("")}</div></div>` : "";
  const tabs = [["prompt", "优化提示词"], ...(sg ? [["sug", "AI 修改建议"]] : []), ...(f ? [["defs", `防御句 ${f.hits.length}`]] : []), ...(d ? [["pairs", `相似句 ${d.pairs.length}`], ["full", "重复高亮"]] : [])];
  return `<section class="card paper" data-k="${k}">
    <h3>${esc(doc.name)}</h3><div class="meta">${doc.nWords} 词 · ${doc.sentences.length} 句</div>
    <div class="metrics">${dupBox}${defBox}</div>
    <div class="tabs">${tabs.map(([id, t], i) => `<button data-t="${id}" class="${i ? "" : "on"}">${t}</button>`).join("")}</div>
    <div class="pane on" data-p="prompt"><div class="acts"><button class="btn sm cp">复制提示词</button><button class="btn sm dl">下载 .md</button></div><textarea class="prompt" readonly>${esc(p)}</textarea></div>
    ${sg ? `<div class="pane" data-p="sug"><div class="acts"><button class="btn sm cps">复制</button></div><div class="md">${esc(sg)}</div></div>` : ""}
    ${f ? `<div class="pane" data-p="defs">${f.hits.length ? [...f.hits].sort((a, b) => b.score - a.score).map(h => `<div class="sent"><div class="t">${h.index < doc.summaryCutoff ? "摘要" : "正文"} · ${h.categories.map(c => cats[c].label).join("、")} · 得分 ${h.score}</div>${highlightDef(h.text, h.matches)}</div>`).join("") : `<div class="none">没有检出防御性句</div>`}
      ${f.llmHits.length ? `<div class="hint" style="margin-top:12px">大模型额外判定的防御句：</div>` + f.llmHits.map(h => `<div class="sent"><div class="t">${esc(h.category)}</div>${esc(h.text)}</div>`).join("") : ""}</div>` : ""}
    ${d ? `<div class="pane" data-p="pairs">${d.pairs.length ? d.pairs.map(([s, a, src, b]) => `<div class="pair"><span class="s">${pct(s, 0)}</span> · 来源 ${esc(src)}<br>本文：${esc(a)}<br>来源：${esc(b)}</div>`).join("") : `<div class="none">没有相似句</div>`}</div>
      <div class="pane" data-p="full"><div class="legend"><span><i style="background:#f4b6ad"></i>逐字重复</span><span><i style="background:#f7dc9c"></i>改写相似</span><span><i style="background:#d9d9d4"></i>赛题原文</span></div><div class="fulltext">${highlightDup(doc.text, d.spans)}</div></div>` : ""}
  </section>`;
}
function showResults(r) {
  $("#results").style.display = "block";
  $("#papers").innerHTML = r.docs.map((_, k) => paperCard(r, k)).join("");
  document.querySelectorAll(".paper").forEach(card => {
    const k = +card.dataset.k;
    card.querySelectorAll(".tabs button").forEach(b => b.onclick = () => {
      card.querySelectorAll(".tabs button").forEach(x => x.classList.toggle("on", x === b));
      card.querySelectorAll(".pane").forEach(x => x.classList.toggle("on", x.dataset.p === b.dataset.t));
    });
    card.querySelector(".cp").onclick = () => copy(r.prompts[k]);
    card.querySelector(".cps")?.addEventListener("click", () => copy(r.suggestions[k]));
    card.querySelector(".dl").onclick = () => download(`${r.docs[k].name}_优化提示词.md`, r.prompts[k], "text/markdown");
  });
  $("#results").scrollIntoView({ behavior: "smooth" });
}
async function copy(t) {
  try { await navigator.clipboard.writeText(t); }
  catch (e) { const x = document.createElement("textarea"); x.value = t; document.body.appendChild(x); x.select(); document.execCommand("copy"); x.remove(); }
  toast("已复制");
}
function download(name, content, type) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([content], { type: type + ";charset=utf-8" }));
  a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
const stamp = () => new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
$("#dlPrompts").onclick = () => last && download(`papersim_提示词_${stamp()}.md`, last.prompts.join("\n\n---\n\n"), "text/markdown");
$("#dlCsv").onclick = () => {
  if (!last) return;
  const f4 = x => x == null ? "" : x.toFixed(4);
  const rows = [["论文", "词数", "句数", "总重复率", "文字复制比", "改写相似比", "赛题引用比", "最相似来源", "最相似来源重复率", "防御性语言率", "摘要防御率", "正文防御率", "防御强度", "大模型防御率"]];
  last.docs.forEach((d, i) => {
    const u = last.dup[i], f = last.dfn[i], top = u ? Object.entries(u.bySource)[0] || ["", 0] : ["", null];
    rows.push([d.name, d.nWords, d.sentences.length, f4(u?.total), f4(u?.exact), f4(u?.paraphrase), f4(u?.excluded), top[0], f4(top[1]),
      f4(f?.rate), f4(f?.summary), f4(f?.body), f ? f.intensity.toFixed(2) : "", f4(f?.llmRate)]);
  });
  download(`papersim_${stamp()}.csv`, "﻿" + rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\r\n"), "text/csv");
};
$("#dlJson").onclick = () => {
  if (!last) return;
  const out = last.docs.map((d, i) => ({ name: d.name, words: d.nWords, sentences: d.sentences.length, duplication: last.dup[i], defensive: last.dfn[i], prompt: last.prompts[i], suggestion: last.suggestions[i] }));
  download(`papersim_${stamp()}.json`, JSON.stringify(out, null, 1), "application/json");
};
$("#dlReport").onclick = () => {
  if (!last) return;
  const css = [...document.styleSheets].map(s => { try { return [...s.cssRules].map(r => r.cssText).join("\n"); } catch (e) { return ""; } }).join("\n");
  const body = last.docs.map((_, k) => paperCard(last, k)).join("");
  const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>papersim 报告</title><style>${css}
    .pane{display:block!important;margin-bottom:16px}.tabs{display:none}textarea.prompt{height:auto;min-height:300px}.fulltext,.md{max-height:none}</style></head>
    <body><div class="wrap"><header><h1>papersim 报告</h1><span class="sub">${new Date().toLocaleString()}</span></header>${body}</div></body></html>`;
  download(`papersim_报告_${stamp()}.html`, html, "text/html");
};
render();
