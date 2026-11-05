// Game state plus save/load. Everything that should survive a reload lives here.
//
// Two kinds of fields:
//   run fields  (fresh each listing; wiped when you go private)
//   meta fields (kept forever: founder points, achievements, lifetime stats, settings)
window.TC = window.TC || {};

TC.state = (() => {
  const KEY = "ticker-clicker-v1";
  const META = ["prestige", "achievements", "lifetime", "settings", "lastSeen"];

  function fresh() {
    return {
      // ---- run ----
      symbol: "YOU",
      listed: false,     // false until the player names their ticker on the IPO screen
      basePrice: 0,      // the "true" price
      cash: 0,           // spendable money, paid out by your shares as dividends
      shares: TC.config.startShares,
      clock: 0,          // seconds played while listed (drives the sell cooldown)
      sellReadyAt: 0,
      sells: 0,
      bestMilestone: 0,
      orders: 0,         // manual buys this run
      owned: {},         // generator id -> count
      upgrades: {},      // upgrade id -> true
      dayOpen: 0,        // price at the start of this session, for the change readout
      bestPrice: 0,      // best price this run (drives reveals and founder points)

      // ---- meta ----
      prestige: { points: 0, count: 0 },
      achievements: {},  // id -> unix ms unlocked
      lifetime: { taps: 0, sells: 0, shortWins: 0, flashSurvived: 0, bestPrice: 0 },
      settings: { chart: "line", sound: true },
      lastSeen: 0,       // unix ms of the last save, for offline earnings
    };
  }

  const s = fresh();

  return {
    data: s,
    fresh,
    load() {
      try {
        const raw = localStorage.getItem(KEY);
        if (raw) {
          const saved = JSON.parse(raw);
          const base = fresh();
          // merge nested meta objects so new fields get defaults
          for (const k of ["prestige", "lifetime", "settings"]) saved[k] = Object.assign(base[k], saved[k] || {});
          Object.assign(s, base, saved);
        }
      } catch (e) { /* storage unavailable: play without saving */ }
      if (s.basePrice > 0) s.listed = true; // older saves predate the IPO screen
      s.dayOpen = s.basePrice;
    },
    save() {
      s.lastSeen = Date.now();
      try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* ignore */ }
    },
    // Go private: wipe the run, keep the meta.
    newRun() {
      const keep = {};
      for (const k of META) keep[k] = s[k];
      Object.assign(s, fresh(), keep);
    },
    // Delist: wipe everything.
    reset() {
      Object.assign(s, fresh());
      try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
    },
  };
})();
