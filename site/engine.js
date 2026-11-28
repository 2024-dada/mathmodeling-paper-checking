import { loadWritingResources, generateWritingGuidance } from "./writing-guidance.js?v=context-review2";

// papersim 浏览器端引擎：与 Python 版 papersim 算法一致（抽取清洗、重复率、防御性语言率、优化提示词）。
// 浏览器和 Node 都可以 import。

/* ============================== 文本 ============================== */
const HEADER_PAT = /(Team\s*(#|Control)|Page\s+\d+(\s+of\s+\d+)?|Problem Chosen|Summary Sheet|^\s*\d+\s*$|第\s*\d+\s*页)/i;
const TOC_PAT = /(\.{4,}|(\s\.){4,}|…{2,})/;
const REF_PAT = /\n\s*(References|Bibliography|参考文献)\s*\n/i;
const SUMMARY_END = /\n\s*(Keywords?|关键词)\s*[:：]?/i;
const TOKEN_RE = () => /[一-鿿]|[A-Za-z]+(?:['’][A-Za-z]+)?|\d+(?:\.\d+)?/g;
const SENT_SPLIT = /(?<=[.!?;])\s+(?=[A-Z("“])|(?<=[。！？；])/;
const isAlpha = c => /\p{L}/u.test(c);

export function clean(raw, dropReferences = true) {
  const out = [];
  for (const ln of raw.split(/\r?\n/)) {
    const s = ln.trim();
    if (!s || HEADER_PAT.test(s) || TOC_PAT.test(s)) continue;
    let letters = 0;
    for (const c of s) if (isAlpha(c)) letters++;
    if (letters < 0.45 * [...s].length) continue;
    out.push(s.replace(/\s{2,}/g, " "));
  }
  let txt = out.join("\n");
  if (dropReferences) {
    const m = REF_PAT.exec(txt);
    if (m) txt = txt.slice(0, m.index);
  }
  return txt.replace(/(\w)-\n(\w)/g, "$1$2");
}

function tokCount(s) { return (s.match(TOKEN_RE()) || []).length; }

const MINOR = new Set("and of the a an for in on to by with vs or from at".split(" "));
function isHeading(line) {
  const s = line.trim();
  const n = tokCount(s);
  if (!(n > 0 && n <= 12) || /[.。:：;；,，?？!！)）]$/.test(s)) return false;
  if (/^(\d+(\.\d+)*\.?\s+\S|[一二三四五六七八九十]+、|(Table|Figure|Fig\.|表|图)\s*\d)/.test(s)) return true;
  const words = s.match(/[A-Za-z][\w’'-]*/g) || [];
  if (words.length) {
    const content = words.filter(w => !MINOR.has(w.toLowerCase()));
    const caps = content.filter(w => w[0] === w[0].toUpperCase() && /[A-Z]/.test(w[0])).length;
    return content.length > 0 && caps / content.length >= 0.6 && /[A-Z]/.test(s[0]);
  }
  return n <= 15 && /^[一-鿿]/.test(s);
}

export function splitSentences(text) {
  const blocks = []; let cur = [];
  for (const ln of text.split("\n")) {
    if (isHeading(ln)) { if (cur.length) { blocks.push(cur.join(" ")); cur = []; } }
    else cur.push(ln.trim());
  }
  if (cur.length) blocks.push(cur.join(" "));
  const out = [];
  for (const b of blocks) {
    const flat = b.replace(/\s+/g, " ");
    for (const s of flat.split(SENT_SPLIT)) if (s && tokCount(s) >= 4) out.push(s.trim());
  }
  return out;
}

export function tokenize(text) {
  const out = [];
  for (const m of text.matchAll(TOKEN_RE())) out.push([m[0].toLowerCase(), m.index, m.index + m[0].length]);
  return out;
}

export function makeDocument(text, name, cleaned = false, dropReferences = true) {
  const t = cleaned ? text : clean(text, dropReferences);
  const sentences = splitSentences(t);
  let summaryCutoff = 0;
  const m = SUMMARY_END.exec(t);
  if (m) summaryCutoff = splitSentences(t.slice(0, m.index)).length;
  const flat = t.replace(/\s+/g, " ");
  return { name, text: flat, sentences, summaryCutoff, nWords: tokCount(flat) };
}

/* ============================== 重复率 ============================== */
const isCJK = t => { let n = 0; for (const c of t) if (c >= "一" && c <= "鿿") n++; return n > 0.3 * Math.max(1, t.length); };
const STOP = new Set("the a an of and or to in on at for is are was were be by with as that this it its while when we our from than then into which these those can".split(" "));

function contentWords(s) {
  if (isCJK(s)) {
    const cs = s.replace(/[^一-鿿]/g, "");
    const set = new Set();
    for (let i = 0; i < cs.length - 1; i++) set.add(cs.slice(i, i + 2));
    return set;
  }
  return new Set((s.toLowerCase().match(/[a-z]+|\d+(?:\.\d+)?/g) || []).filter(w => !STOP.has(w)));
}

// difflib.SequenceMatcher.ratio 的近似：2*LCS块匹配/总长（Ratcliff/Obershelp）
function seqRatio(a, b) {
  if (!a.length && !b.length) return 1;
  function matches(a, b) {
    if (!a.length || !b.length) return 0;
    let best = 0, ai = 0, bi = 0;
    let prev = new Array(b.length + 1).fill(0);
    for (let i = 1; i <= a.length; i++) {
      const cur = new Array(b.length + 1).fill(0);
      for (let j = 1; j <= b.length; j++) {
        if (a[i - 1] === b[j - 1]) {
          cur[j] = prev[j - 1] + 1;
          if (cur[j] > best) { best = cur[j]; ai = i - best; bi = j - best; }
        }
      }
      prev = cur;
    }
    if (!best) return 0;
    return best + matches(a.slice(0, ai), b.slice(0, bi)) + matches(a.slice(ai + best), b.slice(bi + best));
  }
  return 2 * matches(a, b) / (a.length + b.length);
}

export function sentenceSimilarity(a, b) {
  const A = contentWords(a), B = contentWords(b);
  let inter = 0; for (const x of A) if (B.has(x)) inter++;
  const jac = inter / Math.max(1, A.size + B.size - inter);
  return [Math.max(seqRatio(a.toLowerCase(), b.toLowerCase()), jac), Math.min(A.size, B.size)];
}

function charWbGrams(s, n = 3) {
  const out = new Map();
  for (const w of s.toLowerCase().split(/\s+/).filter(Boolean)) {
    const p = ` ${w} `;
    if (p.length < n) { out.set(p, (out.get(p) || 0) + 1); continue; }
    for (let i = 0; i + n <= p.length; i++) { const g = p.slice(i, i + n); out.set(g, (out.get(g) || 0) + 1); }
  }
  return out;
}

function tfidf(docs) {
  const grams = docs.map(d => charWbGrams(d));
  const df = new Map();
  for (const g of grams) for (const k of g.keys()) df.set(k, (df.get(k) || 0) + 1);
  const N = docs.length;
  return grams.map(g => {
    const v = new Map(); let norm = 0;
    for (const [k, c] of g) { const w = (1 + Math.log(c)) * (Math.log((1 + N) / (1 + df.get(k))) + 1); v.set(k, w); norm += w * w; }
    norm = Math.sqrt(norm) || 1;
    for (const [k, w] of v) v.set(k, w / norm);
    return v;
  });
}
const dot = (a, b) => { if (a.size > b.size) [a, b] = [b, a]; let s = 0; for (const [k, w] of a) { const x = b.get(k); if (x) s += w * x; } return s; };
const cosine = (a, b) => { let d = 0, na = 0, nb = 0; for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; } return d / (Math.sqrt(na * nb) || 1); };

function shingleSet(tokens, n) {
  const w = tokens.map(t => t[0]); const s = new Set();
  for (let i = 0; i + n <= w.length; i++) s.add(w.slice(i, i + n).join(" "));
  return s;
}

function sentenceSpans(doc) {
  const spans = []; let pos = 0;
  for (const s of doc.sentences) {
    let i = doc.text.indexOf(s, pos);
    if (i < 0) i = doc.text.indexOf(s);
    if (i >= 0) { spans.push([i, i + s.length, s]); pos = i + s.length; }
  }
  return spans;
}

export async function checkDup(target, sources, exclude = [], { n = null, paraThreshold = 0.6, embedFn = null, embedThreshold = 0.92 } = {}) {
  n = n || (isCJK(target.text) ? 13 : 8);
  const toks = tokenize(target.text), T = toks.length, words = toks.map(t => t[0]);
  const gram = i => words.slice(i, i + n).join(" ");

  const excl = new Set();
  for (const e of exclude) for (const s of shingleSet(tokenize(e.text), n)) excl.add(s);
  const excluded = new Uint8Array(T);
  for (let i = 0; i + n <= T; i++) if (excl.has(gram(i))) excluded.fill(1, i, i + n);

  const exact = {}, exactAny = new Uint8Array(T);
  for (const src of sources) {
    const set = shingleSet(tokenize(src.text), n), m = new Uint8Array(T);
    for (let i = 0; i + n <= T; i++) if (set.has(gram(i))) m.fill(1, i, i + n);
    for (let i = 0; i < T; i++) { if (excluded[i]) m[i] = 0; if (m[i]) exactAny[i] = 1; }
    exact[src.name] = m;
  }

  const para = {}; for (const s of sources) para[s.name] = new Uint8Array(T);
  const pairs = [];
  const tspans = sentenceSpans(target);
  const starts = toks.map(t => t[1]);
  const lowerBound = x => { let lo = 0, hi = starts.length; while (lo < hi) { const m = (lo + hi) >> 1; if (starts[m] < x) lo = m + 1; else hi = m; } return lo; };
  const srcSents = sources.flatMap(s => s.sentences.map(x => [s.name, x]));
  if (tspans.length && srcSents.length) {
    const tsent = tspans.map(x => x[2]), ssent = srcSents.map(x => x[1]);
    const V = tfidf(tsent.concat(ssent)), TV = V.slice(0, tsent.length), SV = V.slice(tsent.length);
    let E = null;
    if (embedFn) { const ea = await embedFn(tsent), eb = await embedFn(ssent); E = [ea, eb]; }
    tspans.forEach(([a, b, sent], k) => {
      const lo = lowerBound(a), hi = lowerBound(b);
      if (hi <= lo) return;
      let ex = 0, xc = 0; for (let i = lo; i < hi; i++) { ex += exactAny[i]; xc += excluded[i]; }
      if (ex / (hi - lo) > 0.6 || xc / (hi - lo) > 0.6) return;
      const sims = SV.map((v, j) => [dot(TV[k], v), j]).sort((x, y) => y[0] - x[0]).slice(0, 3);
      let hit = false, ratio = 0, best = -1;
      for (const [s, j] of sims) {
        if (s < 0.45) break;
        const [r, nw] = sentenceSimilarity(sent, ssent[j]);
        if (nw >= 5 && r >= paraThreshold && r > ratio) { hit = true; ratio = r; best = j; }
      }
      if (!hit && E) {
        let bj = -1, bs = -1;
        E[1].forEach((v, j) => { const c = cosine(E[0][k], v); if (c > bs) { bs = c; bj = j; } });
        if (bs >= embedThreshold) { hit = true; ratio = bs; best = bj; }
      }
      if (hit) {
        const srcName = srcSents[best][0];
        para[srcName].fill(1, lo, hi);
        pairs.push([Math.round(ratio * 1000) / 1000, sent, srcName, ssent[best]]);
      }
    });
  }
  const paraOnly = new Uint8Array(T);
  for (const m of Object.values(para)) for (let i = 0; i < T; i++) if (m[i] && !exactAny[i] && !excluded[i]) paraOnly[i] = 1;
  const sum = a => a.reduce((x, y) => x + y, 0);
  const total = exactAny.map((x, i) => x | paraOnly[i]);
  const bySource = {};
  for (const s of sources) { let c = 0; for (let i = 0; i < T; i++) if ((exact[s.name][i] || para[s.name][i]) && !excluded[i]) c++; bySource[s.name] = c / Math.max(1, T); }

  const runs = (mask, kind, src = "") => {
    const out = []; let i = 0;
    while (i < T) { if (mask[i]) { let j = i; while (j + 1 < T && mask[j + 1]) j++; out.push([toks[i][1], toks[j][2], kind, src]); i = j + 1; } else i++; }
    return out;
  };
  let spans = runs(excluded, "excluded");
  for (const s of sources) spans = spans.concat(runs(exact[s.name], "exact", s.name));
  spans = spans.concat(runs(paraOnly, "paraphrase")).sort((a, b) => a[0] - b[0]);
  pairs.sort((a, b) => b[0] - a[0]);
  return {
    name: target.name, nTokens: T,
    exact: sum(exactAny) / Math.max(1, T), paraphrase: sum(paraOnly) / Math.max(1, T),
    total: sum(total) / Math.max(1, T), excluded: sum(excluded) / Math.max(1, T),
    bySource: Object.fromEntries(Object.entries(bySource).sort((a, b) => b[1] - a[1])),
    spans, pairs,
  };
}

export async function checkAll(docs, corpus = [], exclude = [], opts = {}) {
  const res = [];
  for (const d of docs) res.push(await checkDup(d, docs.filter(x => x !== d).concat(corpus), exclude, opts));
  return res;
}

/* ============================== 防御性语言 ============================== */
export function compileLexicon(lex) {
  const L = structuredClone(lex);
  for (const c of Object.values(L.categories)) {
    c._re = c.patterns.map(p => Array.isArray(p) ? [new RegExp(p[0], "gi"), +p[1]] : [new RegExp(p, "gi"), +c.weight]);
  }
  return L;
}

export function scoreSentence(sent, lex) {
  const cats = [], matches = []; let score = 0;
  for (const [key, c] of Object.entries(lex.categories)) {
    let cs = 0;
    for (const [rx, w] of c._re) {
      rx.lastIndex = 0; let hit = false;
      for (const m of sent.matchAll(rx)) { matches.push([m.index, m.index + m[0].length, key]); hit = true; }
      if (hit) cs += w;
    }
    if (cs) { cats.push(key); score += Math.min(cs, c.cap ?? 1); }
  }
  matches.sort((a, b) => a[0] - b[0]);
  return [score, cats, matches];
}

export function analyzeDef(doc, lex) {
  const thr = lex.threshold ?? 1;
  const hits = [], flags = [], catCount = Object.fromEntries(Object.keys(lex.categories).map(k => [k, 0]));
  let totalScore = 0;
  doc.sentences.forEach((s, i) => {
    const [sc, cats, ms] = scoreSentence(s, lex);
    totalScore += sc; cats.forEach(c => catCount[c]++);
    const d = sc >= thr; flags.push(d);
    if (d) hits.push({ index: i, text: s, score: sc, categories: cats, matches: ms });
  });
  const n = Math.max(1, doc.sentences.length), cut = doc.summaryCutoff;
  const summ = flags.slice(0, cut), body = flags.slice(cut);
  const rate = a => a.length ? a.filter(Boolean).length / a.length : null;
  return {
    name: doc.name, nSentences: doc.sentences.length, nWords: doc.nWords,
    rate: flags.filter(Boolean).length / n, intensity: totalScore / Math.max(1, doc.nWords) * 1000,
    summary: rate(summ), body: rate(body),
    byCategory: Object.fromEntries(Object.entries(catCount).map(([k, v]) => [k, v / n])),
    hits, llmRate: null, llmHits: [],
  };
}

const LLM_PROMPT = `下面是一篇论文的若干句子（带编号）。判断每句是否属于"防御性语言"：
即作者主动为结论设限、免责或划清边界，例如声明"这不是预测/估计"、"结果仅在某假设下成立"、
"无法识别/数据不可得"、"应理解为 X 而非 Y"。普通的方法描述、结果陈述不算。
输出 JSON：{"items":[{"i":编号,"defensive":true/false,"category":"disclaimer|contrast|limitation|scope|hedge|none"}]}
句子：
`;
export async function llmReview(doc, res, client, batch = 40) {
  const flags = [];
  for (let b = 0; b < doc.sentences.length; b += batch) {
    const chunk = doc.sentences.slice(b, b + batch);
    const out = await client.chatJSON(LLM_PROMPT + chunk.map((s, k) => `[${b + k}] ${s}`).join("\n"));
    const got = new Map((out.items || []).map(x => [+x.i, x]));
    chunk.forEach((s, k) => {
      const x = got.get(b + k) || {};
      flags.push(!!x.defensive);
      if (x.defensive) res.llmHits.push({ index: b + k, text: s, category: x.category });
    });
  }
  res.llmRate = flags.filter(Boolean).length / Math.max(1, flags.length);
  return res;
}

/* ============================== 挡位 ============================== */
// 1 最硬气 … 10 最保守。每档给出摘要/正文防御率目标和改写口径。
export const LEVELS = [
  { name: "绝对自信", summary: 0.02, body: 0.01, tone: "除 Limitations 一节外，删除全部免责、限定和模糊语；每个结论直接用数字正面陈述。" },
  { name: "强势", summary: 0.04, body: 0.03, tone: "只保留会改变结论适用范围的限定，其余全部改成正面陈述加证据。" },
  { name: "果断", summary: 0.06, body: 0.04, tone: "摘要不出现免责句；正文每节最多保留一句必要的边界说明。" },
  { name: "自信", summary: 0.08, body: 0.06, tone: "摘要最多一句适用范围说明；正文的限定尽量换成灵敏度或检验结果。" },
  { name: "均衡", summary: 0.10, body: 0.08, tone: "摘要保留一句关键边界；正文的限定集中到假设和局限两节，并配应对措施。" },
  { name: "稳健", summary: 0.13, body: 0.10, tone: "保留主要假设前提的说明，删掉重复、空泛的免责；不确定性尽量量化。" },
  { name: "审慎", summary: 0.16, body: 0.13, tone: "保留各结论的适用条件，但每条都要具体（哪个假设、多大范围），不要笼统否定。" },
  { name: "严谨", summary: 0.20, body: 0.16, tone: "保留学术上必要的限定和可识别性讨论，只删去没有信息量的套话。" },
  { name: "学术保守", summary: 0.25, body: 0.20, tone: "基本保留原有限定，只合并重复声明，并把模糊语替换成具体数字。" },
  { name: "原样保留", summary: 0.30, body: 0.25, tone: "不主动删减限定，只改写明显空泛或自相矛盾的免责句。" },
];
export const DEFAULT_LEVEL = 5;

/* ============================== 提示词 ============================== */
const AI_TEMPLATE = [
  /\bit is worth (noting|mentioning)\b/i, /\bplays? an? (crucial|pivotal|vital|key|important) role\b/i,
  /\bdelv(e|es|ing)\b/i, /\bin the realm of\b/i, /\b(comprehensive|holistic|multifaceted|intricate)\b/i,
  /\brobust framework\b/i, /\bnovel (approach|framework|method)\b/i, /\bsheds? light on\b/i,
  /\bpaves? the way\b/i, /\b(in conclusion|in summary|to summari[sz]e)\b/i, /\b(furthermore|moreover|additionally)\b/i,
  /\bleverag(e|es|ing)\b/i, /\bunderscor(e|es|ing)\b/i, /\blandscape\b/i, /\bseamless(ly)?\b/i,
  /\b(auditable|traceable|reproducible witness)\b/i, /\breconstruction consistency\b/i,
  /值得注意的是/, /综上所述/, /具有重要(的)?意义/, /起着?至关重要的作用/, /深入探讨/, /全面(地)?(分析|探讨)/,
];
const STRATEGY = {
  disclaimer: "遇到“这不是预测/估计”，改成正面陈述它**是什么**，并紧跟支撑它的验证数字。确实需要的边界声明，全文只在摘要留一句、在局限一节留一处。",
  contrast: "“A 而非 B”只保留全文最关键的一处；其余改成直接陈述 A 及其证据。",
  limitation: "合并到 Strengths and Weaknesses（或 Limitations）一节；每条局限都配一句“我们如何控制它”（灵敏度分析、区间界、替代数据、稳健性检验）。正文其他地方删掉重复声明。",
  scope: "假设集中在 Assumptions 一节写清并给理由；结果处最多用一次“在基准假设下”，不要每句重复。",
  hedge: "may/likely/approximately 能量化就量化（区间、误差、弹性、扰动 ±x% 后结论是否改变），用检验结论替代“可能”。",
};
const P = x => (x * 100).toFixed(1) + "%", P0 = x => x == null ? "—" : Math.round(x * 100) + "%";
const q = (s, n = 260) => (s = s.trim()).length <= n ? s : s.slice(0, n) + "…";

export function buildPrompt(doc, dup, dfn, lex, { level = null, targetSummary = 0.10, targetBody = 0.08, maxItems = 30, embedText = false } = {}) {
  const lv = level ? LEVELS[level - 1] : null;
  if (lv) { targetSummary = lv.summary; targetBody = lv.body; }
  const cats = lex.categories;
  const lang = /[一-鿿]{20,}/.test(doc.text) ? "中文" : "英文";
  const L = [`# 论文专项优化提示词：${doc.name}`, "",
    "> 使用方法：把整段提示词连同论文全文（或 LaTeX 源码）一起发给 AI。" + (embedText ? "本提示词已附全文。" : "本提示词只列出问题句，请另外附上论文全文。"), "",
    "## 角色与硬约束",
    `你是一名数学建模竞赛（MCM/ICM）的资深评委兼写作教练。请按下面的诊断结果修改这篇${lang}论文，输出语言与原文一致（${lang}）。`,
    "必须遵守：",
    "1. **不改动任何数字、公式、模型设定和结论方向**；不新增论文里没有的数据、实验或文献。",
    "2. 需要新增分析才能支撑的地方，不要编造，写成 `[需补充分析：具体做什么]` 留给作者。",
    "3. 保留论文的 Report on Use of AI Tools（竞赛要求如实披露 AI 使用）。",
    "4. 不做同义词替换式的“降重”；每处修改都必须让论证更扎实或更有本队特色。", ""];
  if (dfn && dfn.hits.length) {
    L.push("## 底气：防御性语言优化",
      `诊断：全文防御性语言率 **${P(dfn.rate)}**（摘要 ${P0(dfn.summary)}，正文 ${P0(dfn.body)}），防御强度 ${dfn.intensity.toFixed(1)} 分/千词。目标：摘要 ≤ ${P0(targetSummary)}，正文 ≤ ${P0(targetBody)}。`,
      ...(lv ? [`改写口径（第 ${level} 挡 · ${lv.name}）：${lv.tone}`] : []), "",
      "评委读到满篇“这不是预测”“仅为示意”“无法识别”时，会觉得作者对自己的结果没底气。改写原则：",
      "- 每个核心结论写成三步：**结论（带数字）→ 支撑证据（验证/对比/检验结果）→ 稳健性（扰动后是否仍成立）**。",
      "- 不确定性用数字表达（区间、误差、灵敏度），不用语气词表达。",
      "- 必要的局限集中写一次，并且每条都说明如何控制或缓解它。",
      "- 摘要只保留一句最关键的适用范围声明，其余位置给出具体发现。", "", "分类改写策略：");
    const used = [...new Set(dfn.hits.flatMap(h => h.categories))].sort();
    for (const c of used) L.push(`- **${cats[c]?.label || c}**：${STRATEGY[c] || ""}`);
    L.push("", `需要处理的句子（按防御强度排序，最多 ${maxItems} 条）：`, "", "| # | 位置 | 类别 | 原句 |", "|---|---|---|---|");
    [...dfn.hits].sort((a, b) => b.score - a.score).slice(0, maxItems).forEach((h, k) => {
      const zone = h.index < doc.summaryCutoff ? "摘要" : `正文第${h.index + 1}句`;
      L.push(`| ${k + 1} | ${zone} | ${h.categories.map(c => cats[c]?.label || c).join("、")} | ${q(h.text).replace(/\|/g, "/")} |`);
    });
    L.push("");
  }
  const tmpl = doc.sentences.map(s => [AI_TEMPLATE.map(r => (s.match(r) || [])[0]).filter(Boolean), s]).filter(x => x[0].length).slice(0, 15);
  if ((dup && (dup.pairs.length || dup.exact > 0)) || tmpl.length) {
    L.push("## 区分度：去同质化", "大家用同一个 AI 写同一道题，表述和段落结构会高度趋同。评委一天看几十篇，雷同的段落会直接被略过。");
    if (dup) {
      const top = Object.entries(dup.bySource).slice(0, 3);
      L.push(`诊断：总重复率 **${P(dup.total)}**（逐字 ${P(dup.exact)}，改写相似 ${P(dup.paraphrase)}）。` + (top.length ? "最相似的来源：" + top.map(([s, v]) => `${s}（${P(v)}）`).join("；") : ""));
    }
    L.push("", "改写原则：",
      "- **写出选择的理由**：为什么用这个模型、这个参数、这种数据处理方式，而不用常见做法。理由正是别人写不出来的部分。",
      "- **用本文独有的证据开头**：具体到某一季、某个对象、某个反常案例，不要用题目背景复述开头。",
      "- **重组结构**：问题驱动（先给答案，再说怎么得到），而不是千篇一律的“背景 → 方法 → 结果”。",
      "- **给模型和关键指标起本队的名字**，并在图表、结论中前后呼应。",
      "- 和赛题原文、公共数据描述相同的句子可以保留，但尽量压缩成一句。", "",
      "请先基于论文已有结果，提出 **3 个能让本文与众不同的切入角度**（每个一句话，标明依据的是文中哪个结果），再按这些角度改写下面的段落。", "");
    if (dup) {
      const ex = dup.spans.filter(s => s[2] === "exact" && s[1] - s[0] > 40).slice(0, maxItems >> 1);
      if (ex.length) { L.push("逐字重复的片段：", ""); ex.forEach(([a, b, , s]) => L.push(`- 「${q(doc.text.slice(a, b), 200)}」（与 ${s} 相同）`)); L.push(""); }
      if (dup.pairs.length) {
        L.push("与其他论文高度相似的句子：", "", "| # | 本文 | 相似来源 | 来源原句 | 相似度 |", "|---|---|---|---|---|");
        dup.pairs.slice(0, maxItems).forEach(([r, a, s, b], k) => L.push(`| ${k + 1} | ${q(a, 180).replace(/\|/g, "/")} | ${s} | ${q(b, 180).replace(/\|/g, "/")} | ${Math.round(r * 100)}% |`));
        L.push("");
      }
    }
    if (tmpl.length) { L.push("常见套话（换成具体内容或直接删除）：", ""); tmpl.forEach(([f, s]) => L.push(`- \`${f.join("`, `")}\` → ${q(s, 160)}`)); L.push(""); }
  }
  L.push("## 输出格式",
    "1. 先给出 3 个差异化切入角度（如果有“区分度”部分）。",
    "2. 再用表格逐条给出：`原句 | 修改后 | 修改理由（对应上面哪条原则）`。",
    "3. 最后给出改写后的**摘要全文**（这是评委最先读、也最影响印象的部分）。",
    "4. 列出所有 `[需补充分析：…]` 的位置，作为作者的待办清单。", "");
  if (embedText) L.push("## 附：论文全文", "", "```", doc.text, "```");
  return L.join("\n");
}

/* ============================== API ============================== */
// 从模型回复中取出 JSON：容忍前后说明文字、```json 代码块和推理模型的 <think> 段
export function parseJSONLoose(text) {
  let t = String(text || "").replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  try { return JSON.parse(t); } catch { }
  for (const [open, close] of [["{", "}"], ["[", "]"]]) {
    const a = t.indexOf(open);
    if (a < 0) continue;
    let depth = 0, inStr = false, esc = false;
    for (let i = a; i < t.length; i++) {
      const c = t[i];
      if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
      if (c === '"') inStr = true;
      else if (c === open) depth++;
      else if (c === close && --depth === 0) { try { return JSON.parse(t.slice(a, i + 1)); } catch { break; } }
    }
  }
  throw new Error("模型返回的内容不是合法 JSON");
}
// 网络层可替换：在本地 papersim-web 下运行时改走本机转发，绕开浏览器跨域限制
export const net = { fetch: (url, init) => fetch(url, init), proxied: false };
export function useLocalProxy(endpoint = "/api/proxy") {
  net.proxied = true;
  net.fetch = async (url, init = {}) => {
    const r = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, method: init.method || "GET", headers: init.headers || {}, body: init.body ?? null }) });
    if (!r.ok) throw new TypeError("本地转发失败");
    const j = await r.json();
    if (j.error) throw new TypeError(j.error);
    return new Response(j.body, { status: j.status, headers: { "Content-Type": "application/json" } });
  };
}
export const PROVIDERS = {
  deepseek: { name: "DeepSeek", base: "https://api.deepseek.com/v1", prefer: ["deepseek-chat", "deepseek-reasoner"] },
  openai: { name: "OpenAI", base: "https://api.openai.com/v1", prefer: ["gpt-4.1-mini", "gpt-4o-mini", "gpt-4.1", "gpt-4o"], embed: ["text-embedding-3-small", "text-embedding-3-large"] },
  qwen: { name: "通义千问", base: "https://dashscope.aliyuncs.com/compatible-mode/v1", prefer: ["qwen-plus", "qwen-max", "qwen-turbo"], embed: ["text-embedding-v3"] },
  moonshot: { name: "Kimi (Moonshot)", base: "https://api.moonshot.cn/v1", prefer: ["kimi-k2", "moonshot-v1-32k", "moonshot-v1-8k"] },
  zhipu: { name: "智谱 GLM", base: "https://open.bigmodel.cn/api/paas/v4", prefer: ["glm-4-plus", "glm-4-air", "glm-4-flash"], embed: ["embedding-3"] },
  siliconflow: { name: "硅基流动", base: "https://api.siliconflow.cn/v1", prefer: ["deepseek-ai/DeepSeek-V3", "Qwen/Qwen2.5-72B-Instruct"], embed: ["BAAI/bge-m3"] },
  openrouter: { name: "OpenRouter", base: "https://openrouter.ai/api/v1", prefer: ["deepseek/deepseek-chat", "openai/gpt-4o-mini"] },
  anthropic: { name: "Anthropic", base: "https://api.anthropic.com/v1", prefer: ["sonnet", "haiku"] },
  gemini: { name: "Google Gemini", base: "https://generativelanguage.googleapis.com/v1beta/openai", prefer: ["gemini-2.5-flash", "gemini-2.0-flash", "flash"], embed: ["text-embedding-004"] },
  volcengine: { name: "火山方舟（豆包）", base: "https://ark.cn-beijing.volces.com/api/v3", prefer: ["doubao"] },
};
const NON_CHAT = /whisper|tts|dall-e|image|audio|speech|moderation|rerank|vision-preview|realtime|transcri|sora|ocr/i;
const EMBED = /embed|bge|m3e|gte-/i;

export function candidatesForKey(key) {
  const k = key.trim();
  if (k.startsWith("sk-ant-")) return ["anthropic"];
  if (k.startsWith("sk-or-")) return ["openrouter"];
  if (k.startsWith("AIza")) return ["gemini"];
  if (/^[0-9a-f]{32}\.[A-Za-z0-9]+$/.test(k)) return ["zhipu"];
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(k)) return ["volcengine"];
  if (k.startsWith("sk-proj-") || k.startsWith("sk-svcacct-")) return ["openai"];
  if (k.startsWith("sk-")) return ["deepseek", "openai", "moonshot", "siliconflow", "qwen"];
  return Object.keys(PROVIDERS);
}

export function authHeaders(base, key) {
  const h = { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
  if (base.includes("anthropic.com")) Object.assign(h, { "x-api-key": key, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" });
  return h;
}

function errText(e) {
  if (e.status === 401 || e.status === 403) return `HTTP ${e.status}：key 无效或无权限`;
  if (e.status === 404) return "HTTP 404：该地址没有 /models 接口";
  if (e.status) return `HTTP ${e.status}`;
  if (e.name === "TimeoutError" || e.name === "AbortError") return "请求超时";
  return "浏览器无法访问（网络不通，或该服务商不允许网页直接调用）";
}

async function getModels(base, key, timeout = 10000) {
  const r = await net.fetch(base.replace(/\/$/, "") + "/models", { headers: authHeaders(base, key), signal: AbortSignal.timeout(timeout) });
  if (!r.ok) { const e = new Error("http"); e.status = r.status; throw e; }
  const data = await r.json();
  const items = data.data || data.models || [];
  return [...new Set(items.map(m => (typeof m === "string" ? m : m.id || m.name || "").replace(/^models\//, "")).filter(Boolean))].sort();
}

function pick(ids, prefer = []) {
  for (const p of prefer) {
    if (ids.includes(p)) return p;
    const hit = ids.find(i => i.toLowerCase().includes(p.toLowerCase()));
    if (hit) return hit;
  }
  return ids[0] || null;
}

export function providerForBase(base) {
  for (const [k, v] of Object.entries(PROVIDERS)) if (base.includes(new URL(v.base).host)) return k;
  return "custom";
}

export async function detect(key, base = null) {
  key = (key || "").trim();
  if (!key) return { ok: false, error: "请先填写 API key" };
  const cands = base ? [[providerForBase(base), base.replace(/\/$/, "")]] : candidatesForKey(key).map(p => [p, PROVIDERS[p].base]);
  const tried = {};
  const results = await Promise.all(cands.map(async ([p, b]) => {
    try { return [p, b, await getModels(b, key)]; }
    catch (e) { tried[PROVIDERS[p]?.name || p] = errText(e); return null; }
  }));
  const found = results.find(Boolean);
  if (!found) {
    const msg = Object.entries(tried).map(([k, v]) => `${k} ${v}`).join("；");
    if (cands.length === 1 && PROVIDERS[cands[0][0]]) {
      const info = PROVIDERS[cands[0][0]];
      return { ok: false, provider: cands[0][0], providerName: info.name, base: cands[0][1],
        chat: info.prefer.filter(x => /[-/]/.test(x)), embed: info.embed || [], tried,
        error: `没能获取模型列表：${msg}。可以手动输入模型名` };
    }
    if (base) return { ok: false, base, tried, error: `无法从 ${base} 获取模型列表：${Object.values(tried).join("；")}。可以在下拉框里直接输入模型名` };
    return { ok: false, tried, error: `没有服务商接受这个 key：${msg}` };
  }
  const [p, b, ids] = found;
  const chat = [], embed = [], other = [];
  for (const i of ids) (EMBED.test(i) ? embed : NON_CHAT.test(i) ? other : chat).push(i);
  const info = PROVIDERS[p] || {};
  return { ok: true, provider: p, providerName: info.name || "自定义", base: b, chat, embed, other,
    defaultChat: pick(chat, info.prefer), defaultEmbed: embed.length ? pick(embed, info.embed) : null, tried };
}

// 余额查询：只有提供了公开接口的服务商才能查。返回 {ok, amount, currency, detail} 或 {ok:false, reason}
const BALANCE = {
  deepseek: { url: b => new URL(b).origin + "/user/balance",
    parse: j => { const i = (j.balance_infos || [])[0]; return i && { amount: +i.total_balance, currency: i.currency, detail: `充值 ${i.topped_up_balance} · 赠送 ${i.granted_balance}` }; } },
  moonshot: { url: b => new URL(b).origin + "/v1/users/me/balance",
    parse: j => j.data && { amount: +j.data.available_balance, currency: "CNY", detail: `现金 ${(+j.data.cash_balance).toFixed(2)} · 代金券 ${(+j.data.voucher_balance).toFixed(2)}` } },
  siliconflow: { url: b => new URL(b).origin + "/v1/user/info",
    parse: j => j.data && { amount: +(j.data.totalBalance ?? j.data.balance), currency: "CNY", detail: `充值 ${j.data.chargeBalance ?? "—"} · 赠送 ${j.data.balance ?? "—"}` } },
  openrouter: { url: () => "https://openrouter.ai/api/v1/key",
    parse: j => j.data && (j.data.limit_remaining != null
      ? { amount: +j.data.limit_remaining, currency: "USD", detail: `本 key 额度 ${j.data.limit} · 已用 ${(+j.data.usage).toFixed(4)}` }
      : { amount: null, used: +j.data.usage, currency: "USD", detail: `本 key 累计已用 $${(+j.data.usage).toFixed(4)}（未设额度上限）` }) },
};
export function balanceSupported(provider) { return !!BALANCE[provider]; }
export async function getBalance(provider, base, key) {
  const b = BALANCE[provider];
  if (!b) return { ok: false, reason: "该服务商没有公开的余额查询接口" };
  try {
    const r = await net.fetch(b.url(base || PROVIDERS[provider].base), { headers: authHeaders(base || "", key), signal: AbortSignal.timeout(10000) });
    if (!r.ok) return { ok: false, reason: `余额查询失败（HTTP ${r.status}）` };
    const v = b.parse(await r.json());
    return v ? { ok: true, ...v, at: Date.now() } : { ok: false, reason: "余额接口返回格式无法识别" };
  } catch (e) { return { ok: false, reason: errText(e) }; }
}

export class Client {
  constructor({ key, base, model, embedModel = null, onUsage = null }) {
    this.key = key; this.base = (base || "https://api.openai.com/v1").replace(/\/$/, ""); this.model = model; this.embedModel = embedModel;
    this.usage = { calls: 0, input: 0, output: 0, cached: 0, embed: 0 };
    this.onUsage = onUsage;
  }
  track(out, kind) {
    const u = out && out.usage;
    this.usage.calls++;
    if (u) {
      if (kind === "embed") this.usage.embed += u.total_tokens || u.prompt_tokens || 0;
      else {
        this.usage.input += u.prompt_tokens || u.input_tokens || 0;
        this.usage.output += u.completion_tokens || u.output_tokens || 0;
        this.usage.cached += u.prompt_cache_hit_tokens || u.prompt_tokens_details?.cached_tokens || 0;
      }
    }
    this.onUsage && this.onUsage({ ...this.usage });
  }
  async post(path, body, retries = 3) {
    for (let k = 0; ; k++) {
      let r;
      try { r = await net.fetch(this.base + path, { method: "POST", headers: authHeaders(this.base, this.key), body: JSON.stringify(body) }); }
      catch (e) { throw new Error(errText(e)); }
      if (r.ok) return r.json();
      if ([429, 500, 502, 503].includes(r.status) && k < retries - 1) { await new Promise(s => setTimeout(s, 3000 * 2 ** k)); continue; }
      const t = await r.text();
      const e = new Error(`API 错误 ${r.status}: ${t.slice(0, 300)}`); e.status = r.status; e.body = t; throw e;
    }
  }
  async chatText(prompt, temperature = 0.3) {
    const out = await this.post("/chat/completions", { model: this.model, temperature, messages: [{ role: "user", content: prompt }] });
    this.track(out, "chat");
    return out.choices[0].message.content;
  }
  async chatJSON(prompt) {
    return this.chatMessagesJSON([{ role: "system", content: "只输出合法 JSON。" }, { role: "user", content: prompt }]);
  }
  async chatMessagesJSON(messages) {
    const body = { model: this.model, temperature: 0, messages, response_format: { type: "json_object" } };
    const ask = async b => {
      let out;
      try { out = await this.post("/chat/completions", b); }
      catch (e) {
        // 部分服务商不支持 json 模式，去掉后重试
        if (b.response_format && e.status === 400) { delete b.response_format; out = await this.post("/chat/completions", b); }
        else throw e;
      }
      this.track(out, "chat");
      return out.choices?.[0]?.message?.content ?? "";
    };
    let txt = await ask(body);
    try { return parseJSONLoose(txt); }
    catch (e) {
      // 模型多写了说明文字或格式残缺：要求它只重发 JSON，最多一次
      txt = await ask({ ...body, messages: [...messages, { role: "assistant", content: txt }, { role: "user", content: "上一条回复不是合法 JSON。请只输出同样内容的 JSON 对象，不要任何其他文字。" }] });
      return parseJSONLoose(txt);
    }
  }
  async embed(texts, batch = 64) {
    const vecs = [];
    for (let i = 0; i < texts.length; i += batch) {
      const out = await this.post("/embeddings", { model: this.embedModel, input: texts.slice(i, i + batch) });
      this.track(out, "embed");
      vecs.push(...out.data.sort((a, b) => a.index - b.index).map(d => d.embedding));
    }
    return vecs;
  }
}

// 归一化后在原文中定位引文：忽略空白、引号、破折号和大小写差异，返回原文中的对应片段
const NORM_MAP = { "“": '"', "”": '"', "„": '"', "‘": "'", "’": "'", "—": "-", "–": "-", "−": "-", "，": ",", "：": ":", "；": ";", "（": "(", "）": ")" };
function normWithMap(text) {
  let out = "", map = [], space = false;
  for (let i = 0; i < text.length; i++) {
    let c = NORM_MAP[text[i]] ?? text[i];
    if (/\s/.test(c)) { if (!space && out) { out += " "; map.push(i); } space = true; continue; }
    space = false; out += c.toLowerCase(); map.push(i);
  }
  return [out.trimEnd(), map];
}
export function locateQuote(text, quote) {
  if (!quote) return null;
  if (text.includes(quote)) return quote;
  const [nt, map] = normWithMap(text), [nq] = normWithMap(quote.trim().replace(/^["'“”‘’「『]+|["'“”‘’」』]+$/g, ""));
  if (nq.length < 6) return null;
  const at = nt.indexOf(nq);
  if (at < 0) return null;
  return text.slice(map[at], map[at + nq.length - 1] + 1);
}

export async function reviewPaper(doc, client, { logic = false, hallucination = false } = {}) {
  const kinds = [logic && "logic", hallucination && "hallucination"].filter(Boolean);
  const result = await client.chatJSON(`你是论文审阅者，只检查指定项目：${kinds.join("、")}。
logic：前提与结论脱节、因果跳跃、公式或单位不一致、约束遗漏、论证自相矛盾。
hallucination：无出处数据、引文与正文不符、缺乏证据的事实断言等待核实风险。你没有联网查证能力，不得声称已证实任何数据、文献或事实为真或为假，不得编造外部来源。
只返回 JSON，结构为 {"logic":[],"hallucination":[]}。每条必须包含 quote（从论文逐字摘录的连续原文）、issue（具体疑点，区分推断与确定事实）、suggestion（可执行的核查或修改建议）、severity（high/medium/low）。没有可定位问题则返回空数组。不要输出 AI 生成率或作者模型身份推断。
论文：\n${doc.text}`);
  if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error("专项检查返回格式无效，请重试");
  const out = { logic: null, hallucination: null, rejected: 0 };
  for (const kind of kinds) {
    if (!Array.isArray(result[kind])) { out[kind] = []; out.error = "模型没有按要求返回检查结果"; continue; }
    out[kind] = [];
    for (const item of result[kind]) {
      const quote = item && typeof item.quote === "string" ? locateQuote(doc.text, item.quote) : null;
      if (!quote || typeof item.issue !== "string" || !item.issue.trim() || typeof item.suggestion !== "string" || !item.suggestion.trim()) { out.rejected++; continue; }
      out[kind].push({ quote, issue: item.issue, suggestion: item.suggestion, severity: ["high","medium","low"].includes(item.severity) ? item.severity : "medium", status: kind === "hallucination" ? "待外部核实" : "待作者复核" });
    }
  }
  return out;
}

/* ============================== 总流程 ============================== */
export async function run({ docs, corpus = [], exclude = [], lex, opt = {}, client = null, log = () => {}, progress = () => {} }) {
  const k = docs.length;
  if (opt.polish && !client) throw new Error("学术润色指导需要填写 API Key 并选择对话模型");
  const writingResources = opt.polish ? await loadWritingResources() : null;
  if (!["def", "none"].includes(opt.only) && docs.length + corpus.length < 2) throw new Error("重复率至少需要两篇（被测论文 + 比对库）。只测防御性语言请选“只看防御性语言”");
  if (opt.threshold != null) lex.threshold = opt.threshold;
  let dup = Array(k).fill(null), dfn = Array(k).fill(null), audits = Array(k).fill(null);
  const total = k * (1 + (!["def", "none"].includes(opt.only) ? 1 : 0) + (!["dup", "none"].includes(opt.only) ? 1 : 0) + (!["dup", "none"].includes(opt.only) && client && opt.llmReview ? 1 : 0) + (client && opt.apply && !opt.polish ? 1 : 0) + (opt.logic || opt.hallucination ? 1 : 0) + (opt.polish ? 1 : 0));
  let done = 0;
  const advance = () => progress(++done, total);
  if (!["def", "none"].includes(opt.only)) {
    await log("计算重复率…");
    const embedFn = client && opt.llmEmbed && client.embedModel ? t => client.embed(t) : null;
    for (let i = 0; i < k; i++) {
      await log(`计算重复率 ${i + 1}/${k}：${docs[i].name}`);
      dup[i] = await checkDup(docs[i], docs.filter((_, j) => j !== i).concat(corpus), exclude, { paraThreshold: opt.paraThreshold ?? 0.6, embedFn }); advance();
    }
  }
  if (!["dup", "none"].includes(opt.only)) {
    for (let i = 0; i < k; i++) { await log(`计算防御性语言 ${i + 1}/${k}：${docs[i].name}`); dfn[i] = analyzeDef(docs[i], lex); advance(); }
    if (client && opt.llmReview) for (let i = 0; i < k; i++) { await log(`大模型复核防御句 ${i + 1}/${k}：${docs[i].name}`); await llmReview(docs[i], dfn[i], client); advance(); }
  }
  if (opt.logic || opt.hallucination) {
    if (!client) throw new Error("逻辑与幻觉风险检查需要对话模型");
    for (let i = 0; i < k; i++) {
      if (opt.reuseAudits && opt.reuseAudits[i] !== undefined) { audits[i] = opt.reuseAudits[i]; advance(); continue; }
      await log(`论文专项检查 ${i + 1}/${k}：${docs[i].name}`);
      try { audits[i] = await reviewPaper(docs[i], client, opt); }
      catch (e) {
        // 单篇专项检查失败不影响其他结果
        audits[i] = { logic: opt.logic ? [] : null, hallucination: opt.hallucination ? [] : null, rejected: 0, error: e.message };
      }
      advance();
    }
  }
  await log("生成优化提示词…");
  const prompts = [], suggestions = [], writing = Array(k).fill(null);
  for (let i = 0; i < k; i++) {
    prompts.push(buildPrompt(docs[i], dup[i], dfn[i], lex, { level: opt.level ?? null, targetSummary: opt.targetSummary ?? 0.1, targetBody: opt.targetBody ?? 0.08, embedText: !!opt.embedText }));
    if (audits[i]) {
      const notes = ["\n\n## 专项检查待复核清单（风险提示，不是真伪鉴定）"];
      for (const kind of ["logic", "hallucination"]) for (const item of audits[i][kind] || []) notes.push(`- 原文：${item.quote}\n疑点：${item.issue}\n建议：${item.suggestion}（${item.status}）`);
      prompts[i] += notes.join("\n");
    }
    advance();
    if (opt.polish) {
      await log(`生成学术润色指导提示词 ${i + 1}/${k}：${docs[i].name}（不直接改写正文）`);
      prompts[i] = await generateWritingGuidance(docs[i], client, writingResources, {
        locateQuote, onValidation: summary => { writing[i] = summary; }, diagnostics: { duplication: dup[i] ? { rate: dup[i].total, pairs: dup[i].pairs.slice(0, 15) } : null,
          defensive: dfn[i] ? { rate: dfn[i].rate, hits: dfn[i].hits.slice(0, 20).map(h => h.text) } : null, audits: audits[i] }
      });
      advance();
    }
    if (client && opt.apply && !opt.polish) {
      await log(`大模型生成修改建议 ${i + 1}/${k}：${docs[i].name}`);
      suggestions.push(await client.chatText(opt.embedText ? prompts[i] : prompts[i] + "\n\n## 附：论文全文\n\n" + docs[i].text));
      advance();
    } else suggestions.push(null);
  }
  await log("检测计算完成，正在整理报告…");
  return { docs, dup, dfn, audits, writing, prompts, suggestions };
}
