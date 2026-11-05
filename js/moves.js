// Silent market moves: no banner, nothing to tap. Every few seconds the real price takes a
// random swing (spike, drop, slide, run, chop) so the chart feels alive between news events.
// Moves go through TC.market.shift(), so up-moves past your record still pay cash.
window.TC = window.TC || {};

TC.moves = (() => {
  const st = () => TC.state.data;
  const rand = (a, b) => a + Math.random() * (b - a);
  const STEP = 0.12;      // seconds between price nudges inside a move
  const MIN_PRICE = 5;

  // Each move is a list of segments: move the price by `f` (fraction) over `d` seconds.
  const shapes = {
    spike: () => { const up = rand(0.04, 0.1); return [{ f: up, d: rand(0.4, 0.8) }, { f: (1 + up * rand(0.3, 0.6)) / (1 + up) - 1, d: rand(1.5, 2.5) }]; },
    drop: () => { const dn = rand(0.05, 0.12); return [{ f: -dn, d: rand(0.5, 0.9) }, { f: rand(0.4, 0.7) * dn, d: rand(2, 3.5) }]; },
    slide: () => [{ f: -rand(0.03, 0.07), d: rand(3, 5) }],
    run: () => [{ f: rand(0.03, 0.06), d: rand(2.5, 4) }],
    chop: () => {
      const segs = [];
      const n = 4 + Math.floor(Math.random() * 3);
      for (let i = 0; i < n; i++) segs.push({ f: (i % 2 ? 1 : -1) * rand(0.015, 0.035), d: rand(0.3, 0.6) });
      return segs;
    },
    wick: () => { const dn = rand(0.06, 0.1); return [{ f: -dn, d: 0.25 }, { f: dn * rand(0.8, 1), d: 0.5 }]; },
  };
  // Weighted pick: slightly more down than up so it's not free money
  const BAG = ["spike", "drop", "drop", "slide", "run", "chop", "chop", "wick"];

  let segs = null, seg = 0, segT = 0, acc = 0, applied = 0;
  let wait = 6;

  function start() {
    const bag = (TC.seasons && TC.seasons.moveBag()) || BAG;
    segs = shapes[bag[Math.floor(Math.random() * bag.length)]]();
    // bear markets swing harder, and so do big companies
    const amp = (TC.seasons ? TC.seasons.moveAmp() : 1) * TC.market.noiseAmp();
    if (amp !== 1) for (const sg of segs) sg.f = Math.max(-0.5, sg.f * amp);
    seg = 0; segT = 0; acc = 0; applied = 0;
  }

  return {
    init() {
      TC.events.on("reset", () => { segs = null; wait = 6; });
      TC.events.on("news", () => { segs = null; }); // a real event takes over
    },
    update(dt) {
      const s = st();
      if (!s.listed || s.basePrice < MIN_PRICE || (TC.news && TC.news.active()) || (TC.hype && TC.hype.busy())) return;
      if (!segs) {
        if ((wait -= dt) <= 0) { start(); wait = rand(2, 6); }
        return;
      }
      const cur = segs[seg];
      segT += dt; acc += dt;
      if (acc >= STEP || segT >= cur.d) {
        // Fraction of this segment we should have applied by now
        const p = Math.min(1, segT / cur.d);
        const target = Math.pow(1 + cur.f, p);         // cumulative multiplier
        const step = target / Math.pow(1 + cur.f, applied) - 1;
        if (Math.abs(step) > 1e-6) TC.market.shift(step, "drift");
        applied = p;
        acc = 0;
      }
      if (segT >= cur.d) {
        seg++; segT = 0; applied = 0;
        if (seg >= segs.length) segs = null;
      }
    },
  };
})();
