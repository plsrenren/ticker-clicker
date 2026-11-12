// Unlockable looks. Going private unlocks Sketchbook (Dusk); going private 3 times unlocks Sketchbook Midnight.
// The chosen theme lives in settings.theme (meta, kept forever). Classes on <html> switch the CSS tokens
// (css/theme-sketch.css); chart and effects re-read their colors, and canvas text switches font via TC.fontSet.
window.TC = window.TC || {};

TC.themes = (() => {
  const st = () => TC.state.data;
  const $ = (id) => document.getElementById(id);

  const LIST = [
    { id: "classic",  name: "Classic",    sub: "Neon terminal",    need: 0, cls: [] },
    { id: "dusk",     name: "Sketchbook", sub: "Dusk",             need: 1, cls: ["theme-sketch"] },
    { id: "midnight", name: "Midnight",   sub: "Sketchbook, after dark", need: 3, cls: ["theme-sketch", "theme-night"] },
  ];
  const ALL_CLS = ["theme-sketch", "theme-night"];
  const CLASSIC_FONTS = Object.assign({}, TC.fontSet);
  const HAND = '"Gaegu", "Patrick Hand", "Comic Sans MS", system-ui, sans-serif';

  const byId = (id) => LIST.find((t) => t.id === id) || LIST[0];
  const count = () => (st().prestige && st().prestige.count) || 0;
  const isOpen = (t) => count() >= t.need;

  function apply(id) {
    const t = byId(id);
    const root = document.documentElement;
    ALL_CLS.forEach((c) => root.classList.toggle(c, t.cls.includes(c)));
    TC.fontSet = t.cls.includes("theme-sketch")
      ? { data: HAND, display: HAND, scale: 1.25, weight: "700" }
      : Object.assign({}, CLASSIC_FONTS);
    st().settings.theme = t.id;
    if (TC.chart.refreshColors) TC.chart.refreshColors();
    if (TC.effects.refreshColors) TC.effects.refreshColors();
    renderPicker();
  }

  // Canvas text needs the web font loaded before it draws, or it falls back for a frame or two.
  function loadHand() {
    if (document.fonts && document.fonts.load) document.fonts.load('700 16px "Gaegu"').catch(() => {});
  }

  // ---- Picker in the Trophies tab ----
  function renderPicker() {
    const row = $("themeRow");
    if (!row) return;
    const cur = st().settings.theme || "classic";
    row.textContent = "";
    for (const t of LIST) {
      const open = isOpen(t);
      const b = document.createElement("button");
      b.type = "button";
      b.className = "theme-opt";
      b.dataset.theme = t.id;
      b.disabled = !open;
      b.setAttribute("aria-pressed", String(t.id === cur));
      b.innerHTML = '<span class="theme-swatch"><i></i></span><span class="theme-name"></span><span class="theme-sub"></span>';
      b.children[1].textContent = t.name;
      b.children[2].textContent = open ? t.sub : (t.need === 1 ? "Go private to unlock" : "Go private " + t.need + "x");
      row.appendChild(b);
    }
    $("themeCount").textContent = LIST.filter(isOpen).length + "/" + LIST.length;
  }

  // ---- Unlock card, shown after going private ----
  function showUnlock(t) {
    const card = $("unlock");
    if (!card) return;
    card.dataset.theme = t.id;
    $("unlockName").textContent = t.id === "dusk" ? "Sketchbook" : "Sketchbook " + t.name;
    $("unlockSub").textContent = t.id === "dusk"
      ? "Hand-drawn outlines, a painted dusk sky and handwritten numbers."
      : "The sketchbook after dark: a deep night sky with a brighter moon.";
    $("unlockNext").textContent = t.id === "dusk"
      ? "Midnight unlocks after going private 3 times. Switch any time in Trophies."
      : "Switch any time in Trophies.";
    card.hidden = false;
    TC.events.emit("themeUnlock", { id: t.id });
  }
  function hideUnlock() { const c = $("unlock"); if (c) c.hidden = true; }

  return {
    LIST,
    apply,
    // Runs before the chart starts so it reads the right colors from the first frame.
    init() {
      if (!isOpen(byId(st().settings.theme))) st().settings.theme = "classic";
      if (st().settings.theme !== "classic") loadHand();
      apply(st().settings.theme || "classic");

      const row = $("themeRow");
      if (row) row.addEventListener("click", (e) => {
        const b = e.target.closest(".theme-opt");
        if (!b || b.disabled) return;
        loadHand();
        apply(b.dataset.theme);
        TC.state.save();
      });
      $("unlockWear").addEventListener("click", () => {
        loadHand();
        apply($("unlock").dataset.theme);
        TC.state.save();
        hideUnlock();
      });
      $("unlockLater").addEventListener("click", hideUnlock);

      // prestige.count has already gone up when "private" fires
      TC.events.on("private", () => {
        const t = LIST.find((x) => x.need === count());
        renderPicker();
        if (t && t.need > 0) { loadHand(); setTimeout(() => showUnlock(t), 400); }
      });
      // A full wipe resets settings and founder count too, which takes the looks away
      TC.events.on("reset", () => {
        const t = byId(st().settings.theme);
        apply(isOpen(t) ? t.id : "classic");
      });
    },
  };
})();
