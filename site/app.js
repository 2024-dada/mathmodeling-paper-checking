import * as E from "./engine.js?v=academic-style3";
import { pdfToText } from "./pdftext.js?v=academic-style3";
import { reportPdf } from "./reportpdf.js";
import { docxToText } from "./docxtext.js";

const $ = s => document.querySelector(s);
const scrollMode = () => document.documentElement.dataset.motion === "reduce" || matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const pct = (x, d = 1) => x == null ? "—" : (x * 100).toFixed(d) + "%";
const ALLOWED = /\.(pdf|docx|txt|md|tex)$/i;
const files = { papers: [], corpus: [], exclude: [] };
const CAT_COLOR = { disclaimer: "#ff3c8e", contrast: "#ffb000", limitation: "#8f5cff", scope: "#2de2e6", hedge: "#5cf2a6" };
let mode = "none", LEX = null, last = null;

const store = { get(k) { try { return localStorage.getItem(k) } catch (e) { return null } }, set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v) } catch (e) { } } };
function toast(m) { const t = $("#toast"); t.textContent = m; t.classList.add("on"); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("on"), 1800); }
const tick = () => new Promise(r => setTimeout(r, 0));
let detecting = false, inputGeneration = 0, progressValue = 0;
function blocked() {
  if (!detecting) return false;
  toast("正在检测中，请等待本次检测结束后再操作"); return true;
}
function setProgress(value, detail) {
  progressValue = Math.max(progressValue, Math.min(100, Math.round(value)));
  $("#progressFill").style.width = progressValue + "%";
  $("#progressPercent").textContent = progressValue + "%";
  $("#progressTrack").setAttribute("aria-valuenow", String(progressValue));
  if (detail) { $("#progressDetail").textContent = detail; $("#progressTrack").setAttribute("aria-valuetext", `${progressValue}%：${detail}`); }
}
function lockDetection(lock) {
  detecting = lock;
  const area = $("#analysisInputs"); area.inert = lock; area.setAttribute("aria-disabled", String(lock));
  $("#results").inert = lock;
  document.body.classList.toggle("detecting", lock);
  $("#run").dataset.busy = lock ? "1" : "";
  $("#run").disabled = lock || !files.papers.length;
  $("#run").textContent = lock ? "检测中，请等待…" : "开始检测";
  $("#spin").style.display = lock ? "block" : "none";
  $("#progressState").textContent = lock ? "检测中，请等待" : "检测完成";
  $("#progressTrack").setAttribute("aria-busy", String(lock));
  if (lock) {
    window.dispatchEvent(new CustomEvent("papersim:run-start"));
    inputGeneration++; progressValue = 0; $("#runProgress").hidden = false;
    $("#runProgress").classList.remove("failed");
    document.querySelectorAll(".combo .pop").forEach(el => el.classList.remove("open"));
    $("#overlay").classList.remove("on");
    setProgress(0, "正在准备检测…");
    $("#runProgress").scrollIntoView({ behavior: scrollMode(), block: "center" });
  } else syncOpts();
}
// inert 阻止键盘和点击进入设置区；捕获点击时给出明确提示。
document.addEventListener("click", e => {
  if (!detecting) return;
  const r = $("#analysisInputs").getBoundingClientRect(), result = $("#results").getBoundingClientRect();
  if ((e.clientY >= r.top && e.clientY <= r.bottom) || (e.clientY >= result.top && e.clientY <= result.bottom)) { e.preventDefault(); e.stopPropagation(); blocked(); }
}, true);


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
  let raw, extraction = null;
  if (/\.pdf$/i.test(f.name)) raw = await pdfToText(await loadPdfjs(), new Uint8Array(await f.arrayBuffer()), info => { extraction = info; });
  else if (/\.docx$/i.test(f.name)) raw = await docxToText(await f.arrayBuffer());
  else raw = await f.text();
  return { ...E.makeDocument(raw, f.name.replace(/\.[^.]+$/, ""), false, !isExclude),
    sourceText: raw, sourceFormat: f.name.split(".").at(-1).toLowerCase(), extraction };
}

/* ---------------- 文件 ---------------- */
function addFiles(g, list) {
  if (blocked()) return;
  let n = 0;
  for (const f of list) {
    if (!ALLOWED.test(f.name)) continue;
    if (files[g].some(x => x.name === f.name && x.size === f.size)) continue;
    files[g].push(f); n++;
  }
  if (!n && list.length) toast("没有可用的文件（支持 PDF / DOCX / TXT / MD / TEX）");
  render();
}
function render() {
  document.querySelectorAll(".zone").forEach(z => {
    const g = z.dataset.g, box = z.querySelector(".chips");
    box.innerHTML = files[g].map((f, i) => `<div class="chip"><span class="ext">${esc(f.name.split(".").pop())}</span><span class="fn" title="${esc(f.name)}">${esc(f.name)}</span><span class="sz">${(f.size / 1024).toFixed(0)} KB</span><button class="x" data-i="${i}" title="移除">×</button></div>`).join("");
    z.querySelector(".empty").style.display = files[g].length ? "none" : "";
    box.querySelectorAll(".x").forEach(b => b.onclick = e => { e.stopPropagation(); if (blocked()) return; files[g].splice(+b.dataset.i, 1); render(); });
  });
  const ok = files.papers.length > 0 && !!document.querySelector("#mode input:checked"), busy = $("#run").dataset.busy === "1";
  $("#run").disabled = !ok || busy;
  if (!busy) {
    $("#log").style.color = "";
    const lonely = ok && document.querySelector('#mode input[data-check="dup"]:checked') && files.papers.length + files.corpus.length < 2;
    $("#log").textContent = !ok ? (files.papers.length ? "请勾选至少一个检查项" : "先放入至少一篇被测论文")
      : lonely ? "只有一篇论文：重复率需要再放一篇论文或比对库，也可以取消勾选“重复率”"
      : `已放入 ${files.papers.length} 篇被测论文${files.corpus.length ? `、${files.corpus.length} 篇比对库` : ""}`;
  }
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
  if (blocked()) return;
  const generation = inputGeneration;
  const list = (e.dataTransfer.items && await entriesToFiles(e.dataTransfer.items)) || [...e.dataTransfer.files];
  if (generation !== inputGeneration) return;
  addFiles(g, list);
}
let pickTarget = "papers";
document.querySelectorAll(".zone").forEach(z => {
  z.onclick = () => { if (blocked()) return; pickTarget = z.dataset.g; $("#picker").click(); };
  z.ondragover = e => { e.preventDefault(); e.stopPropagation(); z.classList.add("drag"); $("#overlay").classList.remove("on"); };
  z.ondragleave = () => z.classList.remove("drag");
  z.ondrop = e => { z.classList.remove("drag"); dragDepth = 0; $("#overlay").classList.remove("on"); handleDrop(e, z.dataset.g); };
});
$("#picker").onchange = e => { addFiles(pickTarget, [...e.target.files]); e.target.value = ""; };
let dragDepth = 0;
window.addEventListener("dragenter", e => { if ([...(e.dataTransfer?.types || [])].includes("Files")) { if (detecting) return; dragDepth++; $("#overlay").classList.add("on"); } });
window.addEventListener("dragleave", () => { if (--dragDepth <= 0) { dragDepth = 0; $("#overlay").classList.remove("on"); } });
window.addEventListener("dragover", e => e.preventDefault());
window.addEventListener("drop", e => { dragDepth = 0; $("#overlay").classList.remove("on"); handleDrop(e, "papers"); });

/* ---------------- 挡位 ---------------- */
let level = +(store.get("ps_level") || E.DEFAULT_LEVEL);
const LV_COLORS = ["#ff3c8e", "#ff4f9a", "#ff66a8", "#e06cc4", "#b670e6", "#8f7cff", "#6c9cff", "#4cbdf2", "#2de2e6", "#5cf2a6"];
function drawGauge() {
  $("#gauge").innerHTML = E.LEVELS.map((lv, i) => `<button role="radio" aria-checked="${i + 1 === level}" aria-label="第 ${i + 1} 挡 ${lv.name}" data-l="${i + 1}"
    class="${i + 1 <= level ? "lit" : ""} ${i + 1 === level ? "cur" : ""}" style="height:${30 + i * 7.8}%;--c:${LV_COLORS[i]}"><span>${i + 1}</span></button>`).join("");
  $("#gauge").querySelectorAll("button").forEach(b => b.onclick = () => { level = +b.dataset.l; store.set("ps_level", String(level)); drawGauge(); });
  const lv = E.LEVELS[level - 1];
  $("#lvName").textContent = `第 ${level} 挡 · ${lv.name}${level === E.DEFAULT_LEVEL ? "（推荐）" : ""}`;
  $("#lvTarget").textContent = `摘要 ≤ ${Math.round(lv.summary * 100)}%　正文 ≤ ${Math.round(lv.body * 100)}%`;
  $("#lvTone").textContent = lv.tone;
}
$("#gauge").addEventListener("keydown", e => {
  if (detecting) return;
  if (e.key === "ArrowRight" || e.key === "ArrowUp") level = Math.min(10, level + 1);
  else if (e.key === "ArrowLeft" || e.key === "ArrowDown") level = Math.max(1, level - 1);
  else return;
  e.preventDefault(); store.set("ps_level", String(level)); drawGauge(); $("#gauge").querySelector(".cur")?.focus();
});
drawGauge();

/* ---------------- 设置 ---------------- */
// 检查项：首次默认勾选两项本地检查（不调用 API），之后记住上次的选择
function syncMode() {
  const selected = [...document.querySelectorAll("#mode input:checked")].map(x => x.dataset.check);
  mode = selected.includes("dup") ? (selected.includes("def") ? "" : "dup") : selected.includes("def") ? "def" : "none";
  store.set("ps_checks", selected.join(","));
}
{
  const saved = store.get("ps_checks");
  const want = saved == null ? ["dup", "def"] : saved.split(",").filter(Boolean);
  document.querySelectorAll("#mode input").forEach(x => x.checked = want.includes(x.dataset.check));
  syncMode();
}
document.querySelectorAll("#mode input").forEach(input => input.onchange = () => { syncMode(); render(); });
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
  function open() { if (detecting || !st.enabled) return; pop.classList.add("open"); q.value = ""; draw(); setTimeout(() => q.focus(), 0); ul.querySelector(".sel")?.scrollIntoView({ block: "center" }); }
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
const chat = Combo($("#cmChat"), { placeholder: "填好 key 后自动列出", onChange: v => { if (v) store.set("ps_model", v); syncOpts(); if (typeof loadPrice === "function") loadPrice(); } });
const embed = Combo($("#cmEmbed"), { placeholder: "不使用", onChange: v => { if (v) store.set("ps_embed", v); syncOpts(); } });
function syncOpts() {
  const hasChat = !!chat.value, hasEmbed = !!embed.value;
  for (const [l, i, ok] of [["#lReview", "#oReview", hasChat], ["#lEmbed", "#oEmbed", hasEmbed]]) {
    $(l).classList.toggle("disabled", !ok); $(i).disabled = !ok;
  }
  if (hasEmbed && !$("#oEmbed")._touched) $("#oEmbed").checked = true;
}
$("#oEmbed").onchange = e => e.target._touched = true;

/* ---------------- 余额与消耗 ---------------- */
let provider = null, balance = null, balBusy = false, lastBalAt = 0, balancePromise = null;
let billingTimers = [], billingGeneration = 0, billingOwner = "", billingBaseline = null;
let billingStorageKey = null, billingStorageOwner = "";
async function restoreBilling(account) {
  if (billingStorageOwner === account) return;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(account));
  const storageKey = "papersim-billing-" + [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, "0")).join("");
  if (account !== billingIdentity()) return;
  billingStorageOwner = account; billingStorageKey = storageKey;
  billingBaseline = null; costByBalance = null; billingOwner = account;
  let saved = null;
  try { saved = JSON.parse(sessionStorage.getItem(storageKey)); } catch { }
  const validBalance = b => b && typeof b.currency === "string" && [b.amount, b.used].some(Number.isFinite);
  const validUsage = u => u && ["calls", "input", "output", "cached", "embed"].every(k => Number.isFinite(u[k]) && u[k] >= 0);
  if (validBalance(saved?.baseline) && validUsage(saved?.usage)) {
    billingBaseline = saved.baseline; usage = saved.usage;
  } else usage = { calls: 0, input: 0, output: 0, cached: 0, embed: 0 };
}
function saveBilling() {
  if (!billingStorageKey || billingStorageOwner !== billingIdentity()) return;
  try {
    if (billingBaseline) sessionStorage.setItem(billingStorageKey, JSON.stringify({ baseline: billingBaseline, usage }));
    else sessionStorage.removeItem(billingStorageKey);
  } catch { }
}
function beginBilling(before) {
  if (!billingBaseline && before && (Number.isFinite(before.amount) || Number.isFinite(before.used))) {
    billingBaseline = { amount: before.amount, used: before.used, currency: before.currency };
    billingOwner = billingIdentity(); saveBilling();
  }
}
function reconcileBalance(current) {
  if (!billingBaseline || billingOwner !== billingIdentity() || billingBaseline.currency !== current.currency) return;
  const delta = Number.isFinite(billingBaseline.amount) && Number.isFinite(current.amount) ? billingBaseline.amount - current.amount
    : Number.isFinite(billingBaseline.used) && Number.isFinite(current.used) ? current.used - billingBaseline.used : null;
  if (delta != null) costByBalance = delta >= 0 ? { amount: Math.round(delta * 1e8) / 1e8, currency: current.currency } : null;
  showUsage(usage);
  if (delta < 0) $("#costS").textContent = "余额增加或发生充值，无法直接按余额差核算；请参考服务商账单";
  else if (delta === 0 && usage.calls) $("#costS").textContent = "余额尚未变化，正在自动复查延迟扣费；也可随时点刷新";
  snapshotAccount();
}
const billingIdentity = () => `${provider}|${$("#base").value.trim()}|${$("#key").value.trim()}`;
const SYM = { CNY: "¥", USD: "$" };
const money = (x, cur) => x == null || isNaN(x) ? "—" : `${SYM[cur] || ""}${Math.abs(x) < 1 ? x.toFixed(4) : x.toFixed(2)}`;
async function refreshBalance(quiet = false) {
  const key = $("#key").value.trim();
  if (!key || !provider) { $("#balV").textContent = "—"; $("#balS").textContent = "填好 key 后自动查询"; return null; }
  if (!E.balanceSupported(provider)) { $("#balV").textContent = "—"; $("#balS").textContent = "该服务商没有公开的余额查询接口，请在官网控制台查看"; return null; }
  await restoreBilling(billingIdentity());
  if (balancePromise) { await balancePromise; return refreshBalance(quiet); }
  balBusy = true; if (!quiet) $("#balS").textContent = "查询中…";
  const account = `${provider}|${$("#base").value.trim()}|${key}`;
  let r;
  try {
    balancePromise = E.getBalance(provider, $("#base").value.trim(), key);
    r = await balancePromise;
  } finally { balancePromise = null; balBusy = false; }
  if (account !== `${provider}|${$("#base").value.trim()}|${$("#key").value.trim()}`) return null;
  balBusy = false; lastBalAt = Date.now();
  if (r.ok) {
    balance = r;
    $("#balV").textContent = r.amount != null ? money(r.amount, r.currency) : `已用 ${money(r.used, r.currency)}`;
    $("#balS").textContent = `${r.detail} · ${new Date(r.at).toLocaleTimeString()}`;
    showUsage(usage); reconcileBalance(r); snapshotAccount(); return r;
  }
  $("#balV").textContent = "—"; $("#balS").textContent = r.reason + (!E.net.proxied && /浏览器/.test(r.reason) ? "（本地版可查）" : "");
  snapshotAccount(); return null;
}
$("#balRf").onclick = () => refreshBalance();

function priceKey() { return "ps_price_" + (chat.value || "_"); }
function loadPrice() {
  let p = null; try { p = JSON.parse(store.get(priceKey()) || "null"); } catch (e) { }
  $("#pIn").value = p?.in ?? ""; $("#pOut").value = p?.out ?? "";
  $("#pCur").value = p?.cur || (["openai", "openrouter", "anthropic", "gemini"].includes(provider) ? "USD" : "CNY");
}
function savePrice() { store.set(priceKey(), JSON.stringify({ in: $("#pIn").value, out: $("#pOut").value, cur: $("#pCur").value })); showUsage(usage); }
["#pIn", "#pOut", "#pCur"].forEach(id => $(id).addEventListener("change", savePrice));

let usage = { calls: 0, input: 0, output: 0, cached: 0, embed: 0 }, costByBalance = null;
const fmtN = n => n.toLocaleString("en-US");
function estimate(u) {
  const pi = parseFloat($("#pIn").value), po = parseFloat($("#pOut").value);
  if (isNaN(pi) && isNaN(po)) return null;
  return ((u.input * (pi || 0)) + (u.output * (po || 0))) / 1e6;
}
function showUsage(u) {
  usage = u;
  $("#useS").textContent = `${u.calls} 次调用 · 输入 ${fmtN(u.input)} · 输出 ${fmtN(u.output)} tokens` + (u.cached ? ` · 缓存命中 ${fmtN(u.cached)}` : "") + (u.embed ? ` · 向量 ${fmtN(u.embed)}` : "");
  const est = estimate(u), cur = $("#pCur").value;
  if (costByBalance) { $("#costV").textContent = money(costByBalance.amount, costByBalance.currency); $("#costS").textContent = "按本轮检测开始以来的余额差计算（含续聊）" + (est != null ? ` · 按单价估算 ${money(est, cur)}` : ""); }
  else if (est != null) { $("#costV").textContent = "≈ " + money(est, cur); $("#costS").textContent = "按你填的单价估算"; }
  else if (u.calls) { $("#costV").textContent = "—"; $("#costS").textContent = "在“服务商、地址与单价”里填写单价即可估算金额"; }
  saveBilling(); snapshotAccount();
  if (detecting && u.calls && Date.now() - lastBalAt > 8000 && balance) refreshBalance(true);   // 运行中顺带刷新余额
}

function snapshotAccount() {
  if (last) { last.accountText = $("#meter").innerText; last.usage = { ...usage }; }
}
function stopBillingPolls() { billingGeneration++; billingTimers.forEach(clearTimeout); billingTimers = []; }
async function settleBilling(before, previousCost, generation) {
  beginBilling(before);
  const account = billingIdentity();
  const update = async () => {
    if (generation !== billingGeneration || account !== billingIdentity()) return;
    await refreshBalance(true);
    if (generation !== billingGeneration) return;
    snapshotAccount();
  };
  await update();
  if (E.balanceSupported(provider)) for (const delay of [2000, 5000, 10000, 20000, 40000, 60000, 90000, 120000]) billingTimers.push(setTimeout(() => update().catch(e => { $("#balS").textContent = "自动更新余额失败：" + e.message; snapshotAccount(); }), delay));
}

/* ---------------- API 识别 ---------------- */
$("#prov").innerHTML = `<option value="">自动识别</option>` + Object.entries(E.PROVIDERS).map(([k, p]) => `<option value="${k}">${esc(p.name)}</option>`).join("") + `<option value="custom">自定义地址</option>`;
let seq = 0, timer = null;
function status(kind, text) { $("#st").className = "status " + kind; $("#stT").textContent = text; }
function showErr(t) { const e = $("#err"); e.textContent = t || ""; e.style.display = t ? "block" : "none"; }

async function detectModels(autoOpen = true) {
  const key = $("#key").value.trim(), my = ++seq;
  showErr("");
  if (!key) { status("", "未填写"); chat.disable(); embed.disable(); syncOpts(); provider = null; refreshBalance(); return; }
  if (key.length < 16) { status("", "key 太短"); return; }
  status("busy", "识别中…");
  const base = $("#base").value.trim();
  const r = await E.detect(key, base || null);
  if (my !== seq) return;
  if (r.base && !base) $("#base").value = r.base;
  if (r.provider) $("#prov").value = E.PROVIDERS[r.provider] ? r.provider : "custom";
  provider = r.provider || null; balance = null;
  refreshBalance();
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
const client = (track = true) => chat.value ? new E.Client({ key: $("#key").value.trim(), base: $("#base").value.trim(), model: chat.value, embedModel: embed.value || null, onUsage: track ? showUsage : null }) : null;
$("#testBtn").onclick = async () => {
  const out = $("#testOut");
  if (!chat.value) { out.textContent = "请先选择模型"; return; }
  out.style.color = ""; out.textContent = "测试中…";
  try { const r = await client(false).chatText("只回复两个字：可用", 0); out.textContent = `✓ 可用（模型回复：${r.trim().slice(0, 30)}）`; out.style.color = "var(--ok)"; }
  catch (e) { out.textContent = `✗ ${e.message}`; out.style.color = "var(--dup)"; }
};
if (store.get("ps_remember")) { $("#remember").checked = true; const k = store.get("ps_key"); if (k) { $("#key").value = k; setTimeout(() => detectModels(false), 300); } }
chat.disable(); embed.disable(); syncOpts();

/* ---------------- 运行 ---------------- */
$("#run").onclick = async () => {
  if (blocked() || !files.papers.length) return;
  const selected = [...document.querySelectorAll("#mode input:checked")].map(x => x.dataset.check);
  if (!selected.length) { toast("请至少勾选一个检查方面"); return; }
  if ((selected.includes("logic") || selected.includes("hallucination") || selected.includes("polish")) && (!chat.value || !$("#key").value.trim())) { toast("逻辑、幻觉风险和学术润色指导需要填写 API Key 并选择对话模型"); return; }
  if (selected.includes("dup") && files.papers.length + files.corpus.length < 2) { toast("重复率至少需要两篇：再放一篇被测论文或比对库，或取消勾选“重复率”"); $("#log").textContent = "重复率至少需要两篇论文"; return; }
  const btn = $("#run"), log = $("#log");
  stopBillingPolls(); billingOwner = billingIdentity(); billingBaseline = null; saveBilling();
  last = null;
  $("#dlPdf").disabled = true;
  $("#runSummary").innerHTML = '<h3>检测进行中</h3><p>本次完成后更新参数与结果。</p>';
  $("#papers").innerHTML = "";
  const settings = { mode: mode || "全部", level, threshold: +$("#para").value,
    embedText: false, model: chat.value || "未使用",
    review: selected.includes("def") && $("#oReview").checked && !$("#oReview").disabled,
    semantic: selected.includes("dup") && $("#oEmbed").checked && !$("#oEmbed").disabled,
    apply: false,
    corpus: files.corpus.length, exclude: files.exclude.length, logic: selected.includes("logic"), hallucination: selected.includes("hallucination"), polish: selected.includes("polish") };
  const configuredClient = client();
  costByBalance = null; showUsage({ calls: 0, input: 0, output: 0, cached: 0, embed: 0 });
  $("#costV").textContent = "—"; $("#costS").textContent = "本次尚未产生 API 消耗";
  log.style.color = "";
  let completed = false, failure = null, before = null, useLLM = false;
  lockDetection(true);
  const say = async m => { log.textContent = "检测中 · " + m; setProgress(progressValue, m); await tick(); };
  try {
    await say("加载检测资源…");
    await lexReady;
    setProgress(3, "检测资源已就绪");
    const lex = E.compileLexicon(LEX);
    const all = [...files.papers.map(f => ["papers", f]), ...files.corpus.map(f => ["corpus", f]), ...files.exclude.map(f => ["exclude", f])];
    const got = { papers: [], corpus: [], exclude: [] };
    for (let i = 0; i < all.length; i++) {
      const [g, f] = all[i];
      await say(`读取文件 ${i + 1}/${all.length}：${f.name}`);
      try { got[g].push(await readDoc(f, g === "exclude")); }
      catch (e) { throw new Error(`读取 ${f.name} 失败：${e.message}`); }
      setProgress(3 + 27 * (i + 1) / all.length, `已读取 ${i + 1}/${all.length} 个文件`);
    }
    for (const d of got.papers) if (d.sentences.length < 3) toast(`${d.name} 几乎没抽出文字，可能是扫描版 PDF`);
    useLLM = configuredClient && (settings.review || settings.apply || settings.semantic || settings.logic || settings.hallucination || settings.polish);
    if (useLLM) {
      costByBalance = null;
      $("#costV").textContent = "…"; $("#costS").textContent = "运行中，实时统计";
      before = await refreshBalance(true);
      beginBilling(before);
    }
    const res = await E.run({
      docs: got.papers, corpus: got.corpus, exclude: got.exclude, lex, client: useLLM ? configuredClient : null, log: say, progress: (done, total) => setProgress(30 + 60 * done / total),
      opt: {
        only: settings.mode === "全部" ? null : settings.mode, paraThreshold: settings.threshold, level: settings.level,
        embedText: settings.embedText, llmReview: settings.review,
        llmEmbed: settings.semantic, apply: settings.apply, logic: settings.logic, hallucination: settings.hallucination, polish: settings.polish,
      }
    });
    setProgress(92, "正在整理检测结果…");
    last = { ...res, runTime: Date.now(), corpusDocs: got.corpus, excludeDocs: got.exclude, settings, lex, targets: [E.LEVELS[settings.level - 1].summary, E.LEVELS[settings.level - 1].body] };
    if (useLLM) { await say("自动更新余额与消耗…"); await settleBilling(before, null, billingGeneration); }
    snapshotAccount();
    showResults(last);
    saveHistory(last);
    setProgress(100, "全部检测与报告整理已完成"); completed = true;
  } catch (e) {
    failure = e.message; last = null;
    if (useLLM) await settleBilling(before, null, billingGeneration).catch(err => console.error(err));
    $("#runSummary").textContent = "本次检测未完成：" + e.message;
    console.error(e);
  } finally {
    lockDetection(false); render();
    if (completed) { log.textContent = "检测完成"; $("#progressState").textContent = "检测完成"; }
    else {
      $("#progressState").textContent = "检测未完成，可重新检测";
      $("#runProgress").classList.add("failed");
      setProgress(progressValue, failure || "检测未完成");
      log.textContent = "出错：" + (failure || "检测未完成"); log.style.color = "var(--dup)";
      $("#dlPdf").disabled = true;
    }
  }
};

/* ---------------- 结果 ---------------- */
function track(x, color, tgt, scale = 1) {
  const w = Math.min(100, (x || 0) / scale * 100);
  return `<div class="track"><div class="fill" style="width:${w}%;background:${color};color:${color}"></div>${tgt != null ? `<div class="tgt" style="left:${Math.min(100, tgt / scale * 100)}%" title="目标 ${pct(tgt, 0)}"></div>` : ""}</div>`;
}
function highlightDup(text, spans) {
  const prio = { excluded: 1, paraphrase: 2, exact: 3 }, kind = new Array(text.length).fill(null), src = new Array(text.length).fill("");
  for (const [a, b, k, s] of spans) for (let i = a; i < Math.min(b, text.length); i++) if (!kind[i] || prio[k] > prio[kind[i]]) { kind[i] = k; src[i] = s; }
  const col = { exact: "rgba(255,60,142,.38)", paraphrase: "rgba(255,176,0,.32)", excluded: "rgba(143,92,255,.28)" }, tip = { exact: "逐字重复", paraphrase: "改写相似", excluded: "赛题原文" };
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
  for (const [a, b, c] of matches) { if (a < pos) continue; out += esc(sent.slice(pos, a)) + `<mark style="background:${CAT_COLOR[c]}33;color:inherit;border-bottom:2px solid ${CAT_COLOR[c]}">${esc(sent.slice(a, b))}</mark>`; pos = b; }
  return out + esc(sent.slice(pos));
}
function paperCard(r, k) {
  const { docs, dup, dfn, prompts, suggestions, lex, targets: [tS, tB] } = r;
  const doc = docs[k], d = dup[k], f = dfn[k], p = prompts[k], cats = lex.categories;
  const dupBox = d ? `<div class="metric dup"><div class="lab">总重复率</div><div class="big">${pct(d.total)}</div>${track(d.total, "var(--magenta)", null, .5)}
    <div class="kv"><span>逐字 <b>${pct(d.exact)}</b></span><span>改写 <b>${pct(d.paraphrase)}</b></span><span>赛题引用 <b>${pct(d.excluded)}</b></span>
    ${Object.keys(d.bySource).length ? `<span>最相似：<b>${esc(Object.keys(d.bySource)[0])}</b> ${pct(Object.values(d.bySource)[0])}</span>` : ""}</div></div>` : "";
  const cls = (x, t) => x == null ? "" : (x <= t ? "good" : "bad");
  const defBox = f ? `<div class="metric def"><div class="lab">防御性语言率</div><div class="big">${pct(f.rate)}</div>${track(f.rate, "var(--cyan)", tB, .5)}
    <div class="kv"><span>摘要 <b class="${cls(f.summary, tS)}">${pct(f.summary, 0)}</b> / 目标 ${pct(tS, 0)}</span><span>正文 <b class="${cls(f.body, tB)}">${pct(f.body, 0)}</b> / 目标 ${pct(tB, 0)}</span>
    <span>强度 <b>${f.intensity.toFixed(1)}</b> 分/千词</span>${f.llmRate != null ? `<span>大模型复核 <b>${pct(f.llmRate)}</b></span>` : ""}</div>
    <div class="cats">${Object.entries(f.byCategory).map(([c, v]) => `<span>${esc(cats[c].label)}</span><div class="bar" style="width:${Math.max(2, v * 200)}%;background:${CAT_COLOR[c]}"></div><span>${pct(v, 0)}</span>`).join("")}</div></div>` : "";
  const tabs = [["prompt", r.settings.polish ? "学术润色指导提示词" : "优化提示词"], ...(f ? [["defs", `防御句 ${f.hits.length}`]] : []), ...(d ? [["pairs", `相似句 ${d.pairs.length}`], ["full", "重复高亮"]] : [])];
  return `<section class="card paper" data-k="${k}">
    <h3>${esc(doc.name)}</h3><div class="meta">${doc.nWords} 词 · ${doc.sentences.length} 句</div>
    <div class="metrics">${dupBox}${defBox}</div>${auditPanel(r.audits?.[k])}${writingPanel(r.writing?.[k])}
    <div class="tabs">${tabs.map(([id, t], i) => `<button data-t="${id}" class="${i ? "" : "on"}">${t}</button>`).join("")}</div>
    <div class="pane on" data-p="prompt">${r.settings.polish ? '<p class="hint">已结合三套资料生成论文专属指导。复制本提示词并另附原文交给模型执行；正文未被修改。支持在下方继续对话完善指导，或随报告导出 PDF。</p>' : ""}<div class="acts"><button class="btn sm cp">复制提示词</button><button class="btn sm dl">下载 .md</button></div><textarea class="prompt" readonly>${esc(p)}</textarea></div>
    ${f ? `<div class="pane" data-p="defs">${f.hits.length ? [...f.hits].sort((a, b) => b.score - a.score).map(h => `<div class="sent"><div class="t">${h.index < doc.summaryCutoff ? "摘要" : "正文"} · ${h.categories.map(c => cats[c].label).join("、")} · 得分 ${h.score}</div>${highlightDef(h.text, h.matches)}</div>`).join("") : `<div class="none">没有检出防御性句</div>`}
      ${f.llmHits.length ? `<div class="hint" style="margin-top:12px">大模型额外判定的防御句：</div>` + f.llmHits.map(h => `<div class="sent"><div class="t">${esc(h.category)}</div>${esc(h.text)}</div>`).join("") : ""}</div>` : ""}
    ${d ? `<div class="pane" data-p="pairs">${d.pairs.length ? d.pairs.map(([s, a, src, b]) => `<div class="pair"><span class="s">${pct(s, 0)}</span> · 来源 ${esc(src)}<br>本文：${esc(a)}<br>来源：${esc(b)}</div>`).join("") : `<div class="none">没有相似句</div>`}</div>
      <div class="pane" data-p="full"><div class="legend"><span><i style="background:rgba(255,60,142,.6)"></i>逐字重复</span><span><i style="background:rgba(255,176,0,.55)"></i>改写相似</span><span><i style="background:rgba(143,92,255,.5)"></i>赛题原文</span></div><div class="fulltext">${highlightDup(doc.text, d.spans)}</div></div>` : ""}
  </section>`;
}
function writingPanel(summary) {
  if (!summary) return "";
  const contextRejected = summary.contextRejected || 0, review = (summary.needsVisualReview || 0) + (summary.needsContentReview || 0);
  return `<section class="paper-audits" role="status"><h4>润色指导 · 建议校验说明</h4><p>${summary.verified} 条建议可定位，${summary.required != null ? `其中 ${summary.required} 条标为必要修正、${summary.optional} 条为可选优化；` : ""}未发现已检查的上下文冲突；这不代表建议全部正确。${summary.rejected ? `另有 ${summary.rejected} 条引用未定位，已排除对应问题。` : ""}${contextRejected ? `已排除 ${contextRejected} 条与已提供章节或文献信息冲突的建议。` : ""}${review ? `${review} 条涉及版式、完整性或术语上下文的疑问仅列为待核对，不作为改稿指令。` : ""}</p></section>`;
}
function auditPanel(audit) {
  if (!audit) return "";
  return `<section class="paper-audits">${audit.error ? `<p class="audit-error">专项检查没有完成：${esc(audit.error)}。其他检测结果不受影响，可以重新检测再试。</p>` : ""}${[["logic", "论文逻辑检查"], ["hallucination", "幻觉风险 · 待核实"]].filter(([key]) => audit[key] !== null).map(([key, label]) => `<h4>${label}</h4><p class="hint">${key === "hallucination" ? "依据论文内容提出的核查线索，未联网核实，不能据此断定事实或文献虚假。处理要求已写入优化提示词。" : "模型提出的逻辑疑点，需要结合公式、数据与上下文复核。处理要求已写入优化提示词。"}</p>${audit[key].length ? audit[key].map(item => `<article class="sent"><div class="t">${({high:"优先核查",medium:"建议核查",low:"补充说明"})[item.severity]} · ${esc(item.status)}</div><blockquote>${esc(item.quote)}</blockquote><p>${esc(item.issue)}</p></article>`).join("") : '<p class="none">未发现能定位到原文的风险项；不代表已完成正确性验证。</p>'}`).join("")}${audit.rejected ? `<p class="hint">模型另有 ${audit.rejected} 条输出无法定位原文或缺少必要信息，未作为检查结论。</p>` : ""}</section>`;
}
function summaryPanel(r) {
  const s = r.settings;
  return `<h3>本次检测参数</h3><dl class="summary-grid">${Object.entries({
    "被测论文": r.docs.length + " 篇", "比对库": s.corpus + " 篇", "赛题原文": s.exclude + " 篇",
    "检测内容": ({dup:"重复率",def:"防御性语言",none:"仅模型专项检查"})[s.mode] || "全部", "防御率挡位": s.level,
    "摘要 / 正文目标": r.targets.map(x => pct(x,0)).join(" / "), "改写相似阈值": s.threshold,
    "对话模型": s.model,
    "防御句复核": s.review ? "开启" : "关闭", "语义检测": s.semantic ? "开启" : "关闭",
    "论文逻辑检查": s.logic ? "勾选" : "未勾选", "幻觉风险检查": s.hallucination ? "勾选" : "未勾选",
    "学术润色指导": s.polish ? "勾选 · 生成指导，不直接改稿" : "未勾选"
  }).map(([k,v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl>`;
}
function showResults(r) {
  const banner = $("#histBanner");
  if (banner) { banner.hidden = !r.fromHistory; if (r.fromHistory) banner.textContent = `正在查看 ${fmtTime(r.fromHistory)} 的历史结果。账户余额与消耗显示的是当前账户，不是当时的数据。`; }
  document.querySelectorAll(".hist-item").forEach(el => el.classList.toggle("current", r.fromHistory && +el.dataset.time === r.fromHistory));
  $("#dlPdf").disabled = false;
  $("#results").style.display = "block";
  $("#runSummary").innerHTML = summaryPanel(r);
  $("#papers").innerHTML = r.docs.map((_, k) => paperCard(r, k)).join("");
  document.querySelectorAll(".paper").forEach(card => {
    const k = +card.dataset.k;
    card.querySelectorAll(".tabs button").forEach(b => b.onclick = () => {
      card.querySelectorAll(".tabs button").forEach(x => x.classList.toggle("on", x === b));
      card.querySelector(`[data-p="${b.dataset.t}"]`)?.scrollIntoView({ behavior: scrollMode(), block: "start" });
    });
    card.querySelector(".cp").onclick = () => copy(r.prompts[k]);
    card.querySelector(".dl").onclick = () => download(`${r.docs[k].name}_优化提示词.md`, r.prompts[k], "text/markdown");
  });
window.dispatchEvent(new CustomEvent("papersim:results", { detail: { runId: r.fromHistory || r.runTime, fromHistory: !!r.fromHistory } }));
  
$("#results").scrollIntoView({ behavior: scrollMode() });
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
  const rows = [["论文", "词数", "句数", "总重复率", "文字复制比", "改写相似比", "赛题引用比", "最相似来源", "最相似来源重复率", "防御性语言率", "摘要防御率", "正文防御率", "防御强度", "大模型防御率", "逻辑风险数", "待核实事实风险数"]];
  last.docs.forEach((d, i) => {
    const u = last.dup[i], f = last.dfn[i], top = u ? Object.entries(u.bySource)[0] || ["", 0] : ["", null];
    rows.push([d.name, d.nWords, d.sentences.length, f4(u?.total), f4(u?.exact), f4(u?.paraphrase), f4(u?.excluded), top[0], f4(top[1]),
      f4(f?.rate), f4(f?.summary), f4(f?.body), f ? f.intensity.toFixed(2) : "", f4(f?.llmRate), last.audits?.[i]?.logic?.length ?? "", last.audits?.[i]?.hallucination?.length ?? ""]);
  });
  download(`papersim_${stamp()}.csv`, "﻿" + rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\r\n"), "text/csv");
};
$("#dlJson").onclick = () => {
  if (!last) return;
  const out = last.docs.map((d, i) => ({ name: d.name, words: d.nWords, sentences: d.sentences.length, duplication: last.dup[i], defensive: last.dfn[i], audits: last.audits?.[i], writing: last.writing?.[i], settings: last.settings, prompt: last.prompts[i], usage: last.usage, account: last.accountText }));
  download(`papersim_${stamp()}.json`, JSON.stringify(out, null, 1), "application/json");
};
$("#dlReport").onclick = () => {
  if (!last) return;
  const css = [...document.styleSheets].map(s => { try { return [...s.cssRules].map(r => r.cssText).join("\n"); } catch (e) { return ""; } }).join("\n");
  const body = summaryPanel(last) + `<section class="card"><h3>账户与用量</h3><pre>${esc(last.accountText)}</pre></section>` + last.docs.map((_, k) => paperCard(last, k)).join("");
  const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>papersim 报告</title><style>${css}
    .wrap{margin:0 auto!important;max-width:1200px}.pane{display:block!important;margin-bottom:16px}.tabs{display:none}textarea.prompt{height:auto;min-height:300px}.fulltext,.md{max-height:none}</style></head>
    <body><div class="wrap"><header><h1>papersim 报告</h1><span class="sub">${new Date().toLocaleString()}</span></header>${body}</div></body></html>`;
  download(`papersim_报告_${stamp()}.html`, html, "text/html");
};
render();

function pdfBlocks(r) {
  const blocks = [{ heading: true, text: "综合检测结果" },
    { heading: true, text: "本次参数" }];
  const summary = document.createElement("div"); summary.innerHTML = summaryPanel(r);
  summary.querySelectorAll(".summary-grid > div").forEach(el => blocks.push({ text: el.querySelector("dt").textContent + "：" + el.querySelector("dd").textContent }));
  blocks.push({ heading: true, text: "账户与本次消耗" }, { text: r.accountText || "未调用大模型" });
  r.docs.forEach((doc, i) => {
    const d = r.dup[i], f = r.dfn[i];
    blocks.push({ heading: true, text: `${i + 1}. ${doc.name}` }, { text: `${doc.nWords} 词 / ${doc.sentences.length} 句` });
    if (d) {
      blocks.push({ text: `总重复率 ${pct(d.total)}；逐字 ${pct(d.exact)}；改写 ${pct(d.paraphrase)}；赛题引用 ${pct(d.excluded)}` });
      Object.entries(d.bySource).forEach(([name, rate]) => blocks.push({ text: `来源：${name} / ${pct(rate)}` }));
    }
    if (f) {
      blocks.push({ text: `防御性语言率 ${pct(f.rate)}；摘要 ${pct(f.summary)}；正文 ${pct(f.body)}；强度 ${f.intensity.toFixed(2)} 分/千词；大模型复核 ${pct(f.llmRate)}` });
      Object.entries(f.byCategory).forEach(([key, rate]) => blocks.push({ text: `${r.lex.categories[key].label}：${pct(rate)}` }));
    }
    for (const [kind, label] of [["logic", "论文逻辑检查"], ["hallucination", "幻觉风险检查 · 未联网核实"]]) {
      const items = r.audits?.[i]?.[kind];
      if (items) { blocks.push({ heading: true, text: label }); if (!items.length) blocks.push({ text: "未发现可定位风险，不代表已验证正确性。" }); items.forEach(item => blocks.push({ text: `原文：${item.quote}\n疑点：${item.issue}（${item.status}）` })); }
    }
    if (f?.hits.length) blocks.push({ heading: true, text: "防御性语言与依据" });
    f?.hits.forEach(h => blocks.push({ text: `第 ${h.index + 1} 句 / 得分 ${h.score} / ${h.categories.map(c => r.lex.categories[c].label).join("、")}
${h.text}` }));
    f?.llmHits.forEach(h => blocks.push({ text: `大模型额外复核 / ${h.category}
${h.text}` }));
    if (d?.pairs.length) blocks.push({ heading: true, text: "相似句与来源" });
    d?.pairs.forEach(([rate, text, source, original]) => blocks.push({ text: `相似度 ${pct(rate)} / 来源 ${source}
本文：${text}
来源原文：${original}` }));
    blocks.push({ heading: true, text: "专项优化提示词" }, { text: r.prompts[i] });
  });
  return blocks;
}
$("#dlPdf").onclick = async () => {
  if (!last) return;
  const btn = $("#dlPdf"), r = last, blocks = pdfBlocks(r);
  btn.disabled = true;
  try {
    btn.textContent = "正在生成 PDF…";
    const blob = await reportPdf(blocks, n => btn.textContent = `正在生成 PDF · ${n} 页`);
    const url = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = url; a.download = `papersim_综合报告_${stamp()}.pdf`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 60000); toast("PDF 已生成，正在下载");
  } catch (e) { toast("PDF 导出失败：" + e.message); console.error(e); }
  finally { btn.textContent = "一键下载 PDF 报告 ↓"; btn.disabled = !last; }
};


/* ---------------- 最近查询（只保存在本机浏览器的 IndexedDB） ---------------- */
const HIST_MAX = 10;
const fmtTime = t => { const d = new Date(t); return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
const idbReq = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
let histDbPromise = null;
function histDb() {
  if (!histDbPromise) histDbPromise = new Promise((res, rej) => {
    if (!window.indexedDB) return rej(new Error("当前浏览器不支持本地保存"));
    const r = indexedDB.open("papersim-history", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("runs", { keyPath: "id", autoIncrement: true });
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  return histDbPromise;
}
async function histStore(mode) { return (await histDb()).transaction("runs", mode).objectStore("runs"); }
async function histAll() { return (await idbReq((await histStore("readonly")).getAll())).sort((a, b) => b.time - a.time); }

function toRecord(r) {
  return {
    time: r.runTime || Date.now(), settings: r.settings, targets: r.targets, accountText: r.accountText || "",
    docs: r.docs.map(d => ({ name: d.name, text: d.text, sentences: d.sentences, summaryCutoff: d.summaryCutoff, nWords: d.nWords, sourceText: d.sourceText, sourceFormat: d.sourceFormat, extraction: d.extraction })),
    dup: r.dup, dfn: r.dfn, audits: r.audits || null, writing: r.writing || null, prompts: r.prompts,
  };
}
async function saveHistory(r) {
  try {
    const rec = JSON.parse(JSON.stringify(toRecord(r)));
    await idbReq((await histStore("readwrite")).add(rec));
    const all = await histAll();
    for (const old of all.slice(HIST_MAX)) await idbReq((await histStore("readwrite")).delete(old.id));
  } catch (e) { console.error("保存历史记录失败", e); }
  renderHistory();
}
async function renderHistory() {
  const box = $("#histList"); if (!box) return;
  let all;
  try { all = await histAll(); }
  catch (e) { box.innerHTML = `<p class="none">${esc(e.message)}，无法保存历史记录。</p>`; return; }
  $("#histClear").hidden = !all.length;
  if (!all.length) { box.innerHTML = '<p class="none">还没有查询记录。完成一次检测后会自动保存在这里。</p>'; return; }
  box.innerHTML = all.map(rec => {
    const rows = rec.docs.slice(0, 4).map((d, i) => {
      const u = rec.dup?.[i], f = rec.dfn?.[i], a = rec.audits?.[i];
      const bits = [u ? `重复率 <b>${pct(u.total)}</b>` : "", f ? `防御率 <b>${pct(f.rate)}</b>` : "",
        a?.logic ? `逻辑 <b>${a.logic.length}</b> 处` : "", a?.hallucination ? `待核实 <b>${a.hallucination.length}</b> 处` : ""].filter(Boolean).join("　");
      return `<li><span class="hist-name">${esc(d.name)}</span><span class="hist-m">${bits || "—"}</span></li>`;
    }).join("") + (rec.docs.length > 4 ? `<li class="hist-more">另有 ${rec.docs.length - 4} 篇</li>` : "");
    return `<article class="hist-item${last?.fromHistory === rec.time ? " current" : ""}" data-time="${rec.time}">
      <div class="hist-top"><b>${fmtTime(rec.time)}</b><span>${rec.docs.length} 篇 · 第 ${rec.settings?.level ?? "—"} 挡</span>
        <span class="hist-acts"><button class="btn sm" data-view="${rec.id}">查看</button><button class="btn sm ghost" data-del="${rec.id}">删除</button></span></div>
      <ul>${rows}</ul></article>`;
  }).join("");
  box.querySelectorAll("[data-view]").forEach(b => b.onclick = () => viewHistory(+b.dataset.view));
  box.querySelectorAll("[data-del]").forEach(b => b.onclick = async () => { await idbReq((await histStore("readwrite")).delete(+b.dataset.del)); renderHistory(); });
}
async function viewHistory(id) {
  if (detecting) { toast("检测进行中，完成后再查看历史"); return; }
  const rec = await idbReq((await histStore("readonly")).get(id));
  if (!rec) { renderHistory(); return; }
  await lexReady;
  last = { ...rec, suggestions: rec.docs.map(() => null), corpusDocs: [], excludeDocs: [], lex: E.compileLexicon(LEX), fromHistory: rec.time };
  showResults(last);
}
$("#histClear").onclick = async e => {
  const b = e.currentTarget;
  if (!b.dataset.armed) { b.dataset.armed = "1"; b.textContent = "再点一次确认清空"; setTimeout(() => { delete b.dataset.armed; b.textContent = "清空历史"; }, 3000); return; }
  delete b.dataset.armed; b.textContent = "清空历史";
  await idbReq((await histStore("readwrite")).clear());
  renderHistory(); toast("历史记录已清空");
};
window.addEventListener("papersim:prompt-updated", async e => {
  const { index, content: newPrompt, runId } = e.detail || {};
  if (last && typeof index === "number" && last.prompts && index < last.prompts.length) {
    last.prompts[index] = newPrompt;
  }
  if (!runId) return;
  try {
    const all = await histAll();
    const rec = all.find(x => x.time === runId);
    if (rec && rec.prompts && index < rec.prompts.length) {
      rec.prompts[index] = newPrompt;
      await idbReq((await histStore("readwrite")).put(rec));
    }
  } catch (err) { console.error("同步更新历史提示词失败", err); }
});
renderHistory();
