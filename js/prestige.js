// Going private: cash out the run for permanent founder points.
// Each point adds cfg.prestige.perPoint to taps, buyers and dividends forever (see market.metaMult).
window.TC = window.TC || {};

TC.prestige = (() => {
  const cfg = TC.config;
  const st = () => TC.state.data;

  const api = {
    pointsFor(best) { return Math.floor(Math.sqrt(best / cfg.prestige.scale)); },
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
