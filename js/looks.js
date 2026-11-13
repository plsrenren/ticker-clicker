// Extras that belong to one theme (see themes.js for the list):
//   Ticker Tape 1929: a paper ticker tape crawling along the bottom of the chart, printing your
//     quote and your rivals' in old-style fractions (it takes the place of the time labels).
//   Arcade CRT: a combo counter for fast tapping, with a best-combo "HI" score (lifetime.bestCombo).
// Both are plain DOM elements in the chart (#paperTape, #combo); CSS only shows them in their theme.
window.TC = window.TC || {};

TC.looks = (() => {
  const st = () => TC.state.data;
  const $ = (id) => document.getElementById(id);

  // ---------- Ticker Tape ----------
  const FRAC = ["", "⅛", "¼", "⅜", "½", "⅝", "¾", "⅞"];
  function frac(p) {
    if (!(p > 0)) return "0";
    if (p >= 10000) return TC.format.axis(p).replace("$", "");
    let whole = Math.floor(p), e = Math.round((p - whole) * 8);
    if (e === 8) { whole++; e = 0; }
    return (whole || e ? (whole ? whole.toLocaleString("en-US") : "") + FRAC[e] : "0");
  }
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const SPEED = reduced ? 0 : 38; // px per second; reduced motion keeps the tape still
  let swapT = 0, tape = null, track = null, offset = 0, last = {}, n = 0, raf = 0, prevT = 0;

  function entry() {
    const s = st();
    const q = TC.rivals.quotes ? TC.rivals.quotes() : [];
    let sym, price, you = false;
    if (n++ % 3 === 0 || !q.length) { sym = s.symbol || "YOU"; price = TC.market.px(TC.market.quote()); you = true; }
    else { const r = q[Math.floor(Math.random() * q.length)]; sym = r.sym; price = r.price; }
    const prev = last[sym];
    last[sym] = price;
    const el = document.createElement("span");
    el.className = you ? "pt-you" : "pt-q";
    let move = "";
    if (prev > 0 && Math.abs(price - prev) >= 1 / 16) {
      const up = price > prev;
      move = `<em class="${up ? "pt-up" : "pt-down"}">${up ? "▲" : "▼"}${frac(Math.abs(price - prev))}</em>`;
    }
    el.innerHTML = `${sym.replace(/^\$/, "")} ${frac(price)}${move ? " " + move : ""}`;
    return el;
  }
  // Big moments get typed onto the tape too
  function bulletin(text) {
    if (!track || TC.look !== "tape") return;
    const el = document.createElement("span");
    el.className = "pt-news";
    el.textContent = text;
    track.appendChild(el);
  }
  function tapeFrame(t) {
    raf = 0;
    if (TC.look !== "tape" || !tape) return;
    const dt = prevT ? Math.min(0.1, (t - prevT) / 1000) : 0;
    prevT = t;
    offset -= SPEED * dt;
    const width = tape.clientWidth;
    // keep the strip full: add quotes on the right, drop the ones that left on the left
    while (track.scrollWidth + offset < width + 80) track.appendChild(entry());
    // reduced motion: no crawl, but swap the oldest quote for a fresh one every few seconds
    if (reduced && t - swapT > 4000 && track.firstElementChild) { swapT = t; track.firstElementChild.remove(); track.appendChild(entry()); }
    const first = track.firstElementChild;
    if (first && offset + first.offsetWidth + 28 < 0) { offset += first.offsetWidth + 28; first.remove(); }
    track.style.transform = `translateX(${offset.toFixed(1)}px)`;
    raf = requestAnimationFrame(tapeFrame);
  }
  function startTape() {
    if (!tape || raf || TC.look !== "tape") return;
    prevT = 0;
    raf = requestAnimationFrame(tapeFrame);
  }

  // ---------- Arcade combo ----------
  let combo = 0, lastTap = 0, comboEl = null, hideT = 0;
  function onTap() {
    if (TC.look !== "arcade" || !comboEl) return;
    const now = performance.now();
    combo = now - lastTap < 600 ? combo + 1 : 1;
    lastTap = now;
    const s = st();
    if (combo > (s.lifetime.bestCombo || 0)) s.lifetime.bestCombo = combo;
    if (combo < 5) return;
    $("comboN").textContent = "x" + combo;
    $("comboHi").textContent = "HI x" + (s.lifetime.bestCombo || combo);
    comboEl.hidden = false;
    comboEl.classList.remove("pop"); void comboEl.offsetWidth; comboEl.classList.add("pop");
    clearTimeout(hideT);
    hideT = setTimeout(() => { comboEl.hidden = true; combo = 0; }, 1200);
  }

  return {
    init() {
      tape = $("paperTape"); track = $("paperTapeTrack"); comboEl = $("combo");
      TC.events.on("look", ({ look }) => {
        if (look === "tape") startTape();
        if (look !== "arcade" && comboEl) comboEl.hidden = true;
      });
      TC.events.on("buy", (e) => { if (e.manual) onTap(); });
      TC.events.on("news", (e) => {
        if (e.type === "flash") bulletin("*** FLASH CRASH ***");
        else if (e.big && e.tone === "up") bulletin("*** BULLETIN: BUYERS RUSH IN ***");
      });
      TC.events.on("private", () => bulletin("*** TAKEN PRIVATE ***"));
      startTape();
    },
  };
})();
