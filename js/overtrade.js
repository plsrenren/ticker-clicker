// Overtrading: in a bear market, mashing the buy button gets punished.
// Every manual tap in a bear raises "pressure" (shown as an RSI chip); it cools off on its own.
//   ~3 taps/s is safe, ~6/s creeps up, 8+/s gets you in trouble within a few seconds.
//   RSI 75+  SELL WALL        each tap has a 30% chance to hit sellers instead: the price drops by that tap
//   RSI 85   BUYER'S REMORSE  gives back 60% of what your taps added in the last 6s, then taps -50% for 15s
//   RSI 100  TRADING HALT     price -8%, taps do nothing for 5s
window.TC = window.TC || {};

TC.overtrade = (() => {
  const st = () => TC.state.data;
  const $ = (id) => document.getElementById(id);
  const T = {
    perTap: 0.05,     // pressure per tap
    cool: 0.25,       // pressure lost per second
    wall: 0.5,        // RSI 75
    wallChance: 0.3,
    remorse: 0.7,     // RSI 85
    remorseGive: 0.6,
    remorseWindow: 6,
    halt: 1,          // RSI 100
    haltDrop: 0.08,
  };
  let pressure = 0;
  let remorseArmed = true;
  let recent = [];    // [clock, amount] of tap gains, for buyer's remorse
  let giveBack = null; // { left, d, t, applied } smooth price drop
  let lastKey = "";

  const bear = () => TC.seasons && TC.seasons.current() === "bear";
  const rsi = () => Math.round(50 + 50 * Math.min(1, pressure));

  function slide(frac, d) {
    // Spread a drop over d seconds so it reads as a selloff, not a teleport
    giveBack = { f: frac, d, t: 0, applied: 0 };
  }

  function render() {
    const el = $("rsi");
    if (!el) return;
    const show = bear() && pressure > 0.2;
    const key = show ? rsi() + (pressure >= T.wall ? "h" : "") : "";
    if (key === lastKey) return;
    lastKey = key;
    el.hidden = !show;
    if (!show) return;
    el.textContent = "RSI " + rsi() + (pressure >= T.remorse ? " OVERBOUGHT" : "");
    el.dataset.level = pressure >= T.remorse ? "hot" : pressure >= T.wall ? "warm" : "";
  }

  const api = {
    rsi,
    pressure: () => pressure,

    // Called by market.buy before a manual tap lands. Returns "halt", "wall" or "ok".
    tap() {
      if (TC.debuffs && TC.debuffs.active("halt")) return "halt";
      if (!bear()) return "ok";
      pressure = Math.min(1, pressure + T.perTap);
      if (pressure >= T.halt) {
        pressure = 0.55; // the halt itself cools things off
        remorseArmed = true;
        TC.debuffs.add("halt");
        slide(-T.haltDrop, 0.8);
        TC.events.emit("overtrade", { kind: "halt", title: "TRADING HALT" });
        return "halt";
      }
      if (pressure >= T.remorse && remorseArmed) {
        remorseArmed = false;
        const now = st().clock;
        const added = recent.filter((r) => now - r[0] <= T.remorseWindow).reduce((s, r) => s + r[1], 0);
        recent = [];
        const frac = Math.min(0.3, (added * T.remorseGive) / Math.max(1e-9, st().basePrice));
        if (frac > 0.002) slide(-frac, 1.2);
        TC.debuffs.add("remorse");
        TC.events.emit("overtrade", { kind: "remorse", title: "BUYER'S REMORSE" });
      }
      if (pressure >= T.wall && Math.random() < T.wallChance) return "wall";
      return "ok";
    },
    // market.buy reports what a tap actually added
    landed(amount) { if (bear()) recent.push([st().clock, amount]); },

    init() {
      TC.events.on("season", () => { pressure = 0; remorseArmed = true; recent = []; });
      TC.events.on("reset", () => { pressure = 0; remorseArmed = true; recent = []; giveBack = null; lastKey = ""; render(); });
    },
    update(dt) {
      pressure = Math.max(0, pressure - T.cool * dt);
      if (pressure < T.wall) remorseArmed = true;
      const now = st().clock;
      if (recent.length && now - recent[0][0] > T.remorseWindow) recent = recent.filter((r) => now - r[0] <= T.remorseWindow);
      if (giveBack) {
        giveBack.t += dt;
        const p = Math.min(1, giveBack.t / giveBack.d);
        const step = Math.pow(1 + giveBack.f, p) / Math.pow(1 + giveBack.f, giveBack.applied) - 1;
        if (Math.abs(step) > 1e-5) { TC.market.shift(step, "overtrade"); giveBack.applied = p; }
        if (p >= 1) giveBack = null;
      }
      render();
    },
  };
  return api;
})();
