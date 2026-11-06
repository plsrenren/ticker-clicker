// Game mode and shared randomness.
//
// TC.mode   { race, code }: race mode when the page is served at /race or /race/ABCD (see js/race.js).
// TC.rng.r(stream)  a random number in [0, 1). Solo: Math.random. In a race every player gets the same
//   seed, so each named stream ("newsGap", "newsPick", "outcome", "season") hands out the same sequence
//   to everyone: the same events come in the same order and seasons change at the same moments.
window.TC = window.TC || {};

TC.mode = (() => {
  const m = location.pathname.match(/^\/race(?:\/([A-Za-z]{4}))?\/?$/);
  return { race: !!m && /^https?:$/.test(location.protocol), code: m && m[1] ? m[1].toUpperCase() : null };
})();

TC.rng = (() => {
  let seed = null;
  const streams = {};
  // mulberry32: tiny, fast, good enough for game dice
  function gen(a) {
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hash(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  return {
    seed(n) { seed = n == null ? null : n >>> 0; for (const k in streams) delete streams[k]; },
    seeded: () => seed !== null,
    r(name) {
      if (seed === null) return Math.random();
      return (streams[name] || (streams[name] = gen(seed ^ hash(name))))();
    },
  };
})();
