(() => {
  const root = document.documentElement, key = "papersim-appearance-v1";
  const defaults = { theme: "porcelain", font: "sans", size: 16, leading: 1.8, width: "standard", density: "comfortable", background: 62, motion: false, contrast: false };
  function normalize(raw = {}) {
    const one = (name, allowed) => allowed.includes(raw[name]) ? raw[name] : defaults[name];
    const number = (name, min, max) => typeof raw[name] === "number" && Number.isFinite(raw[name]) ? Math.min(max, Math.max(min, raw[name])) : defaults[name];
    return { theme: one("theme", ["porcelain", "jade", "paper", "harbor", "system"]), font: one("font", ["sans", "serif"]), size: number("size", 15, 20), leading: number("leading", 1.5, 2.2), width: one("width", ["focus", "standard", "wide"]), density: one("density", ["comfortable", "compact"]), background: number("background", 0, 100), motion: raw.motion === true, contrast: raw.contrast === true, backgroundVersion: 2 };
  }
  function load() {
    try {
      const saved = JSON.parse(localStorage.getItem(key)) || {};
      if (saved.backgroundVersion !== 2 && saved.background === 12) saved.background = defaults.background;
      return normalize(saved);
    } catch { return { ...defaults }; }
  }
  let config = load();
  const scheme = matchMedia("(prefers-color-scheme: dark)");
  function apply() {
    root.dataset.theme = config.theme === "system" ? (scheme.matches ? "harbor" : "porcelain") : config.theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", root.dataset.theme === "harbor" ? "#131f30" : { porcelain: "#c8d5e4", jade: "#f1f7f4", paper: "#faf7f0" }[root.dataset.theme]);
    root.dataset.font = config.font; root.dataset.density = config.density;
    root.dataset.motion = config.motion ? "reduce" : "normal"; root.dataset.contrast = config.contrast ? "high" : "normal";
    root.style.setProperty("--ui-size", config.size + "px"); root.style.setProperty("--ui-leading", config.leading);
    root.style.setProperty("--content-width", { focus: "1020px", standard: "1280px", wide: "1500px" }[config.width]);
    root.style.setProperty("--scenery-strength", config.background / 100);
  }
  apply(); scheme.addEventListener("change", apply);
  document.addEventListener("DOMContentLoaded", () => {
    const panel = document.querySelector("#appearanceDialog"), status = panel.querySelector("[role=status]");
    function sync() {
      panel.querySelectorAll("[name]").forEach(el => {
        const value = config[el.name];
        if (el.type === "radio") el.checked = el.value === value;
        else if (el.type === "checkbox") el.checked = value;
        else el.value = value;
      });
      panel.querySelector("#appearanceSizeValue").textContent = config.size + " px";
      panel.querySelector("#appearanceLeadingValue").textContent = config.leading.toFixed(1);
      panel.querySelector("#appearanceBackgroundValue").textContent = config.background + "%";
    }
    function save() {
      apply(); sync();
      try { localStorage.setItem(key, JSON.stringify(config)); status.textContent = "已应用并保存，下次打开继续使用。"; }
      catch { status.textContent = "已应用；当前浏览器无法保存设置，刷新后可能恢复默认。"; }
    }
    panel.addEventListener("input", e => {
      const el = e.target; if (!Object.hasOwn(defaults, el.name)) return;
      const value = el.type === "checkbox" ? el.checked : el.type === "range" ? +el.value : el.value;
      config = normalize({ ...config, [el.name]: value }); save();
    });
    let opener;
    document.querySelectorAll("[data-open-appearance]").forEach(button => button.addEventListener("click", () => { opener = button; sync(); panel.showModal(); panel.querySelector("input:checked").focus(); }));
    panel.querySelector("[data-close-appearance]").onclick = () => panel.close();
    panel.querySelector("[data-appearance-done]").onclick = () => panel.close();
    panel.querySelector("[data-reset-appearance]").onclick = () => { config = { ...defaults }; save(); };
    panel.addEventListener("close", () => opener?.focus());
    window.addEventListener("storage", e => { if (e.key === key) { config = load(); apply(); sync(); } });
    const sections = [...document.querySelectorAll("#upload,#detectionSettings,#modelSettings,#results")];
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) if (entry.isIntersecting) document.querySelectorAll(".workspace-nav nav a").forEach(a => {
        if (a.hash === "#" + entry.target.id) a.setAttribute("aria-current", "location"); else a.removeAttribute("aria-current");
      });
    }, { rootMargin: "-10% 0px -65% 0px" });
    sections.forEach(section => observer.observe(section)); sync();
  });
})();
