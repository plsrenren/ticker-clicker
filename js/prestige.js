// Going private: cash out the run for permanent founder points.
// Each point adds cfg.prestige.perPoint to taps, buyers and dividends forever (see market.metaMult).
window.TC = window.TC || {};

TC.prestige = (() => {
  const cfg = TC.config;
  const st = () => TC.state.data;

  const api = {
    // Points grow with each 10x of your best price (log scale), so a long run can't snowball the next one.
    // Your stake scales the payout: 5% is 1x, 10% is 2x, capped 0.25x-3x. Always at least 1 point.
    stakeMult() { return Math.max(0.25, Math.min(3, TC.market.stakePct() / cfg.prestige.stakeBase)); },
    pointsFor(best) {
      const decades = Math.log10(Math.max(1, best / cfg.prestige.scale));
      return Math.max(1, Math.floor(cfg.prestige.perDecade * decades * api.stakeMult()));
    },
    unlocked() { return st().listed && st().bestPrice >= cfg.prestige.minPrice; },
    available() { return api.unlocked() ? api.pointsFor(st().bestPrice) : 0; },

    // Bank the points; main.js listens for "private" and starts a new run.
    goPrivate() {
      const pts = api.available();
      if (!pts) return false;
      const s = st();
      s.prestige.points += pts;
      s.prestige.count++;
      TC.events.emit("private", { points: pts, total: s.prestige.points, symbol: s.symbol, best: s.bestPrice });
      return true;
    },
  };
  return api;
})();
