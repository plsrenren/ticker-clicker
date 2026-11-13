// Extras that belong to one theme (see themes.js for the list):
//   Arcade CRT: a combo counter for fast tapping, with a best-combo "HI" score (lifetime.bestCombo).
// (Ticker Tape 1929's paper tape is the rival ticker at the top, restyled in css/theme-tape.css.)
// The combo is a plain DOM element in the chart (#combo); CSS only shows it in Arcade.
window.TC = window.TC || {};

TC.looks = (() => {
  const st = () => TC.state.data;
  const $ = (id) => document.getElementById(id);

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
      comboEl = $("combo");
      TC.events.on("look", ({ look }) => { if (look !== "arcade" && comboEl) comboEl.hidden = true; });
      TC.events.on("buy", (e) => { if (e.manual) onTap(); });
    },
  };
})();
