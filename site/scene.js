// 动态背景：在背景图同一图层上叠加光效。光效按图片坐标定义，随背景一起缩放平移，始终贴合画面里的管道、灯条和窗户。
// “减少动态效果”（系统或界面设置）开启时不运行。
const host = document.querySelector(".cityscape");
if (host) {
  const IMG = { w: 1672, h: 941 };
  // 图片坐标（0–1）：发光管道、塔楼霓虹灯条、前景栏杆顶边
  const PIPE = [[0.25, 0.537], [0.34, 0.533], [0.42, 0.528], [0.55, 0.512], [0.62, 0.497], [0.68, 0.48], [0.74, 0.462], [0.79, 0.445], [0.855, 0.418]];
  const STRIPS = [
    [[0.705, 0.02], [0.713, 0.19], [0.732, 0.265], [0.745, 0.42]],
    [[0.528, 0.29], [0.532, 0.52]],
    [[0.774, 0.21], [0.779, 0.42]],
    [[0.828, 0.0], [0.842, 0.22]],
  ];
  const RAIL = [[0.0, 0.888], [0.14, 0.845], [0.29, 0.803], [0.43, 0.765], [0.56, 0.731], [0.7, 0.692], [0.82, 0.648]];
  const WINDOWS = [[0.6, 0.2, 0.79, 0.56], [0.875, 0.22, 1.0, 0.66], [0.53, 0.38, 0.6, 0.55]];

  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  host.appendChild(canvas);
  const ctx = canvas.getContext("2d");
  let W = 0, H = 0, DPR = 1, map = null, raf = 0, last = 0, running = false;
  let pulses = [], sweeps = [], twinkles = [], drops = [], railGlint = null, nextGlint = 0;

  const rnd = (a, b) => a + Math.random() * (b - a);
  // 预先画好的光晕贴图：每帧直接贴图，避免实时 shadowBlur（软件渲染下极慢）
  function sprite(color, size = 64) {
    const c = document.createElement("canvas"); c.width = c.height = size;
    const g = c.getContext("2d"), r = size / 2, grd = g.createRadialGradient(r, r, 0, r, r, r);
    grd.addColorStop(0, color); grd.addColorStop(0.25, color.replace(/[\d.]+\)$/, "0.45)")); grd.addColorStop(1, color.replace(/[\d.]+\)$/, "0)"));
    g.fillStyle = grd; g.fillRect(0, 0, size, size);
    return c;
  }
  const GLOW = { cyan: sprite("rgba(111,231,251,1)"), ice: sprite("rgba(160,244,255,1)"), warm: sprite("rgba(255,207,134,1)") };
  function line(pts) {          // 折线 + 累计长度，供沿线取点
    const P = pts.map(([x, y]) => [map.x + x * map.w, map.y + y * map.h]);
    const L = [0];
    for (let i = 1; i < P.length; i++) L.push(L[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
    return { P, L, len: L[L.length - 1] };
  }
  function at(l, s) {
    s = Math.max(0, Math.min(l.len, s));
    let i = 1; while (i < l.L.length - 1 && l.L[i] < s) i++;
    const k = (s - l.L[i - 1]) / (l.L[i] - l.L[i - 1] || 1);
    return [l.P[i - 1][0] + (l.P[i][0] - l.P[i - 1][0]) * k, l.P[i - 1][1] + (l.P[i][1] - l.P[i - 1][1]) * k];
  }

  function layout() {
    DPR = 1;
    W = host.clientWidth; H = host.clientHeight;
    canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
    // 与 background-size: cover 和 background-position 相同的映射
    const pos = getComputedStyle(host).backgroundPosition.split(",")[0].trim().split(/\s+/);
    const pct = (v, d) => v && v.endsWith("%") ? parseFloat(v) / 100 : v === "right" || v === "bottom" ? 1 : v === "left" || v === "top" ? 0 : d;
    const s = Math.max(W / IMG.w, H / IMG.h), w = IMG.w * s, h = IMG.h * s;
    map = { x: (W - w) * pct(pos[0], 0.5), y: (H - h) * pct(pos[1], 0.5), w, h, s };
    const pipe = line(PIPE), rail = line(RAIL), strips = STRIPS.map(line);
    pulses = Array.from({ length: 4 }, (_, i) => ({ l: pipe, s: pipe.len * (i / 4), v: rnd(0.05, 0.08) * pipe.len, tail: rnd(0.14, 0.22) * pipe.len, a: rnd(0.8, 1) }));
    sweeps = strips.map(l => ({ l, s: rnd(-l.len, l.len), v: rnd(0.15, 0.25) * l.len, tail: l.len * 0.5 }));
    railGlint = { l: rail, s: -1 };
    twinkles = [];
    for (const [x0, y0, x1, y1] of WINDOWS) {
      for (let i = 0; i < 26; i++) twinkles.push({ x: map.x + rnd(x0, x1) * map.w, y: map.y + rnd(y0, y1) * map.h, ph: rnd(0, 6.28), sp: rnd(0.15, 0.6), sz: rnd(1.4, 2.6) * Math.max(0.7, map.s), warm: Math.random() < 0.8 });
    }
    drops = Array.from({ length: Math.round(W * H / 14000) }, () => ({ x: rnd(0, W), y: rnd(0, H), l: rnd(10, 22), v: rnd(7, 12), a: rnd(0.04, 0.1) }));
  }

  function comet(c, glow, width) {   // 沿线的光脉冲：贴图光晕 + 细亮芯
    const n = 14;
    let prev = at(c.l, c.s - c.tail);
    for (let i = n - 1; i >= 0; i--) {
      const p = at(c.l, c.s - c.tail * i / n), k = 1 - i / n, a = (c.a ?? 0.8) * k * k;
      const g = width * (5 + 9 * k);
      ctx.globalAlpha = a * 0.7;
      ctx.drawImage(glow, p[0] - g, p[1] - g, g * 2, g * 2);
      ctx.globalAlpha = a;
      ctx.beginPath(); ctx.moveTo(prev[0], prev[1]); ctx.lineTo(p[0], p[1]); ctx.stroke();
      prev = p;
    }
  }

  // 自适应：开始后约 4 秒内帧间隔明显偏长，说明这台设备带不动，自动改为静态背景
  let probe = { n: 0, sum: 0, prev: 0, done: false };
  function frame(t) {
    raf = requestAnimationFrame(frame);
    if (!probe.done) {
      if (probe.prev) { probe.sum += t - probe.prev; probe.n++; }
      probe.prev = t;
      if (probe.n >= 120 || probe.sum > 4000) {
        probe.done = true;
        if (probe.sum / probe.n > 55) { document.documentElement.classList.add("scene-lite"); stop(); return; }
      }
    }
    if (t - last < 33) return;
    const dt = Math.min(0.1, (t - last) / 1000 || 0.033); last = t;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    const sc = Math.max(0.8, map.s * 1.3);

    ctx.strokeStyle = "#eafdff"; ctx.lineWidth = 2.2 * sc;
    for (const p of pulses) { p.s += p.v * dt; if (p.s - p.tail > p.l.len) { p.s = rnd(-0.2, 0) * p.l.len; p.v = rnd(0.045, 0.075) * p.l.len; } comet(p, GLOW.cyan, 2.6 * sc); }
    ctx.lineWidth = 1.2 * sc;
    for (const w of sweeps) { w.s += w.v * dt; if (w.s - w.tail > w.l.len) w.s = rnd(-1.5, -0.2) * w.l.len; w.a = 0.75; comet(w, GLOW.ice, 1.8 * sc); }
    if (t > nextGlint && railGlint.s < 0) { railGlint.s = 0; railGlint.tail = railGlint.l.len * 0.18; railGlint.v = railGlint.l.len * 0.4; railGlint.a = 0.85; }
    if (railGlint.s >= 0) { railGlint.s += railGlint.v * dt; comet(railGlint, GLOW.ice, 2 * sc); if (railGlint.s - railGlint.tail > railGlint.l.len) { railGlint.s = -1; nextGlint = t + rnd(4000, 8000); } }

    const ts = t / 1000;
    for (const k of twinkles) {
      const v = Math.sin(ts * k.sp + k.ph);
      if (v < 0.55) continue;
      const a = Math.min(1, (v - 0.55) * 2.2), g = k.sz * 5;
      ctx.globalAlpha = a * 0.85;
      ctx.drawImage(k.warm ? GLOW.warm : GLOW.ice, k.x - g, k.y - g, g * 2, g * 2);
    }

    ctx.globalCompositeOperation = "source-over";
    ctx.strokeStyle = "#cfe9ff"; ctx.lineWidth = 1;
    ctx.beginPath();
    for (const d of drops) {
      d.y += d.v * dt * 60; d.x -= d.v * dt * 9;
      if (d.y > H) { d.y = -20; d.x = rnd(0, W + 60); }
      ctx.moveTo(d.x, d.y); ctx.lineTo(d.x - d.l * 0.15, d.y + d.l);
    }
    ctx.globalAlpha = 0.07; ctx.stroke();
    ctx.globalAlpha = 1;
  }

  const still = () => document.documentElement.dataset.motion === "reduce" || matchMedia("(prefers-reduced-motion: reduce)").matches;
  function start() { if (running || still() || document.hidden || document.documentElement.classList.contains("scene-lite")) return; running = true; layout(); last = 0; raf = requestAnimationFrame(frame); }
  function stop() { running = false; cancelAnimationFrame(raf); ctx.clearRect(0, 0, canvas.width, canvas.height); }

  let rt;
  addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => { if (running) layout(); }, 150); });
  document.addEventListener("visibilitychange", () => document.hidden ? stop() : start());
  new MutationObserver(() => { still() ? stop() : (running ? layout() : start()); }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-motion", "data-theme"] });
  matchMedia("(prefers-reduced-motion: reduce)").addEventListener?.("change", () => still() ? stop() : start());
  start();
}
