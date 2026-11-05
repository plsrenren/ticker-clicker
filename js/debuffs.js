// Debuffs: timed penalties that linger after a bad move, shown as red timer chips by the season chip.
//   Reputation damage  buyers 50% for 30s   after a PANIC SELLING or BULL TRAP backfire
//   Retail spooked     retail traders 80% for 20s   when a BUY THE DIP window passes unused
// Stored in state.debuffs (id -> game-clock end time), so they survive a reload.
window.TC = window.TC || {};

TC.debuffs = (() => {
  const st = () => TC.state.data;
  const $ = (id) => document.getElementById(id);

  const TYPES = {
    rep:    { name: "Reputation damage", short: "REP", dur: 30, buyer: 0.5 },
    retail: { name: "Retail spooked", short: "RETAIL", dur: 20, gen: { retail: 0.8 } },
  };
  let lastKey = "";

  const list = () => st().debuffs || (st().debuffs = {});
  const activeIds = () => Object.keys(list()).filter((id) => TYPES[id] && list()[id] > st().clock);

  function render() {
    const el = $("debuffs");
    if (!el) return;
    const ids = activeIds();
    const parts = ids.map((id) => {
      const t = TYPES[id];
      const pct = t.buyer ? Math.round((1 - t.buyer) * 100) : Math.round((1 - Object.values(t.gen)[0]) * 100);
      return { id, text: t.short + " −" + pct + "% " + Math.ceil(list()[id] - st().clock) + "s", title: t.name };
    });
    const key = parts.map((p) => p.text).join("|");
    if (key === lastKey) return;
    lastKey = key;
    el.replaceChildren(...parts.map((p) => {
      const c = document.createElement("span");
      c.className = "debuff-chip";
      c.title = p.title;
      c.textContent = p.text;
      return c;
    }));
    el.hidden = !parts.length;
  }

  const api = {
    TYPES,
    active: (id) => list()[id] > st().clock,
    add(id) {
      const t = TYPES[id];
      if (!t) return;
      const wasOn = api.active(id);
      list()[id] = st().clock + t.dur; // re-applying refreshes the timer
      if (!wasOn) TC.events.emit("debuff", { id, name: t.name });
    },
    buyerMult: () => activeIds().reduce((m, id) => m * (TYPES[id].buyer || 1), 1),
    genMult: (gid) => activeIds().reduce((m, id) => m * ((TYPES[id].gen && TYPES[id].gen[gid]) || 1), 1),

    init() {
      TC.events.on("backfire", () => api.add("rep"));
      TC.events.on("dipMissed", () => api.add("retail"));
      TC.events.on("reset", () => { lastKey = ""; render(); });
    },
    update() {
      const l = list();
      for (const id in l) if (l[id] <= st().clock) delete l[id];
      render();
    },
  };
  return api;
})();
