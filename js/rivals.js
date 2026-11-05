// Rival ticker tape: made-up competitors scrolling across the top. They drift on their own
// and react to your news: money rotates into them when you crash and out when you pump.
// Rival headlines (news.js) can pick a rival, move it, glow it, or link it to your price for a while.
// Big moves of yours (effects "bigMove") make one rival spike in sympathy.
window.TC = window.TC || {};

TC.rivals = (() => {
  const st = () => TC.state.data;
  const $ = (id) => document.getElementById(id);
  const rand = (a, b) => a + Math.random() * (b - a);
  const NAMES = ["BLND", "SNEK", "GRFT", "YACHT", "VAPR", "MOAT", "HYPE", "DUNE", "KRILL", "FOMO", "LOOP", "BRRR"];

  const rivals = NAMES.map((sym) => {
    const p = Math.exp(rand(Math.log(4), Math.log(900)));
    return { sym, price: p, open: p };
  });
  let t = 0;
  let cells = [];
  const hot = {};        // sym -> seconds left of glow
  let link = null;       // { r, until, last } rival that follows your price (partnership)
  const find = (sym) => rivals.find((r) => r.sym === sym);

  function render() {
    // Two copies of the strip so the CSS scroll loops without a seam
    const track = $("rivalsTrack");
    track.replaceChildren();
    cells = [];
    for (let copy = 0; copy < 2; copy++) {
      const you = document.createElement("span");
      you.className = "rv rv-you";
      track.appendChild(you);
      cells.push({ el: you, you: true });
      for (const r of rivals) {
        const el = document.createElement("span");
        el.className = "rv";
        track.appendChild(el);
        cells.push({ el, r });
      }
    }
  }

  function paint() {
    const s = st();
    for (const c of cells) {
      let sym, price, ch;
      if (c.you) {
        sym = s.symbol; price = TC.market.quote();
        ch = s.dayOpen > 0 ? price / s.dayOpen - 1 : price > 0 ? 1 : 0;
      } else {
        sym = c.r.sym; price = c.r.price; ch = price / c.r.open - 1;
      }
      const dir = ch > 0.0005 ? "up" : ch < -0.0005 ? "down" : "flat";
      c.el.dataset.dir = dir;
      c.el.classList.toggle("rv-hot", !c.you && hot[c.r.sym] > 0);
      const move = c.you && s.dayOpen <= 0 ? "NEW" : `${dir === "down" ? "▼" : "▲"}${Math.abs(ch * 100).toFixed(1)}%`;
      c.el.textContent = `$${sym} ${TC.format.axis(price).slice(1)} ${move}`;
    }
  }

  function nudge(lo, hi, share = 0.6) {
    for (const r of rivals) if (Math.random() < share) r.price *= 1 + rand(lo, hi);
    paint();
  }

  const api = {
    names: () => NAMES.slice(),
    // A random rival symbol, optionally avoiding some
    pick(avoid = []) { const pool = NAMES.filter((n) => !avoid.includes(n)); return pool[Math.floor(Math.random() * pool.length)]; },
    move(sym, frac, glow = 3) {
      const r = find(sym);
      if (!r) return;
      r.price = Math.max(0.5, r.price * (1 + frac));
      hot[sym] = glow;
      paint();
    },
    change(sym) { const r = find(sym); return r ? r.price / r.open - 1 : 0; },
    // Partnership: the rival copies your % moves for `secs`
    link(sym, secs) { const r = find(sym); if (r) { link = { r, until: st().clock + secs, last: TC.market.quote() }; hot[sym] = secs; } },
    init() {
      render();
      paint();
      TC.events.on("news", ({ tone, big }) => {
        if (tone === "down") nudge(0.02, big ? 0.07 : 0.04);   // money rotates into rivals
        if (tone === "up") nudge(-0.04, big ? -0.01 : 0);      // and out of them
      });
      TC.events.on("sell", (e) => { if (e.manual) nudge(0.005, 0.03, 0.3); });
      // Sympathy: one rival moves with your big swings
      TC.events.on("bigMove", ({ dir, tier }) => {
        const r = rivals[Math.floor(Math.random() * rivals.length)];
        api.move(r.sym, (dir === "up" ? 1 : -1) * rand(0.03, 0.06) * (tier + 1), 2);
      });
      TC.events.on("reset", () => { link = null; });
    },
    update(dt) {
      for (const k in hot) if ((hot[k] -= dt) <= 0) delete hot[k];
      if (link) {
        const q = TC.market.quote();
        if (link.last > 0) link.r.price *= q / link.last;
        link.last = q;
        if (st().clock > link.until) link = null;
      }
      if ((t += dt) < 1.5) return;
      t = 0;
      for (const r of rivals) {
        const season = TC.seasons && TC.seasons.current();
        const lean = season === "bull" ? 0.004 : season === "bear" ? -0.004 : 0;
        r.price *= 1 + rand(-0.008, 0.0085) + lean;
        if (!season || season === "side") r.price += (r.open - r.price) * 0.01; // slow pull back toward the open
      }
      paint();
    },
  };
  return api;
})();
