// Market events ("news"): random shocks that crash or pump the price.
//
// Each event type is a factory in `types` returning an object with:
//   start()            show the banner, set things up
//   update(dt) -> bool keep running? (false = done)
//   onTap()            optional: called for each manual buy while active
// Events move the real price through TC.market.shift(), so they change your dividends too.
// The scheduler fires one at a time; TC.news.trigger("flash") fires one by hand.
window.TC = window.TC || {};

TC.news = (() => {
  const cfg = TC.config;
  const st = () => TC.state.data;
  const $ = (id) => document.getElementById(id);
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const sym = () => "$" + st().symbol;
  const pct = (f) => (f >= 0 ? "+" : "−") + Math.round(Math.abs(f) * 100) + "%";
  // Flavor text (flavor.js): L("key", { r: "$SNEK", pct: "+20%" })
  const L = (key, vars) => TC.flavor.line(key, Object.assign({ you: sym() }, vars));

  let active = null;
  let nextAt = null;
  let boostUntil = -1; // rival scandal: buyers 2x
  const rival = (avoid) => TC.rivals.pick(avoid);
  // Rival headlines are picked separately from the classic ones (see trigger), weighted by season.
  const CLASSIC = ["headline", "flash", "short", "earnings", "pump"];
  const RIVAL_W = {
    bull: { takeover: 3, rivalScandal: 2, partner: 2, copycat: 1, hostile: 1, sector: 0.3, poach: 1 },
    bear: { takeover: 1, rivalScandal: 1, partner: 0.5, copycat: 2, hostile: 2, sector: 3, poach: 2 },
    side: { takeover: 1, rivalScandal: 1, partner: 1, copycat: 1, hostile: 1, sector: 1, poach: 1 },
  };
  function pickRival() {
    const w = RIVAL_W[(TC.seasons && TC.seasons.current()) || "side"] || RIVAL_W.side;
    const names = Object.keys(w);
    let r = Math.random() * names.reduce((s, n) => s + w[n], 0);
    for (const n of names) { r -= w[n]; if (r <= 0) return n; }
    return names[0];
  }

  // ---------- Banner UI ----------
  const banner = {
    show({ tag, text, tone, sub = "", meter = null }) {
      const el = $("news");
      el.dataset.tone = tone; // "down" | "up" | "neutral"
      $("newsTag").textContent = tag;
      $("newsText").textContent = text;
      $("newsSub").textContent = sub;
      $("newsMeter").hidden = meter === null;
      if (meter) banner.meter(meter.a, meter.b);
      el.hidden = false;
      el.classList.remove("in"); void el.offsetWidth; el.classList.add("in");
    },
    sub(text) { $("newsSub").textContent = text; },
    text(text) { $("newsText").textContent = text; },
    // Two-sided bar: a = red share filled from the left, b = green share filled from the right
    meter(a, b) {
      $("newsRed").style.width = Math.min(100, a * 100) + "%";
      $("newsGreen").style.width = Math.min(100, b * 100) + "%";
    },
    hide() { $("news").hidden = true; },
  };

  // Spread a total fractional move over `chunks` steps of the price.
  function chunked(totalFrac, chunks) {
    return Math.pow(1 + totalFrac, 1 / chunks) - 1;
  }

  // ---------- Event types ----------
  const types = {
    // Bad headline: drops 20-40% over 4s; every tap shaves the remaining drop.
    headline() {
      const T = 4, CH = 20;
      let t = 0, tick = 0, done = 0, applied = 0;
      let remaining = rand(0.2, 0.4);
      const full = remaining;
      return {
        start() {
          banner.show({ tag: "BREAKING", tone: "down", text: L("headline"), sub: L("headlineSub"), meter: { a: 0, b: 0 } });
          TC.events.emit("news", { type: "headline", tone: "down" });
        },
        onTap() { remaining *= 0.965; },
        update(dt) {
          t += dt; tick += dt;
          while (tick >= T / CH && done < CH) {
            tick -= T / CH;
            const left = CH - done;
            const f = -remaining / left;
            applied += remaining / left;
            remaining -= remaining / left;
            done++;
            TC.market.shift(f, "headline");
          }
          // Red: how far the crash has run. Green: share of the drop your taps have saved.
          const saved = Math.max(0, 1 - (applied + remaining) / full);
          this.saved = saved;
          banner.meter((done / CH) * (1 - saved), saved);
          if (done >= CH) {
            banner.sub("Crash over. You saved " + Math.round(saved * 100) + "% of the drop");
            return t < T + 1.2;
          }
          return true;
        },
      };
    },

    // Flash crash: vertical drop, then most of it comes back.
    flash() {
      const drop = rand(0.3, 0.5);
      const back = rand(0.6, 0.8);
      let t = 0, phase = 0, startPrice = 0, bottom = 0;
      return {
        start() {
          startPrice = st().basePrice;
          banner.show({ tag: "FLASH CRASH", tone: "down", text: L("flash", { pct: pct(-drop) }), sub: L("flashSub") });
          TC.events.emit("news", { type: "flash", tone: "down", big: true });
          TC.market.shift(-drop * 0.6, "flash");
        },
        update(dt) {
          t += dt;
          if (phase === 0 && t > 0.15) {
            TC.market.shift((1 - drop) / (1 - drop * 0.6) - 1, "flash");
            bottom = st().basePrice;
            phase = 1;
          }
          if (phase === 1 && t > 2.5) {
            phase = 2;
            banner.show({ tag: "RECOVERING", tone: "up", text: L("recover"), sub: "" });
          }
          if (phase === 2) {
            // Climb back `back` of the gap over 2s, in small steps
            const target = bottom + (startPrice - bottom) * back;
            const gap = target - st().basePrice;
            if (gap > target * 0.001) TC.market.shift(Math.min(gap, (startPrice - bottom) * back * dt / 2) / st().basePrice, "flash");
            else return t < 6;
          }
          return t < 7;
        },
      };
    },

    // Short attack: out-tap the shorts before the bar fills.
    short() {
      const T = 6;
      const need = Math.round(cfg.news.shortTaps);
      let t = 0, taps = 0, resolved = false;
      return {
        start() {
          banner.show({ tag: "SHORT ATTACK", tone: "down", text: L("short"), sub: "Tap " + need + " times before the red bar fills", meter: { a: 0, b: 0 } });
          TC.events.emit("news", { type: "short", tone: "down" });
        },
        onTap() { if (!resolved) taps++; },
        update(dt) {
          t += dt;
          if (!resolved) {
            banner.meter(t / T * 0.5, taps / need * 0.5);
            banner.sub(Math.max(0, need - taps) + " taps left · " + Math.max(0, T - t).toFixed(1) + "s");
            if (taps >= need) {
              resolved = true;
              const up = rand(0.12, 0.2);
              banner.show({ tag: "SHORT SQUEEZE", tone: "up", text: L("squeeze", { pct: pct(up) }), sub: "" });
              TC.events.emit("news", { type: "squeeze", tone: "up", big: true });
              TC.market.shift(up, "short");
              t = T; // start the outro timer
            } else if (t >= T) {
              resolved = true;
              const down = rand(0.2, 0.3);
              banner.show({ tag: "SHORTS WIN", tone: "down", text: L("shortWin", { pct: pct(-down) }), sub: "" });
              TC.events.emit("news", { type: "shortwin", tone: "down", big: true });
              TC.market.shift(-down, "short");
            }
            return true;
          }
          return t < T + 2;
        },
      };
    },

    // Earnings: countdown, then a gap up or down.
    earnings(opts = {}) {
      const T = 5;
      const beat = Math.random() < (opts.beatOdds ?? (TC.seasons ? TC.seasons.beatOdds() : 0.55));
      const move = beat ? rand(0.15, 0.3) : -rand(0.1, 0.25);
      let t = 0, done = false, earnLine = "";
      return {
        start() {
          banner.show({ tag: "EARNINGS", tone: "neutral", text: (earnLine = TC.flavor.pick("earningsIn")).replace("{you}", sym()).replace("{n}", 5), sub: L("earningsSub") });
          TC.events.emit("news", { type: "earnings", tone: "neutral" });
        },
        update(dt) {
          t += dt;
          if (!done) {
            banner.text(earnLine.replace("{you}", sym()).replace("{n}", Math.max(1, Math.ceil(T - t))));
            if (t >= T) {
              done = true;
              banner.show({ tag: beat ? "BEAT" : "MISS", tone: beat ? "up" : "down", text: L(beat ? "beat" : "miss", { pct: pct(move) }), sub: "" });
              TC.events.emit("news", { type: beat ? "beat" : "miss", tone: beat ? "up" : "down", big: true });
              TC.market.shift(move, "earnings");
            }
            return true;
          }
          return t < T + 2.2;
        },
      };
    },

    // Pump and dump: rockets up 40-80%, then gives back 75-125% of the gain (can end below where it started).
    pump() {
      const gain = rand(0.4, 0.8);
      const giveBack = rand(0.75, 1.25);
      let t = 0, phase = 0, start = 0, peak = 0;
      return {
        start() {
          start = st().basePrice;
          banner.show({ tag: "PUMP", tone: "up", text: L("pump", { who: TC.flavor.pick("handles") }), sub: "" });
          TC.events.emit("news", { type: "pump", tone: "up", big: true });
        },
        update(dt) {
          t += dt;
          if (phase === 0) {
            // ease up over 2.5s
            const target = start * (1 + gain * Math.min(1, t / 2.5));
            if (target > st().basePrice) TC.market.shift(target / st().basePrice - 1, "pump");
            if (t >= 2.5) { phase = 1; peak = st().basePrice; banner.sub(L("pumpOut")); }
          } else if (phase === 1) {
            const p = Math.min(1, (t - 2.5) / 4);
            const target = Math.max(start * 0.3, peak - (peak - start) * giveBack * p);
            if (target < st().basePrice) TC.market.shift(target / st().basePrice - 1, "pump");
            if (p >= 1) return t < 7.5;
          }
          return true;
        },
      };
    },

    // ---------- Rival headlines: the tape's tickers get involved ----------
    // Takeover rumor (good): a rival "wants to buy you". Big pump, then the deal falls through.
    // Sell near the top to keep the gains (it counts as an event peak).
    takeover() {
      const R = rival(), gain = rand(0.25, 0.4), keep = 0.3;
      let t = 0, phase = 0, start = 0, peak = 0;
      return {
        start() {
          start = st().basePrice;
          banner.show({ tag: "TAKEOVER RUMOR", tone: "up", text: L("takeover", { r: "$" + R }), sub: "Sell before the deal falls through" });
          TC.events.emit("news", { type: "takeover", tone: "up", big: true });
          TC.rivals.move(R, rand(0.05, 0.1), 8);
        },
        update(dt) {
          t += dt;
          if (phase === 0) {
            const target = start * (1 + gain * Math.min(1, t / 3));
            if (target > st().basePrice) TC.market.shift(target / st().basePrice - 1, "takeover");
            if (t >= 5) { phase = 1; peak = st().basePrice; banner.show({ tag: "DEAL OFF", tone: "down", text: L("takeoverOff", { r: "$" + R }), sub: "" }); TC.rivals.move(R, -rand(0.08, 0.15), 4); }
          } else {
            const p = Math.min(1, (t - 5) / 2);
            const target = peak - (peak - start) * (1 - keep) * p;
            if (target < st().basePrice) TC.market.shift(target / st().basePrice - 1, "takeover");
            if (p >= 1) return t < 8.5;
          }
          return true;
        },
      };
    },

    // Rival scandal (good): a rival blows up and investors flee to you: buyers 2x for 10s.
    rivalScandal() {
      const R = rival();
      let t = 0;
      return {
        start() {
          banner.show({ tag: "SCANDAL AT $" + R, tone: "up", text: L("rivalScandal", { r: "$" + R }), sub: "Buyers 2x for 10s" });
          TC.events.emit("news", { type: "rivalScandal", tone: "up" });
          TC.rivals.move(R, -rand(0.3, 0.5), 10);
          boostUntil = st().clock + 10;
          TC.market.shift(rand(0.05, 0.1), "rivalScandal");
        },
        update(dt) { t += dt; return t < 4; },
      };
    },

    // Partnership (good): slow rally, and the rival moves with you for a minute.
    partner() {
      const R = rival(), gain = rand(0.15, 0.25);
      let t = 0, start = 0;
      return {
        start() {
          start = st().basePrice;
          banner.show({ tag: "PARTNERSHIP", tone: "up", text: L("partner", { r: "$" + R }), sub: "$" + R + " now moves with you" });
          TC.events.emit("news", { type: "partner", tone: "up" });
          TC.rivals.link(R, 60);
        },
        update(dt) {
          t += dt;
          const target = start * (1 + gain * Math.min(1, t / 6));
          if (target > st().basePrice) TC.market.shift(target / st().basePrice - 1, "partner");
          return t < 7;
        },
      };
    },

    // Index inclusion (good, once per run at a $100B market cap): buyers +25% for the rest of the run.
    index() {
      const R = rival();
      let t = 0;
      return {
        start() {
          st().indexed = true;
          banner.show({ tag: "INDEX INCLUSION", tone: "up", text: L("index", { r: "$" + R }), sub: "Buyers +25% for the rest of this run" });
          TC.events.emit("news", { type: "index", tone: "up", big: true });
          TC.rivals.move(R, -rand(0.15, 0.25), 10);
          TC.market.shift(rand(0.08, 0.12), "index");
        },
        update(dt) { t += dt; return t < 4.5; },
      };
    },

    // Copycat (bad): a rival launches a knockoff. Tap 15 times in 5s, or retail traders defect.
    copycat() {
      const R = rival(), T = 5, need = 15;
      let t = 0, taps = 0, resolved = false;
      return {
        start() {
          banner.show({ tag: "COPYCAT", tone: "down", text: L("copycat", { r: "$" + R }), sub: "Tap " + need + " times to keep your retail traders", meter: { a: 0, b: 0 } });
          TC.events.emit("news", { type: "copycat", tone: "down" });
          TC.rivals.move(R, rand(0.08, 0.15), 8);
        },
        onTap() { if (!resolved) taps++; },
        update(dt) {
          t += dt;
          if (!resolved) {
            banner.meter(t / T * 0.5, taps / need * 0.5);
            banner.sub(Math.max(0, need - taps) + " taps left · " + Math.max(0, T - t).toFixed(1) + "s");
            if (taps >= need) {
              resolved = true;
              banner.show({ tag: "KNOCKOFF FLOPS", tone: "up", text: L("copycatWin", { r: "$" + R }), sub: "" });
              TC.rivals.move(R, -rand(0.15, 0.25), 4);
              TC.market.shift(rand(0.04, 0.07), "copycat");
              t = T;
            } else if (t >= T) {
              resolved = true;
              banner.show({ tag: "RETAIL DEFECTS", tone: "down", text: L("copycatLose", { r: "$" + R }), sub: "Retail traders −30% for 20s" });
              TC.debuffs.add("copycat");
              TC.market.shift(-rand(0.06, 0.1), "copycat");
            }
            return true;
          }
          return t < T + 2;
        },
      };
    },

    // Hostile takeover (bad): a lowball bid drags your price down. Out-tap it, or you're forced
    // to sell part of your stake at the bid price.
    hostile() {
      const R = rival(), T = 6, need = 25;
      let t = 0, taps = 0, resolved = false, start = 0, bid = 0;
      return {
        start() {
          start = st().basePrice;
          bid = start * rand(0.65, 0.75);
          banner.show({ tag: "HOSTILE BID", tone: "down", text: L("hostile", { r: "$" + R, bid: TC.format.money(bid) }), sub: "Tap " + need + " times to reject it", meter: { a: 0, b: 0 } });
          TC.events.emit("news", { type: "hostile", tone: "down", big: true });
        },
        onTap() { if (!resolved) taps++; },
        update(dt) {
          t += dt;
          if (!resolved) {
            // Price sinks toward the bid while the fight is on
            const target = start + (bid - start) * Math.min(1, t / T) * (1 - Math.min(1, taps / need));
            if (target < st().basePrice) TC.market.shift(target / st().basePrice - 1, "hostile");
            banner.meter(t / T * 0.5, taps / need * 0.5);
            banner.sub(Math.max(0, need - taps) + " taps left · " + Math.max(0, T - t).toFixed(1) + "s");
            if (taps >= need) {
              resolved = true;
              banner.show({ tag: "BID REJECTED", tone: "up", text: L("hostileWin", { r: "$" + R }), sub: "" });
              TC.rivals.move(R, -rand(0.08, 0.14), 4);
              TC.market.shift(rand(0.1, 0.15), "hostile");
              t = T;
            } else if (t >= T) {
              resolved = true;
              const s = st();
              const n = Math.min(cfg.stake.hostileShares, s.shares * 0.2);
              s.shares -= n;
              s.cash += n * bid;
              banner.show({ tag: "SQUEEZED OUT", tone: "down", text: "$" + R + " takes " + +(n / cfg.sharesOutstanding * 100).toFixed(2) + "% of " + sym() + " at the bid", sub: "You got " + TC.format.money(n * bid) + " for it" });
              TC.events.emit("news", { type: "squeezedOut", tone: "down", big: true });
              TC.rivals.move(R, rand(0.06, 0.12), 4);
            }
            return true;
          }
          return t < T + 2.2;
        },
      };
    },

    // Sector crash (bad): the whole tape goes red and drags you with it. Common in bear markets.
    sector() {
      const A = rival(), B = rival([A]), drop = rand(0.15, 0.25);
      let t = 0, start = 0;
      return {
        start() {
          start = st().basePrice;
          const a = rand(0.3, 0.45), b = rand(0.25, 0.4);
          banner.show({ tag: "SECTOR CRASH", tone: "down", text: L("sector", { a: "$" + A, b: "$" + B, pa: pct(-a), pb: pct(-b) }), sub: "" });
          TC.events.emit("news", { type: "sector", tone: "down", big: true });
          for (const n of TC.rivals.names()) TC.rivals.move(n, -(n === A ? a : n === B ? b : rand(0.05, 0.2)), n === A || n === B ? 8 : 3);
        },
        update(dt) {
          t += dt;
          const target = start * (1 - drop * Math.min(1, t / 3));
          if (target < st().basePrice) TC.market.shift(target / st().basePrice - 1, "sector");
          return t < 5;
        },
      };
    },

    // Poached exec (bad): your upgrades stop working for 15s.
    poach() {
      const R = rival();
      let t = 0;
      return {
        start() {
          banner.show({ tag: "EXEC POACHED", tone: "down", text: L("poach", { r: "$" + R, who: TC.flavor.pick("execs") }), sub: "Upgrades off for 15s" });
          TC.events.emit("news", { type: "poach", tone: "down" });
          TC.debuffs.add("poach");
          TC.rivals.move(R, rand(0.06, 0.12), 6);
          TC.market.shift(-rand(0.04, 0.07), "poach");
        },
        update(dt) { t += dt; return t < 4; },
      };
    },
  };

  function schedule() {
    nextAt = st().clock + rand(cfg.news.minGap, cfg.news.maxGap) * (TC.seasons ? TC.seasons.gapMult() : 1);
  }

  const api = {
    types,
    active: () => active,
    // Buyer multiplier from news: rival scandal (2x for 10s) and index inclusion (+25% for the run)
    buyerMult: () => (st().clock < boostUntil ? 2 : 1) * (st().indexed ? 1.25 : 1),

    init() {
      TC.events.on("buy", (e) => { if (!e.stack && active && active.onTap) active.onTap(); });
      TC.events.on("reset", () => { active = null; nextAt = null; boostUntil = -1; banner.hide(); });
    },

    trigger(name, opts) {
      if (active) return false;
      // 40% of random events involve a rival ticker
      if (!name) name = Math.random() < 0.4 ? pickRival() : (TC.seasons ? TC.seasons.pickNews(CLASSIC) : pick(CLASSIC));
      const make = types[name];
      active = make(opts);
      active.type = name;
      active.start();
      return true;
    },

    update(dt) {
      const s = st();
      if (!s.listed) return;
      if (active) {
        if (!active.update(dt)) {
          const done = active;
          active = null;
          banner.hide();
          schedule();
          TC.events.emit("newsEnd", { type: done.type, saved: done.saved || 0 });
        }
        return;
      }
      if (s.basePrice < cfg.news.minPrice) return;
      // Index inclusion fires once per run at a $100B market cap
      if (!s.indexed && TC.market.marketCap(s.bestPrice) >= 1e11) { api.trigger("index"); return; }
      if (nextAt === null) nextAt = s.clock + cfg.news.firstAfter;
      if (s.clock >= nextAt) api.trigger();
    },
  };
  return api;
})();
