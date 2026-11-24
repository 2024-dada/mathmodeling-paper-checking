// 背景：雨夜城市。静态部分（天空、三层楼群、窗户、地面倒影、透视网格）绘制一次缓存；
// 每帧只叠加霓虹招牌的闪烁和雨。开启“减少动态效果”时只画一帧静态画面。
const canvas = document.getElementById("city");
const ctx = canvas.getContext("2d");
const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
const SIGN_WORDS = ["查重", "底气", "数模", "降重", "提示词", "摘要", "灵敏度", "评委", "建模", "论证"];
const NEON = ["#ff3c8e", "#2de2e6", "#ffb000", "#8f5cff"];

function rng(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

let W = 0, H = 0, DPR = 1, scene = null, signs = [], drops = [], horizon = 0;

function build() {
  DPR = Math.min(window.devicePixelRatio || 1, 1.5);
  W = innerWidth; H = innerHeight;
  canvas.width = W * DPR; canvas.height = H * DPR;
  scene = document.createElement("canvas");
  scene.width = canvas.width; scene.height = canvas.height;
  const g = scene.getContext("2d");
  g.scale(DPR, DPR);
  const R = rng(20261125);
  horizon = Math.round(H * 0.66);

  // 天空
  const sky = g.createLinearGradient(0, 0, 0, horizon);
  sky.addColorStop(0, "#0d0b1e"); sky.addColorStop(0.55, "#1a1240"); sky.addColorStop(0.85, "#3a1657"); sky.addColorStop(1, "#5c1a5e");
  g.fillStyle = sky; g.fillRect(0, 0, W, horizon);
  // 远处的光污染
  const glow = g.createRadialGradient(W * 0.5, horizon, 10, W * 0.5, horizon, W * 0.7);
  glow.addColorStop(0, "rgba(255,60,142,.35)"); glow.addColorStop(0.4, "rgba(143,92,255,.12)"); glow.addColorStop(1, "rgba(13,11,30,0)");
  g.fillStyle = glow; g.fillRect(0, 0, W, horizon);
  // 稀疏的星与航灯
  for (let i = 0; i < 70; i++) { g.fillStyle = `rgba(220,215,255,${0.15 + R() * 0.35})`; g.fillRect(R() * W, R() * horizon * 0.55, 1, 1); }

  signs = [];
  const layers = [
    { n: Math.ceil(W / 38), wMin: 26, wMax: 60, hMin: 0.10, hMax: 0.30, color: "#2a1a52", win: 0.10, haze: 0.55, sign: 0 },
    { n: Math.ceil(W / 60), wMin: 40, wMax: 90, hMin: 0.18, hMax: 0.46, color: "#1b1238", win: 0.16, haze: 0.25, sign: 0.10 },
    { n: Math.ceil(W / 95), wMin: 60, wMax: 140, hMin: 0.25, hMax: 0.60, color: "#100b24", win: 0.22, haze: 0, sign: 0.22 },
  ];
  for (const L of layers) {
    let x = -20;
    while (x < W + 20) {
      const bw = L.wMin + R() * (L.wMax - L.wMin);
      const bh = H * (L.hMin + R() * (L.hMax - L.hMin));
      const top = horizon - bh;
      g.fillStyle = L.color; g.fillRect(x, top, bw, bh);
      // 楼顶细节
      if (R() < 0.35) { g.fillRect(x + bw * 0.4, top - 14 - R() * 30, 2, 40); g.fillStyle = "#ff3c8e"; g.fillRect(x + bw * 0.4 - 1, top - 16 - R() * 30, 4, 3); }
      if (R() < 0.25) { g.fillStyle = L.color; g.fillRect(x + bw * 0.15, top - 10, bw * 0.5, 10); }
      // 窗户
      const cw = 3 + (L.wMin > 50 ? 1 : 0), gap = cw + 4;
      for (let wy = top + 8; wy < horizon - 6; wy += gap + 2) {
        for (let wx = x + 5; wx < x + bw - 6; wx += gap) {
          if (R() < L.win) {
            const c = R() < 0.6 ? `rgba(255,196,120,${0.25 + R() * 0.5})` : R() < 0.5 ? `rgba(45,226,230,${0.25 + R() * 0.45})` : `rgba(255,60,142,${0.2 + R() * 0.4})`;
            g.fillStyle = c; g.fillRect(wx, wy, cw, cw + 1);
          }
        }
      }
      // 霓虹招牌：竖排汉字。内容面板挡住中间，只把招牌挂在两侧露出来的位置
      if (L.sign && bh > H * 0.22) {
        const size = Math.max(14, Math.min(22, bw * 0.22));
        const sx = x + (R() < 0.5 ? 6 : bw - size - 10);
        const edgeL = (W - 1100) / 2, edgeR = (W + 1100) / 2;
        const side = W < 760 ? true : (sx + size + 6 < edgeL && sx > 4) || (sx > edgeR && sx + size < W - 4);
        const near = signs.some(o => Math.abs(o.x - sx) < 60);
        if (side && !near && R() < L.sign * 4) {
          signs.push({ x: sx, y: top + 24 + R() * bh * 0.2, word: SIGN_WORDS[Math.floor(R() * SIGN_WORDS.length)], size, color: NEON[Math.floor(R() * NEON.length)], flick: R() < 0.35, phase: R() * 100 });
        }
      }
      // 雾
      if (L.haze) { g.fillStyle = `rgba(58,22,87,${L.haze * 0.5})`; g.fillRect(x, top, bw, bh); }
      x += bw + (R() < 0.3 ? R() * 12 : 0);
    }
  }
  // 地平线霓虹光带
  const band = g.createLinearGradient(0, horizon - 3, 0, horizon + 3);
  band.addColorStop(0, "rgba(255,60,142,0)"); band.addColorStop(0.5, "rgba(255,60,142,.8)"); band.addColorStop(1, "rgba(255,60,142,0)");
  g.fillStyle = band; g.fillRect(0, horizon - 3, W, 6);

  // 地面：湿地倒影
  g.save();
  g.translate(0, horizon * 2); g.scale(1, -1); g.globalAlpha = 0.32;
  g.drawImage(scene, 0, 0, scene.width, horizon * DPR, 0, 0, W, horizon);
  g.restore();
  const floor = g.createLinearGradient(0, horizon, 0, H);
  floor.addColorStop(0, "rgba(13,11,30,.35)"); floor.addColorStop(1, "rgba(8,6,20,.96)");
  g.fillStyle = floor; g.fillRect(0, horizon, W, H - horizon);
  // 透视网格
  g.strokeStyle = "rgba(143,92,255,.22)"; g.lineWidth = 1;
  const vx = W * 0.5;
  for (let i = -24; i <= 24; i++) { g.beginPath(); g.moveTo(vx + i * 6, horizon); g.lineTo(vx + i * W * 0.09, H); g.stroke(); }
  for (let k = 1; k < 14; k++) { const y = horizon + (H - horizon) * Math.pow(k / 14, 2.1); g.globalAlpha = 0.25 + k / 28; g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
  g.globalAlpha = 1;

  // 雨
  drops = Array.from({ length: Math.round((W * H) / 9000) }, () => ({ x: R() * W, y: R() * H, l: 8 + R() * 16, v: 9 + R() * 9, a: 0.08 + R() * 0.18 }));
}

function drawSigns(t) {
  ctx.save();
  ctx.textBaseline = "top";
  for (const s of signs) {
    let a = 1;
    if (s.flick && !reduce) { const p = (t / 1000 + s.phase) % 7; a = p < 0.08 || (p > 0.16 && p < 0.22) ? 0.15 : 1; }
    ctx.font = `700 ${s.size}px "Microsoft YaHei UI","PingFang SC","Noto Sans SC",sans-serif`;
    const chars = [...s.word], hh = chars.length * (s.size + 2) + 8;
    ctx.globalAlpha = 0.9 * a;
    ctx.strokeStyle = s.color; ctx.lineWidth = 1.5; ctx.shadowColor = s.color; ctx.shadowBlur = 14;
    ctx.strokeRect(s.x - 4, s.y - 4, s.size + 8, hh);
    ctx.fillStyle = "#fff"; ctx.shadowBlur = 18;
    chars.forEach((c, i) => ctx.fillText(c, s.x, s.y + i * (s.size + 2)));
    // 倒影
    ctx.globalAlpha = 0.18 * a; ctx.shadowBlur = 24; ctx.fillStyle = s.color;
    ctx.fillRect(s.x - 2, horizon * 2 - s.y - hh, s.size + 4, hh * 0.9);
  }
  ctx.restore();
}

function drawRain(dt) {
  ctx.save();
  ctx.strokeStyle = "rgba(180,220,255,1)"; ctx.lineWidth = 1;
  for (const d of drops) {
    if (!reduce) { d.y += d.v * dt; d.x -= d.v * 0.18 * dt; if (d.y > H) { d.y = -20; d.x = Math.random() * (W + 100); } }
    ctx.globalAlpha = d.a;
    ctx.beginPath(); ctx.moveTo(d.x, d.y); ctx.lineTo(d.x - d.l * 0.18, d.y + d.l); ctx.stroke();
  }
  ctx.restore();
}

let last = 0, running = true;
function frame(t) {
  if (!running) return;
  const dt = Math.min(3, (t - last) / 33.3);
  if (t - last >= 33) {
    last = t;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.drawImage(scene, 0, 0, W, H);
    drawSigns(t); drawRain(dt);
  }
  if (!reduce) requestAnimationFrame(frame);
}

build();
if (reduce) { ctx.setTransform(DPR, 0, 0, DPR, 0, 0); ctx.drawImage(scene, 0, 0, W, H); drawSigns(0); drawRain(0); }
else requestAnimationFrame(frame);

let rt;
addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => { build(); if (reduce) { ctx.setTransform(DPR, 0, 0, DPR, 0, 0); ctx.drawImage(scene, 0, 0, W, H); drawSigns(0); drawRain(0); } }, 150); });
document.addEventListener("visibilitychange", () => { running = !document.hidden; if (running && !reduce) requestAnimationFrame(frame); });
