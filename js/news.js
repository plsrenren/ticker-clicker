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

  let active = null;
  let nextAt = null;

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
      const HEADLINES = [
        "CEO posts a meme at 3am",
        "Auditor resigns, cites \"vibes\"",
        "Factory turns out to be a green screen",
        "CFO spotted buying a yacht named EXIT",
        "Product recalled for being a jpeg",
        "Regulators would like a word",
      ];
      const T = 4, CH = 20;
      let t = 0, tick = 0, done = 0, applied = 0;
      let remaining = rand(0.2, 0.4);
      const full = remaining;
      return {
        start() {
          banner.show({ tag: "BREAKING", tone: "down", text: sym() + ": " + pick(HEADLINES), sub: "Tap fast to defend the price", meter: { a: 0, b: 0 } });
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
          banner.show({ tag: "FLASH CRASH", tone: "down", text: sym() + " drops " + Math.round(drop * 100) + "% in seconds", sub: "Hold on…" });
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
            banner.show({ tag: "RECOVERING", tone: "up", text: "Dip buyers step in", sub: "" });
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
          banner.show({ tag: "SHORT ATTACK", tone: "down", text: "Short sellers are piling into " + sym(), sub: "Tap " + need + " times before the red bar fills", meter: { a: 0, b: 0 } });
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
              banner.show({ tag: "SHORT SQUEEZE", tone: "up", text: "Shorts are covering. " + sym() + " " + pct(up), sub: "" });
              TC.events.emit("news", { type: "squeeze", tone: "up", big: true });
              TC.market.shift(up, "short");
              t = T; // start the outro timer
            } else if (t >= T) {
              resolved = true;
              const down = rand(0.2, 0.3);
              banner.show({ tag: "SHORTS WIN", tone: "down", text: sym() + " " + pct(-down), sub: "" });
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
      let t = 0, done = false;
      return {
        start() {
          banner.show({ tag: "EARNINGS", tone: "neutral", text: sym() + " reports in 5", sub: "Beat or miss?" });
          TC.events.emit("news", { type: "earnings", tone: "neutral" });
        },
        update(dt) {
          t += dt;
          if (!done) {
            banner.text(sym() + " reports in " + Math.max(1, Math.ceil(T - t)));
            if (t >= T) {
              done = true;
              banner.show({ tag: beat ? "BEAT" : "MISS", tone: beat ? "up" : "down", text: (beat ? "Crushed estimates. " : "Missed estimates. ") + sym() + " gaps " + pct(move), sub: "" });
              TC.events.emit("news", { type: beat ? "beat" : "miss", tone: beat ? "up" : "down", big: true });
              TC.market.shift(move, "earnings");
            }
            return true;
          }
          return t < T + 2.2;
        },
      };
    },

    // Pump: rockets up, then gives back half.
    pump() {
      const HANDLES = ["@moonboy_capital", "@stonkwizard", "@diamondhandz", "@yolo_daily", "@chartwhisperer"];
      const gain = rand(0.4, 0.8);
      const giveBack = 0.5;
      let t = 0, phase = 0, start = 0, peak = 0;
      return {
        start() {
          start = st().basePrice;
          banner.show({ tag: "PUMP", tone: "up", text: pick(HANDLES) + ": \"" + sym() + " is going to the moon\"", sub: "" });
          TC.events.emit("news", { type: "pump", tone: "up", big: true });
        },
        update(dt) {
          t += dt;
          if (phase === 0) {
            // ease up over 2.5s
            const target = start * (1 + gain * Math.min(1, t / 2.5));
            if (target > st().basePrice) TC.market.shift(target / st().basePrice - 1, "pump");
            if (t >= 2.5) { phase = 1; peak = st().basePrice; banner.sub("Early buyers take profits…"); }
          } else if (phase === 1) {
            const p = Math.min(1, (t - 2.5) / 4);
            const target = peak - (peak - start) * giveBack * p;
            if (target < st().basePrice) TC.market.shift(target / st().basePrice - 1, "pump");
            if (p >= 1) return t < 7.5;
          }
          return true;
        },
      };
    },
  };

  function schedule() {
    nextAt = st().clock + rand(cfg.news.minGap, cfg.news.maxGap) * (TC.seasons ? TC.seasons.gapMult() : 1);
  }

  const api = {
    types,
    active: () => active,

    init() {
      TC.events.on("buy", (e) => { if (!e.stack && active && active.onTap) active.onTap(); });
      TC.events.on("reset", () => { active = null; nextAt = null; banner.hide(); });
    },

    trigger(name, opts) {
      if (active) return false;
      name = name || (TC.seasons ? TC.seasons.pickNews(Object.keys(types)) : pick(Object.keys(types)));
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
      if (nextAt === null) nextAt = s.clock + cfg.news.firstAfter;
      if (s.clock >= nextAt) api.trigger();
    },
  };
  return api;
})();
