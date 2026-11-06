// Hype moves: events you trigger yourself from the bar above the dock, each with a cooldown.
//   Press release  - steady rally
//   Tweet storm    - buyers 3x and taps 2x for a few seconds
//   Merger rumor   - a gamble: big pump, or the rumor gets denied and the price drops
//   Earnings call  - starts an earnings event early with much better odds of a beat
// Unlocked by your best share price this run. Cooldowns run on the game clock.
window.TC = window.TC || {};

TC.hype = (() => {
  const st = () => TC.state.data;
  const $ = (id) => document.getElementById(id);
  const rand = (a, b) => a + Math.random() * (b - a);
  const STEP = 0.1;

  const moves = [
    {
      id: "pr", name: "Press release", unlock: 25, cooldown: 25,
      run() {
        if (scandal()) return scandalHit();
        play([{ f: rand(0.1, 0.16), d: 2.5 }]);
        return { title: "PRESS RELEASE", tone: "up" };
      },
    },
    {
      id: "tweet", name: "Tweet storm", unlock: 75, cooldown: 45,
      run() {
        if (scandal()) return scandalHit();
        boostUntil = st().clock + 10;
        play([{ f: rand(0.03, 0.06), d: 1.5 }]);
        return { title: "TWEET STORM", tone: "up" };
      },
    },
    {
      id: "rumor", name: "Merger rumor", unlock: 300, cooldown: 70,
      run() {
        if (Math.random() < 0.7) {
          const up = rand(0.18, 0.3);
          play([{ f: up, d: 3 }, { f: (1 + up * 0.66) / (1 + up) - 1, d: 3 }]);
          return { title: "MERGER RUMOR", tone: "up" };
        }
        play([{ f: -rand(0.08, 0.12), d: 1 }]);
        // Getting caught locks every hype move for 30s
        const until = st().clock + 30;
        for (const x of moves) readyAt[x.id] = Math.max(readyAt[x.id] || 0, until);
        lockedUntil = until;
        return { title: "RUMOR DENIED", tone: "down" };
      },
    },
    {
      id: "call", name: "Earnings call", unlock: 1200, cooldown: 100,
      blocked: () => !!(TC.news && TC.news.active()),
      run() {
        TC.news.trigger("earnings", { beatOdds: 0.8 });
        return null; // the news banner does the talking
      },
    },
  ];

  // Icons (inline SVG, drawn in currentColor so they follow each state's colour)
  const ICONS = {
    pr: '<path d="M3 10v4h3l7 5V5L6 10H3z" fill="currentColor"/><path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    tweet: '<path d="M4 5h16v10H9l-5 4z" fill="currentColor"/>',
    rumor: '<circle cx="9" cy="12" r="5" fill="none" stroke="currentColor" stroke-width="2.2"/><circle cx="15" cy="12" r="5" fill="none" stroke="currentColor" stroke-width="2.2"/>',
    call: '<rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor"/><path d="M6 11a6 6 0 0 0 12 0M12 17v4M9 21h6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    lock: '<rect x="5" y="10" width="14" height="10" rx="2" fill="currentColor"/><path d="M8 10V7a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" stroke-width="2"/>',
  };
  const svg = (id) => '<svg class="hype-ic" viewBox="0 0 24 24" aria-hidden="true">' + ICONS[id] + "</svg>";

  const readyAt = {};      // id -> game clock time it's ready again
  let lockedUntil = -1;    // all hype locked after a denied rumor
  // In a bear market, a press release or tweet storm has a 30% chance to blow up into a scandal
  const scandal = () => TC.seasons && TC.seasons.current() === "bear" && Math.random() < 0.3;
  function scandalHit() {
    play([{ f: -rand(0.1, 0.18), d: 1.2 }]);
    return { title: "SCANDAL", tone: "down" };
  }
  let boostUntil = -1;     // tweet storm end time
  let segs = null, seg = 0, segT = 0, acc = 0, applied = 0;
  const els = {};

  // Run a list of price segments ({ f: fraction, d: seconds }), smoothly
  function play(list) { segs = list; seg = 0; segT = 0; acc = 0; applied = 0; }

  function status(m) {
    const s = st();
    if (s.bestPrice < m.unlock) return { state: "locked", sub: TC.format.axis(TC.market.marketCap(m.unlock)) + " cap" };
    const left = (readyAt[m.id] || 0) - s.clock;
    if (left > 0) {
      const locked = s.clock < lockedUntil;
      return { state: "cooling", sub: (locked ? "Locked " : "") + Math.ceil(left) + "s", frac: Math.min(1, left / m.cooldown) };
    }
    if (m.blocked && m.blocked()) return { state: "blocked", sub: "Wait" };
    return { state: "ready", sub: "Ready" };
  }

  const api = {
    moves,
    busy: () => !!segs,
    boosted: () => st().clock < boostUntil,
    buyerMult: () => (api.boosted() ? 3 : 1),
    tapMult: () => (api.boosted() ? 2 : 1),

    activate(id) {
      const m = moves.find((x) => x.id === id);
      if (!m || !st().listed || status(m).state !== "ready") return false;
      readyAt[id] = st().clock + m.cooldown * (TC.market.has("agency") ? 0.75 : 1);
      const info = m.run();
      TC.events.emit("hype", { id, ...(info || {}) });
      return true;
    },

    init() {
      const bar = $("hypeBar");
      for (const m of moves) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "hype-btn";
        b.dataset.id = m.id;
        b.innerHTML = '<span class="hype-top"><span class="hype-icon"></span><span class="hype-sub"></span></span><span class="hype-name"></span>';
        b.querySelector(".hype-name").textContent = m.name;
        b.addEventListener("click", () => api.activate(m.id));
        bar.appendChild(b);
        els[m.id] = { b, sub: b.querySelector(".hype-sub"), icon: b.querySelector(".hype-icon"), key: "", ic: "" };
      }
      TC.events.on("reset", () => {
        for (const k in readyAt) delete readyAt[k];
        boostUntil = -1; segs = null; lockedUntil = -1;
      });
    },

    update(dt) {
      const s = st();
      if (segs && s.listed) {
        const cur = segs[seg];
        segT += dt; acc += dt;
        if (acc >= STEP || segT >= cur.d) {
          const p = Math.min(1, segT / cur.d);
          const step = Math.pow(1 + cur.f, p) / Math.pow(1 + cur.f, applied) - 1;
          if (Math.abs(step) > 1e-6) TC.market.shift(step, "hype");
          applied = p; acc = 0;
        }
        if (segT >= cur.d) {
          seg++; segT = 0; applied = 0;
          if (seg >= segs.length) segs = null;
        }
      }
      // Buttons
      for (const m of moves) {
        const e = els[m.id];
        if (!e) continue;
        const v = status(m);
        const boostOn = m.id === "tweet" && api.boosted();
        const sub = boostOn ? "Live " + Math.ceil(boostUntil - s.clock) + "s" : v.sub;
        const key = v.state + sub;
        e.b.style.setProperty("--cd", v.frac ? v.frac.toFixed(3) : 0);
        if (key === e.key) continue;
        e.key = key;
        e.b.dataset.state = boostOn ? "live" : v.state;
        e.b.disabled = v.state !== "ready";
        // Locked: the lock icon says it, so the chip just shows the cap it unlocks at
        e.sub.textContent = v.state === "locked" ? sub.replace(" cap", "") : sub;
        e.b.title = v.state === "locked" ? "Unlocks at " + sub : m.name;
        const ic = v.state === "locked" ? "lock" : m.id;
        if (ic !== e.ic) { e.ic = ic; e.icon.innerHTML = svg(ic); }
      }
    },
  };
  return api;
})();
