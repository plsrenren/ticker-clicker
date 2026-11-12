// Unlockable looks.
//   Sketchbook (Dusk): go private once. Midnight: go private 3 times.
//   Ticker Tape 1929: ride out a flash crash without selling. Arcade CRT: tap 100,000 times.
//   Chalkboard: earn every achievement.
// The chosen theme lives in settings.theme (meta, kept forever). Classes on <html> switch the CSS tokens
// (css/theme-*.css); chart and effects re-read their colors, and canvas text switches font via TC.fontSet.
// TC.look names the active family ("classic", "sketch", "tape", "arcade", "chalk") so the canvases,
// sounds and js/looks.js can draw their own versions. TC.sketch stays as a shortcut for "sketch".
window.TC = window.TC || {};

TC.themes = (() => {
  const st = () => TC.state.data;
  const $ = (id) => document.getElementById(id);

  const HAND = '"Gaegu", "Patrick Hand", "Comic Sans MS", system-ui, sans-serif';
  const TYPE = '"Special Elite", "Courier New", monospace';
  const PIXEL = '"Press Start 2P", monospace', TERM = '"VT323", monospace';
  const CHALK = '"Cabin Sketch", "Chalkboard SE", cursive';
  const founder = (n) => (s) => ((s.prestige && s.prestige.count) || 0) >= n;
  const TAPS = 100000;
  const achTotal = () => (TC.achievements && TC.achievements.LIST.length) || 20;

  const LIST = [
    { id: "classic", name: "Classic", sub: "Neon terminal", look: "classic", cls: [], test: () => true },
    { id: "dusk", name: "Sketchbook", sub: "Dusk", look: "sketch", cls: ["theme-sketch"], test: founder(1),
      hint: () => "Go private to unlock",
      font: { data: HAND, display: HAND, scale: 1.25, weight: "700" }, load: ['700 16px "Gaegu"'],
      card: { eyebrow: "Run complete", name: "Sketchbook", sub: "Hand-drawn outlines, a painted dusk sky and handwritten numbers.",
        next: "Midnight unlocks after going private 3 times. Switch any time in Trophies." } },
    { id: "midnight", name: "Midnight", sub: "Sketchbook, after dark", look: "sketch", cls: ["theme-sketch", "theme-night"], test: founder(3),
      hint: (s) => "Go private 3x · " + Math.min(3, (s.prestige && s.prestige.count) || 0) + "/3",
      font: { data: HAND, display: HAND, scale: 1.25, weight: "700" }, load: ['700 16px "Gaegu"'],
      card: { eyebrow: "Run complete", name: "Sketchbook Midnight", sub: "The sketchbook after dark: a deep night sky with a brighter moon.",
        next: "Switch any time in Trophies." } },
    { id: "tape", name: "Ticker Tape", sub: "1929 newsprint", look: "tape", cls: ["theme-tape"], test: (s) => (s.lifetime.crashHeld || 0) >= 1,
      hint: () => "Hold through a crash, no sells",
      font: { data: TYPE, display: TYPE, scale: 1.05, weight: "400" }, load: ['16px "Special Elite"', '700 16px "Old Standard TT"'],
      card: { eyebrow: "Held through the crash", name: "Ticker Tape 1929", sub: "Sepia newsprint, typewriter numbers and a paper tape under the chart.",
        next: "Unlocked by riding out a flash crash without selling. Switch any time in Trophies." } },
    { id: "arcade", name: "Arcade CRT", sub: "Insert coin", look: "arcade", cls: ["theme-arcade"], test: (s) => (s.lifetime.taps || 0) >= TAPS,
      hint: (s) => "Tap 100K · " + Math.min(99, Math.floor((s.lifetime.taps || 0) / TAPS * 100)) + "%",
      font: { data: TERM, display: PIXEL, scale: 1.6, weight: "400" }, load: ['16px "Press Start 2P"', '16px "VT323"'],
      card: { eyebrow: "100,000 taps", name: "Arcade CRT", sub: "Pixel font, scanlines, chiptune sounds and 8-bit coin bursts.",
        next: "Unlocked by tapping 100,000 times. Switch any time in Trophies." } },
    { id: "chalk", name: "Chalkboard", sub: "Chalk on slate", look: "chalk", cls: ["theme-chalk"], test: (s) => Object.keys(s.achievements || {}).length >= achTotal(),
      hint: (s) => "All achievements · " + Object.keys(s.achievements || {}).length + "/" + achTotal(),
      font: { data: CHALK, display: CHALK, scale: 1.2, weight: "700" }, load: ['700 16px "Cabin Sketch"'],
      card: { eyebrow: "All " + 20 + " achievements", name: "Chalkboard", sub: "Chalk on slate. The old chart smudges away as it scrolls.",
        next: "Unlocked by earning every achievement. Switch any time in Trophies." } },
  ];
  const ALL_CLS = [...new Set(LIST.flatMap((t) => t.cls))];
  const CLASSIC_FONTS = Object.assign({}, TC.fontSet);

  const byId = (id) => LIST.find((t) => t.id === id) || LIST[0];
  const isOpen = (t) => !!t.test(st());

  function apply(id) {
    const t = byId(id);
    const root = document.documentElement;
    ALL_CLS.forEach((c) => root.classList.toggle(c, t.cls.includes(c)));
    TC.fontSet = t.font ? Object.assign({}, t.font) : Object.assign({}, CLASSIC_FONTS);
    st().settings.theme = t.id;
    TC.look = t.look;
    TC.sketch = t.look === "sketch"; // chart, effects and sound draw their Sketchbook versions
    if (TC.chart.resize) TC.chart.resize();
    if (TC.effects.resize) TC.effects.resize();
    if (TC.chart.refreshColors) TC.chart.refreshColors();
    if (TC.effects.refreshColors) TC.effects.refreshColors();
    TC.events.emit("look", { id: t.id, look: t.look });
    renderPicker();
  }

  // Canvas text needs the web font loaded before it draws, or it falls back for a frame or two.
  function loadFonts(t) {
    if (!t || !t.load || !document.fonts || !document.fonts.load) return;
    t.load.forEach((f) => document.fonts.load(f).catch(() => {}));
  }

  // ---- Picker in the Trophies tab ----
  let pickerKey = "";
  function renderPicker(force = true) {
    const row = $("themeRow");
    if (!row) return;
    const s = st();
    const cur = s.settings.theme || "classic";
    const subs = LIST.map((t) => (isOpen(t) ? t.sub : t.hint(s)));
    const key = cur + "|" + subs.join("|");
    if (!force && key === pickerKey) return;
    pickerKey = key;
    row.textContent = "";
    LIST.forEach((t, i) => {
      const open = isOpen(t);
      const b = document.createElement("button");
      b.type = "button";
      b.className = "theme-opt";
      b.dataset.theme = t.id;
      b.disabled = !open;
      b.setAttribute("aria-pressed", String(t.id === cur));
      b.innerHTML = '<span class="theme-swatch"><i></i></span><span class="theme-name"></span><span class="theme-sub"></span>';
      b.children[1].textContent = t.name;
      b.children[2].textContent = subs[i];
      b.title = open ? t.name : subs[i];
      row.appendChild(b);
    });
    $("themeCount").textContent = LIST.filter(isOpen).length + "/" + LIST.length;
  }

  // ---- Unlock card. One at a time; settings.themesSeen remembers which cards were shown. ----
  const queue = [];
  function showUnlock(t) {
    const card = $("unlock");
    if (!card) return;
    card.dataset.theme = t.id;
    card.querySelector(".unlock-eyebrow").textContent = t.card.eyebrow;
    $("unlockName").textContent = t.card.name;
    $("unlockSub").textContent = t.card.sub;
    $("unlockNext").textContent = t.card.next;
    card.hidden = false;
    TC.events.emit("themeUnlock", { id: t.id });
  }
  function hideUnlock() {
    const c = $("unlock");
    if (c) c.hidden = true;
    if (queue.length) setTimeout(() => showUnlock(queue.shift()), 300);
  }
  function check(delay = 0) {
    const s = st();
    const seen = s.settings.themesSeen || (s.settings.themesSeen = []);
    const fresh = LIST.filter((t) => t.card && !seen.includes(t.id) && isOpen(t));
    if (!fresh.length) return;
    fresh.forEach((t) => { seen.push(t.id); loadFonts(t); });
    TC.state.save();
    renderPicker();
    setTimeout(() => {
      const c = $("unlock");
      fresh.forEach((t) => queue.push(t));
      if (c && c.hidden) showUnlock(queue.shift());
    }, delay);
  }
  // Players who saw a card before this list existed: count what's already open as seen,
  // except the new looks, so anyone who already qualifies still gets their card.
  function seedSeen() {
    const s = st();
    if (Array.isArray(s.settings.themesSeen)) return;
    s.settings.themesSeen = LIST.filter((t) => t.card && t.look === "sketch" && isOpen(t)).map((t) => t.id);
  }

  // ---- Ticker Tape unlock: a flash crash you ride out without a single manual sell ----
  let crash = null; // { clean }
  function trackCrash() {
    TC.events.on("news", (e) => { if (e.type === "flash") crash = { clean: true }; });
    TC.events.on("sell", (e) => { if (crash && e.manual) crash.clean = false; });
    TC.events.on("newsEnd", (e) => {
      if (e.type !== "flash" || !crash) return;
      if (crash.clean) st().lifetime.crashHeld = (st().lifetime.crashHeld || 0) + 1;
      crash = null;
      check(900);
    });
    TC.events.on("reset", () => { crash = null; });
  }

  return {
    LIST,
    apply,
    isOpen: (id) => isOpen(byId(id)),
    // Runs before the chart starts so it reads the right colors from the first frame.
    init() {
      seedSeen();
      if (!isOpen(byId(st().settings.theme))) st().settings.theme = "classic";
      loadFonts(byId(st().settings.theme));
      apply(st().settings.theme || "classic");

      const row = $("themeRow");
      if (row) row.addEventListener("click", (e) => {
        const b = e.target.closest(".theme-opt");
        if (!b || b.disabled) return;
        loadFonts(byId(b.dataset.theme));
        apply(b.dataset.theme);
        TC.state.save();
      });
      $("unlockWear").addEventListener("click", () => {
        loadFonts(byId($("unlock").dataset.theme));
        apply($("unlock").dataset.theme);
        TC.state.save();
        hideUnlock();
      });
      $("unlockLater").addEventListener("click", hideUnlock);

      trackCrash();
      // prestige.count has already gone up when "private" fires
      TC.events.on("private", () => check(400));
      TC.events.on("achievement", () => check(1200));
      // Taps: check now and then rather than on every tap; keep the picker's progress fresh
      setInterval(() => { check(); renderPicker(false); }, 2000);
      setTimeout(() => check(1500), 0);
      // A full wipe resets settings and founder count too, which takes the looks away
      TC.events.on("reset", () => {
        seedSeen();
        const t = byId(st().settings.theme);
        apply(isOpen(t) ? t.id : "classic");
      });
    },
  };
})();
