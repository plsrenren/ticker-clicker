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

  // Each rival has a share price and a share count, so a market cap. Caps are spread evenly (in log terms)
  // from about $1B to $800B, so you pass one every so often on the way to going private at $1T.
  const rivals = NAMES.map((sym, i) => {
    const p = Math.exp(rand(Math.log(4), Math.log(900)));
    const cap = Math.exp(Math.log(1e9) + (Math.log(8e11) - Math.log(1e9)) * (i + rand(-0.3, 0.3)) / (NAMES.length - 1));
    return { sym, price: p, open: p, shares: cap / p };
  });
  const capOf = (r) => r.price * r.shares;
  let order = "";        // current ranking, to re-render only when it changes
  let passedSet = null;  // rivals already below you (for "PASSED" call-outs)
  let t = 0;
  let cells = [];
  const hot = {};        // sym -> seconds left of glow
  let link = null;       // { r, until, last } rival that follows your price (partnership)
  const find = (sym) => rivals.find((r) => r.sym === sym);

  // Everyone, you included, sorted by market cap (biggest first)
  function ranked() {
    const you = TC.market.marketCap(TC.market.quote());
    return rivals.map((r) => ({ r, cap: capOf(r) })).concat([{ you: true, cap: you }]).sort((a, b) => b.cap - a.cap);
  }

  function render() {
    // Two copies of the strip so the CSS scroll loops without a seam
    const track = $("rivalsTrack");
    track.replaceChildren();
    cells = [];
    const list = ranked();
    order = list.map((x) => (x.you ? "*" : x.r.sym)).join(",");
    for (let copy = 0; copy < 2; copy++) {
      list.forEach((x, i) => {
        const el = document.createElement("span");
        el.className = "rv" + (x.you ? " rv-you" : "");
        track.appendChild(el);
        cells.push(x.you ? { el, you: true, rank: i + 1 } : { el, r: x.r, rank: i + 1 });
      });
    }
  }

  // Re-rank; call out each rival you just passed
  function rerank() {
    const list = ranked();
    const key = list.map((x) => (x.you ? "*" : x.r.sym)).join(",");
    const youAt = list.findIndex((x) => x.you);
    const below = new Set(list.slice(youAt + 1).map((x) => x.r.sym));
    if (passedSet && st().listed) {
      const fresh = [...below].filter((s) => !passedSet.has(s));
      if (fresh.length) TC.events.emit("passed", { syms: fresh, rank: youAt + 1, total: list.length });
    }
    passedSet = below;
    if (key !== order) render();
  }

  function paint() {
    const s = st();
    for (const c of cells) {
      let sym, cap, ch;
      if (c.you) {
        sym = s.symbol; cap = TC.market.marketCap(TC.market.quote());
        ch = s.dayOpen > 0 ? TC.market.quote() / s.dayOpen - 1 : cap > 0 ? 1 : 0;
      } else {
        sym = c.r.sym; cap = capOf(c.r); ch = c.r.price / c.r.open - 1;
      }
      const dir = ch > 0.0005 ? "up" : ch < -0.0005 ? "down" : "flat";
      c.el.dataset.dir = dir;
      c.el.classList.toggle("rv-hot", !c.you && hot[c.r.sym] > 0);
      const move = c.you && s.dayOpen <= 0 ? "NEW" : `${dir === "down" ? "▼" : "▲"}${Math.abs(ch * 100).toFixed(1)}%`;
      c.el.textContent = `#${c.rank} $${sym} ${TC.format.axis(cap)} ${move}`;
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
      TC.events.on("reset", () => { passedSet = null; order = ""; render(); paint(); });
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
      if (st().listed) rerank();
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
