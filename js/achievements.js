// Achievements: goals beyond the number going up. Each one adds cfg.achievementBonus forever.
// Two kinds of checks:
//   test(s)        polled twice a second against state
//   on: [event, fn] unlocked when a game event matches
window.TC = window.TC || {};

TC.achievements = (() => {
  const st = () => TC.state.data;
  const $ = (id) => document.getElementById(id);
  const totalBuyers = (s) => Object.values(s.owned).reduce((a, b) => a + b, 0);

  const LIST = [
    { id: "first",    name: "First trade",           desc: "Tap the chart once",               test: (s) => s.lifetime.taps >= 1 },
    { id: "p100",     name: "Triple digits",         desc: "Reach a $100 price",               test: (s) => s.lifetime.bestPrice >= 100 },
    { id: "p1k",      name: "Four figures",          desc: "Reach $1K",                        test: (s) => s.lifetime.bestPrice >= 1e3 },
    { id: "p1m",      name: "Millionaire ticker",    desc: "Reach $1M",                        test: (s) => s.lifetime.bestPrice >= 1e6 },
    { id: "p1b",      name: "Billion-dollar baby",   desc: "Reach $1B",                        test: (s) => s.lifetime.bestPrice >= 1e9 },
    { id: "taps1k",   name: "Carpal tunnel",         desc: "Tap 1,000 times",                  test: (s) => s.lifetime.taps >= 1000 },
    { id: "taps10k",  name: "Diamond fingers",       desc: "Tap 10,000 times",                 test: (s) => s.lifetime.taps >= 10000 },
    { id: "crowd",    name: "Crowded trade",         desc: "Own 50 buyers at once",            test: (s) => totalBuyers(s) >= 50 },
    { id: "sell1",    name: "Took profits",          desc: "Sell for the first time",          on: ["sell", (e) => e.manual] },
    { id: "top",      name: "Sold the top",          desc: "Sell within 5% of your best price, above $100", on: ["sell", (e) => e.manual && e.atTop && st().bestPrice > 100] },
    { id: "flash",    name: "Survived a flash crash", desc: "Ride out a flash crash",          on: ["newsEnd", (e) => e.type === "flash"] },
    { id: "defend",   name: "Held the line",         desc: "Save half of a headline crash",    on: ["newsEnd", (e) => e.type === "headline" && e.saved >= 0.5] },
    { id: "squeeze",  name: "Squeezed",              desc: "Win a short attack",               on: ["news", (e) => e.type === "squeeze"] },
    { id: "squeeze10", name: "Short-seller nightmare", desc: "Win 10 short attacks",           test: (s) => s.lifetime.shortWins >= 10 },
    { id: "beat",     name: "Beat estimates",        desc: "Have an earnings beat",            on: ["news", (e) => e.type === "beat"] },
    { id: "miss",     name: "Guidance cut",          desc: "Have an earnings miss",            on: ["news", (e) => e.type === "miss"] },
    { id: "viral",    name: "Going viral",           desc: "Get pumped by a finfluencer",      on: ["news", (e) => e.type === "pump"] },
    { id: "private",  name: "Gone private",          desc: "Go private once",                  test: (s) => s.prestige.count >= 1 },
    { id: "serial",   name: "Serial founder",        desc: "Go private 5 times",               test: (s) => s.prestige.count >= 5 },
    { id: "sleep",    name: "Market never sleeps",   desc: "Collect offline earnings",         on: ["offline", () => true] },
  ];

  let pollT = 0;
  let toastTimer = null;

  function unlock(a) {
    const s = st();
    if (s.achievements[a.id]) return;
    s.achievements[a.id] = Date.now();
    toast(a);
    TC.events.emit("achievement", { id: a.id, name: a.name });
  }

  function toast(a) {
    const el = $("toast");
    $("toastName").textContent = a.name;
    $("toastDesc").textContent = a.desc + " · +" + Math.round(TC.config.achievementBonus * 100) + "% forever";
    el.hidden = false;
    el.classList.remove("in"); void el.offsetWidth; el.classList.add("in");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 3200);
  }

  return {
    LIST,
    init() {
      for (const a of LIST) if (a.on) TC.events.on(a.on[0], (e) => { if (a.on[1](e || {})) unlock(a); });
      TC.events.on("news", (e) => { if (e.type === "squeeze") st().lifetime.shortWins++; });
      TC.events.on("newsEnd", (e) => { if (e.type === "flash") st().lifetime.flashSurvived++; });
    },
    update(dt) {
      if ((pollT += dt) < 0.5) return;
      pollT = 0;
      const s = st();
      for (const a of LIST) if (a.test && !s.achievements[a.id] && a.test(s)) unlock(a);
    },
    count: () => Object.keys(st().achievements).length,
  };
})();
