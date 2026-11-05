// Market seasons: the whole market cycles Bull -> Bear -> (sometimes Sideways), 2-4 minutes each,
// with a 15s warning before each change. Other modules read the current season's modifiers:
//   market.js   buyerMult(), genMult(id) buyers faster in a bull, slower in a bear; bear nerfs retail + finfluencers
//   moves.js    moveBag()               silent swings lean up / down / choppy
//   news.js     pickNews(), beatOdds(), gapMult()   which events fire, and how often
//   trade.js    peakExtra(), dipLine(), stackMult() bull: +1x peak sells; bear: dips easier, stacks 1.5x
// A bear market also slowly bleeds the price, and your own sells/buys can backfire (see BACKFIRE). Starts once the price reaches $20.
window.TC = window.TC || {};

TC.seasons = (() => {
  const st = () => TC.state.data;
  const $ = (id) => document.getElementById(id);
  const rand = (a, b) => a + Math.random() * (b - a);
  const WARN = 15;
  const MIN_PRICE = 20;

  const SEASONS = {
    bull: {
      name: "Bull market", short: "BULL", buyer: 1.5, beat: 0.7, gap: 0.9, peakExtra: 1, dipLine: 0.88, stack: 1,
      news: { pump: 3, short: 2, earnings: 2, headline: 1, flash: 0.5 },
      bag: ["spike", "spike", "run", "run", "chop", "drop", "wick"],
      bleed: 0,
    },
    bear: {
      // Short and brutal: 45-75s. Retail traders and finfluencers mostly sit it out.
      name: "Bear market", short: "BEAR", buyer: 0.7, beat: 0.3, gap: 0.45, peakExtra: 0, dipLine: 0.92, stack: 1.5,
      dur: [45, 75], amp: 1.7, gen: { retail: 0.15, influ: 0.15 },
      news: { headline: 3, flash: 2, short: 2, earnings: 1, pump: 0.5 },
      bag: ["drop", "drop", "slide", "slide", "wick", "chop", "spike"],
      bleed: 0.004, // fraction of price lost per second (about -20% over a minute)
    },
    side: {
      name: "Sideways market", short: "FLAT", buyer: 1, beat: 0.55, gap: 1.5, peakExtra: 0, dipLine: 0.88, stack: 1,
      news: { headline: 1, flash: 1, short: 1, earnings: 1, pump: 1 },
      bag: ["chop", "chop", "chop", "wick", "spike", "drop"],
      bleed: 0,
    },
  };

  let id = null;      // null until the price first reaches MIN_PRICE
  let left = 0;       // seconds until the next change
  let next = null;
  let warned = false;
  let lastKey = "";

  // Bear-market backfires: your own trades can spook the market.
  //   SELL       35% chance of PANIC SELLING: another 10-20% drop over 1.5s
  //   tap / buy  2% chance per tap of a BULL TRAP: price snaps back down 6-12% (at most once every 8s)
  //   dip stack  25% chance the bounce is a BULL TRAP that gives back 8-14% right after
  const BACKFIRE = { sell: 0.35, tap: 0.02, stack: 0.25, tapGap: 8 };
  let shock = null;       // { f, d, t, applied } price move in progress
  let trapReadyAt = 0;
  function backfire(f, d, title) {
    if (shock) return;
    shock = { f, d, t: 0, applied: 0 };
    TC.events.emit("backfire", { title });
  }

  const cur = () => SEASONS[id] || SEASONS.side;

  function pickNext() {
    if (id === "bull") return Math.random() < 0.75 ? "bear" : "side";
    if (id === "bear") return Math.random() < 0.75 ? "bull" : "side";
    return Math.random() < 0.5 ? "bull" : "bear";
  }

  function enter(newId) {
    id = newId;
    const d = cur().dur || [120, 240];
    left = rand(d[0], d[1]);
    next = pickNext();
    warned = false;
    document.documentElement.dataset.season = id;
    TC.events.emit("season", { id, name: cur().name });
  }

  // The season lives in the save so a reload or an update keeps it
  function persist() { st().season = id ? { id, left, next, warned } : null; }
  function restore() {
    const sv = st().season;
    if (!sv || !SEASONS[sv.id]) return false;
    id = sv.id; left = sv.left; next = SEASONS[sv.next] ? sv.next : pickNext(); warned = !!sv.warned;
    document.documentElement.dataset.season = id;
    return true;
  }

  function render() {
    const el = $("season");
    if (!el) return;
    if (!id) { if (lastKey) { el.hidden = true; lastKey = ""; } return; }
    const secs = Math.ceil(left);
    const text = left <= WARN
      ? SEASONS[next].short + " IN " + secs + "s"
      : cur().short + " · " + Math.floor(secs / 60) + ":" + String(secs % 60).padStart(2, "0");
    const key = id + text + (left <= WARN);
    if (key === lastKey) return;
    lastKey = key;
    el.hidden = false;
    el.dataset.season = id;
    el.dataset.warn = left <= WARN ? next : "";
    el.textContent = text;
  }

  const api = {
    current: () => id,
    buyerMult: () => (id ? cur().buyer : 1),
    moveBag: () => (id ? cur().bag : null),
    beatOdds: () => (id ? cur().beat : 0.55),
    gapMult: () => (id ? cur().gap : 1),
    peakExtra: () => (id ? cur().peakExtra : 0),
    dipLine: () => (id ? cur().dipLine : 0.88),
    stackMult: () => (id ? cur().stack : 1),
    moveAmp: () => (id ? cur().amp || 1 : 1),
    // Per-buyer multiplier (bear market nerfs retail traders and finfluencers)
    genMult: (gid) => (id && cur().gen && cur().gen[gid] != null ? cur().gen[gid] : 1),
    // Weighted random news type for this season
    pickNews(types) {
      if (!id) return types[Math.floor(Math.random() * types.length)];
      const w = cur().news;
      const total = types.reduce((sum, t) => sum + (w[t] ?? 1), 0);
      let r = Math.random() * total;
      for (const t of types) { r -= w[t] ?? 1; if (r <= 0) return t; }
      return types[types.length - 1];
    },
    // Force a season by hand: TC.seasons.set("bear")
    set(newId) { if (SEASONS[newId]) enter(newId); },

    init() {
      TC.events.on("reset", () => { id = null; shock = null; delete document.documentElement.dataset.season; render(); });
      TC.events.on("sell", (e) => {
        if (id === "bear" && e.manual && Math.random() < BACKFIRE.sell) backfire(-rand(0.1, 0.2), 1.5, "PANIC SELLING");
      });
      TC.events.on("buy", (e) => {
        if (id !== "bear" || e.stack || !e.manual) return;
        const now = st().clock;
        if (now >= trapReadyAt && Math.random() < BACKFIRE.tap) {
          trapReadyAt = now + BACKFIRE.tapGap;
          backfire(-rand(0.06, 0.12), 0.6, "BULL TRAP");
        }
      });
      TC.events.on("stackBuy", () => {
        // Let the stack land first, then maybe pull the rug
        if (id === "bear" && Math.random() < BACKFIRE.stack) setTimeout(() => backfire(-rand(0.08, 0.14), 0.8, "BULL TRAP"), 1000);
      });
    },

    update(dt) {
      const s = st();
      if (!s.listed) return;
      if (!id && restore()) { render(); return; }
      if (!id) {
        if (s.basePrice >= MIN_PRICE) { enter("bull"); persist(); }
        render();
        return;
      }
      left -= dt;
      if (!warned && left <= WARN) {
        warned = true;
        TC.events.emit("seasonWarn", { next, name: SEASONS[next].name });
      }
      if (left <= 0) enter(next);
      persist();
      if (shock) {
        shock.t += dt;
        const p = Math.min(1, shock.t / shock.d);
        const step = Math.pow(1 + shock.f, p) / Math.pow(1 + shock.f, shock.applied) - 1;
        if (Math.abs(step) > 1e-5) { TC.market.shift(step, "backfire"); shock.applied = p; }
        if (p >= 1) shock = null;
      }
      // Bear markets slowly bleed (quietly: no trade feed spam)
      const bleed = cur().bleed;
      if (bleed && !(TC.news && TC.news.active())) s.basePrice *= 1 - bleed * dt;
      render();
    },
  };
  return api;
})();
