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
  // Size of the company drives how big the news is. Small caps get small, local stories and gentle moves;
  // giants get federal investigations and violent ones. Every event's move size is multiplied by
  //   K = cfg.news.intensity.min at $5M market cap, +perDecade for every 10x after that, capped at max
  const cap = () => TC.market.marketCap(st().basePrice);
  const I = cfg.news.intensity;
  const intensity = () => Math.max(I.min, Math.min(I.max, I.min + I.perDecade * Math.log10(Math.max(1, cap() / 5e6))));
  // A move size scaled by intensity (never a 90%+ wipeout)
  const mag = (a, b) => Math.min(0.85, rand(a, b) * intensity() * (TC.market.has("meme") ? 1.5 : 1));
  // "small" under $100M, "big" from $50B: flavor.js pools named key + "Small" / key + "Big" are used when they exist
  const tier = () => (cap() < 1e8 ? "Small" : cap() >= 5e10 ? "Big" : "");
  // Flavor text (flavor.js): L("key", { r: "$SNEK", pct: "+20%" })
  const L = (key, vars) => {
    const t = tier(), pools = TC.flavor.pools;
    const k = t && pools[key + t] && Math.random() < 0.75 ? key + t : key;
    return TC.flavor.line(k, Object.assign({ you: sym() }, vars));
  };

  let active = null;
  let nextAt = null;
  let boostUntil = -1; // rival scandal: buyers 2x
  let splitBoostUntil = -1; // stock split: buyers 1.5x
  const rival = (avoid) => TC.rivals.pick(avoid);
  // Rival headlines are picked separately from the classic ones (see trigger), weighted by season.
  const CLASSIC = ["headline", "flash", "short", "earnings", "pump", "opex", "cyber", "rug", "whale"];
  const taps = (n) => Math.round(n * (TC.market.has("intel") ? 0.8 : 1));
  const RIVAL_W = {
    bull: { takeover: 3, rivalScandal: 2, partner: 2, copycat: 1, hostile: 1, sector: 0.3, poach: 1 },
    bear: { takeover: 1, rivalScandal: 1, partner: 0.5, copycat: 2, hostile: 2, sector: 3, poach: 2 },
    side: { takeover: 1, rivalScandal: 1, partner: 1, copycat: 1, hostile: 1, sector: 1, poach: 1 },
    frenzy: { takeover: 2, rivalScandal: 2, partner: 1, copycat: 1, hostile: 2, sector: 1, poach: 0.5 },
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
      let remaining = mag(0.2, 0.4) * (TC.market.has("prfirm") ? 0.7 : 1);
      const full = remaining;
      return {
        start() {
          banner.show({ tag: "BREAKING", tone: "down", text: L("headline"), sub: L("headlineSub"), meter: { a: 0, b: 0 } });
          TC.events.emit("news", { type: "headline", tone: "down" });
        },
        onTap() { remaining *= TC.market.has("prfirm") ? 0.95 : 0.965; },
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
      const drop = mag(0.3, 0.5);
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
      const need = Math.round(cfg.news.shortTaps * (TC.market.has("intel") ? 0.8 : 1));
      let t = 0, taps = 0, resolved = false;
      let gamma = null; // { t, taps, done } second leg after a squeeze
      const gNeed = Math.round(cfg.news.gammaTaps * (TC.market.has("intel") ? 0.8 : 1));
      return {
        start() {
          banner.show({ tag: "SHORT ATTACK", tone: "down", text: L("short"), sub: "Tap " + need + " times before the red bar fills", meter: { a: 0, b: 0 } });
          TC.events.emit("news", { type: "short", tone: "down" });
        },
        onTap() { if (!resolved) taps++; else if (gamma && !gamma.done) gamma.taps++; },
        update(dt) {
          t += dt;
          if (gamma) {
            // Gamma squeeze: dealers who sold calls have to buy too. Keep tapping to set it off.
            gamma.t += dt;
            if (!gamma.done) {
              const G = 4;
              banner.meter(gamma.t / G * 0.5, gamma.taps / gNeed * 0.5);
              banner.sub("Keep tapping: " + Math.max(0, gNeed - gamma.taps) + " taps · " + Math.max(0, G - gamma.t).toFixed(1) + "s");
              if (gamma.taps >= gNeed) {
                gamma.done = true; gamma.t = 0;
                const up = mag(0.1, 0.2);
                banner.show({ tag: "GAMMA SQUEEZE", tone: "up", text: L("gamma", { pct: pct(up) }), sub: "" });
                TC.events.emit("news", { type: "gamma", tone: "up", big: true });
                TC.market.shift(up, "short");
              } else if (gamma.t >= G) {
                gamma.done = true; gamma.t = 1.2; // fizzles: short outro
                banner.sub("The squeeze runs out of steam");
              }
              return true;
            }
            return gamma.t < 2.2;
          }
          if (!resolved) {
            banner.meter(t / T * 0.5, taps / need * 0.5);
            banner.sub(Math.max(0, need - taps) + " taps left · " + Math.max(0, T - t).toFixed(1) + "s");
            if (taps >= need) {
              resolved = true;
              const up = mag(0.12, 0.2);
              banner.show({ tag: "SHORT SQUEEZE", tone: "up", text: L("squeeze", { pct: pct(up) }), sub: "" });
              TC.events.emit("news", { type: "squeeze", tone: "up", big: true });
              TC.market.shift(up, "short");
              t = T; // start the outro timer
              gamma = { t: -1.2, taps: 0, done: false }; // let the squeeze banner read, then offer the second leg
            } else if (t >= T) {
              resolved = true;
              const down = mag(0.2, 0.3);
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

    // Options expiry: the price gets pinned to the "max pain" strike for 7s while sellers lean on it.
    // Taps push the pressure meter up, sellers drag it down. When the clock hits zero the pin lets go and
    // the price whips the way the pressure points: up if you held it above the strike, down if not.
    opex() {
      const T = 7;
      const strike = st().basePrice;
      const per = cfg.news.opexTaps;
      let t = 0, p = 0, acc = 0, resolved = false;
      const shown = () => TC.format.money(TC.market.px(strike));
      return {
        start() {
          banner.show({ tag: "OPTIONS EXPIRY", tone: "neutral", text: L("opex", { bid: shown() }), sub: "Hold it above " + shown() + " when the clock hits 0", meter: { a: 0, b: 0 } });
          TC.events.emit("news", { type: "opex", tone: "neutral" });
        },
        onTap() { if (!resolved) p = Math.min(1, p + per); },
        update(dt) {
          t += dt;
          if (!resolved) {
            p = Math.max(-1, p - 0.2 * dt + (Math.random() - 0.5) * 0.12 * dt);
            // Pin the price to the strike, nudged by the pressure
            if ((acc += dt) >= 0.1) {
              acc = 0;
              const step = strike * (1 + 0.03 * p) / st().basePrice - 1;
              if (Math.abs(step) > 1e-4) TC.market.shift(step, "opex");
            }
            banner.meter(Math.max(0, -p), Math.max(0, p));
            banner.sub((p >= 0 ? "Above " : "Below ") + shown() + " · " + Math.max(0, T - t).toFixed(1) + "s");
            if (t >= T) {
              resolved = true;
              const k = 0.4 + 0.6 * Math.abs(p);
              if (p >= 0) {
                const up = mag(0.1, 0.22) * k;
                banner.show({ tag: "CALLS PAY", tone: "up", text: L("opexUp", { pct: pct(up) }), sub: "" });
                TC.events.emit("news", { type: "opexUp", tone: "up", big: up > 0.12 });
                TC.market.shift(up, "opex");
              } else {
                const down = mag(0.12, 0.25) * k;
                banner.show({ tag: "PUTS PAY", tone: "down", text: L("opexDown", { pct: pct(-down) }), sub: "" });
                TC.events.emit("news", { type: "opexDown", tone: "down", big: down > 0.12 });
                TC.market.shift(-down, "opex");
              }
              t = T;
            }
            return true;
          }
          return t < T + 2.2;
        },
      };
    },

    // ---- Whales: one big holder moves the price. Bull markets lean to buying, bears to dumping ----
    whale(opts) {
      const season = TC.seasons && TC.seasons.current();
      const dumpOdds = season === "bear" ? 0.7 : season === "bull" || season === "frenzy" ? 0.3 : 0.5;
      return types[Math.random() < dumpOdds ? "whaleDump" : "whaleBuy"](opts);
    },

    // Whale buy (good): a mystery buyer sweeps the order book in 6 big orders over 4s.
    // Tap along to follow the whale: every tap in the window adds 1% more to the total, up to +50%.
    whaleBuy() {
      const T = 4, CHUNKS = 6;
      const total = mag(0.14, 0.26);
      let t = 0, done = 0, taps = 0, resolved = false;
      return {
        start() {
          banner.show({ tag: "WHALE SPOTTED", tone: "up", text: L("whaleBuy"), sub: "Tap to follow the whale in" });
          TC.events.emit("news", { type: "whaleBuy", tone: "up" });
        },
        onTap() { if (!resolved) taps++; },
        update(dt) {
          t += dt;
          if (resolved) return t < 2.2;
          const bonus = 1 + Math.min(0.5, taps * 0.01);
          while (done < CHUNKS && t >= (done + 1) * (T / CHUNKS)) {
            done++;
            TC.market.shift(Math.pow(1 + total * bonus, 1 / CHUNKS) - 1, "whale");
          }
          banner.sub("Followers +" + Math.round((bonus - 1) * 100) + "% · " + Math.max(0, T - t).toFixed(1) + "s");
          if (done >= CHUNKS) {
            resolved = true; t = 0;
            banner.show({ tag: "WHALE LOADED UP", tone: "up", text: L("whaleBuyDone", { pct: pct(total * bonus) }), sub: taps ? "Your taps added +" + Math.round((bonus - 1) * 100) + "%" : "" });
            TC.events.emit("news", { type: "whaleBought", tone: "up", big: true });
          }
          return true;
        },
      };
    },

    // Whale dump (bad): a whale sells for 6s. Tap enough to absorb the sell orders and the dump stops,
    // and a third of the drop comes back as the market sees the bid hold. Otherwise the whale exits in full.
    whaleDump() {
      const T = 6, need = taps(cfg.news.whaleTaps);
      const total = mag(0.22, 0.36);
      const rate = Math.pow(1 - total, 1 / T);
      let t = 0, n = 0, lost = 0, resolved = false, acc = 0;
      return {
        start() {
          banner.show({ tag: "WHALE ALERT", tone: "down", text: L("whaleDump"), sub: "Tap " + need + " times to absorb it", meter: { a: 0, b: 0 } });
          TC.events.emit("news", { type: "whaleDump", tone: "down" });
        },
        onTap() { if (!resolved) n++; },
        update(dt) {
          t += dt;
          if (resolved) return t < 2.2;
          if ((acc += dt) >= 0.1) {
            const f = Math.pow(rate, acc) - 1;
            lost = 1 - (1 - lost) * (1 + f);
            TC.market.shift(f, "whale");
            acc = 0;
          }
          banner.meter(lost / total, n / need);
          banner.sub(Math.max(0, need - n) + " taps to absorb · " + Math.max(0, T - t).toFixed(1) + "s");
          if (n >= need) {
            resolved = true; t = 0;
            const back = lost / (1 - lost) / 3;
            banner.show({ tag: "WHALE ABSORBED", tone: "up", text: L("whaleAbsorbed", { pct: pct(-lost) }), sub: "The bid held: a third of the drop comes back" });
            TC.events.emit("news", { type: "whaleAbsorbed", tone: "up" });
            TC.market.shift(back, "whale");
          } else if (t >= T) {
            resolved = true; t = 0;
            banner.show({ tag: "WHALE EXITS", tone: "down", text: L("whaleDumped", { pct: pct(-lost) }), sub: "" });
            TC.events.emit("news", { type: "whaleDumped", tone: "down", big: true });
          }
          return true;
        },
      };
    },

    // Rug rumor (neutral): "is $YOU about to rug?" Holders get jumpy for 6s while the price shakes.
    // Tap enough to calm them and the rumor is debunked (small pop). Ride it out and it's a coin flip:
    // shorts who bet on the rug get burned (squeeze up) or holders panic and dump (big drop).
    rug() {
      const T = 6, need = taps(cfg.news.rugTaps);
      let t = 0, n = 0, acc = 0, resolved = false;
      return {
        start() {
          banner.show({ tag: "RUG RUMOR", tone: "neutral", text: L("rug"), sub: "Tap " + need + " times to calm holders", meter: { a: 0, b: 0 } });
          TC.events.emit("news", { type: "rug", tone: "neutral" });
        },
        onTap() { if (!resolved) n++; },
        update(dt) {
          t += dt;
          if (resolved) return t < 2.2;
          if ((acc += dt) >= 0.35) { acc = 0; TC.market.shift(rand(-0.025, 0.02), "rug"); } // nervous chop
          banner.meter(t / T, n / need);
          banner.sub(Math.max(0, need - n) + " taps to calm holders · " + Math.max(0, T - t).toFixed(1) + "s");
          if (n >= need) {
            resolved = true; t = 0;
            const up = mag(0.05, 0.1);
            banner.show({ tag: "RUMOR DEBUNKED", tone: "up", text: L("rugDebunked", { pct: pct(up) }), sub: "" });
            TC.events.emit("news", { type: "rugDebunked", tone: "up" });
            TC.market.shift(up, "rug");
          } else if (t >= T) {
            resolved = true; t = 0;
            if (Math.random() < 0.5) {
              const up = mag(0.1, 0.2);
              banner.show({ tag: "SHORTS BURNED", tone: "up", text: L("rugSqueeze", { pct: pct(up) }), sub: "No rug. The bears were wrong" });
              TC.events.emit("news", { type: "rugSqueeze", tone: "up", big: true });
              TC.market.shift(up, "rug");
            } else {
              const down = mag(0.15, 0.28);
              banner.show({ tag: "HOLDERS PANIC", tone: "down", text: L("rugPanic", { pct: pct(-down) }), sub: "Everyone ran for the exit at once" });
              TC.events.emit("news", { type: "rugPanic", tone: "down", big: true });
              TC.market.shift(-down, "rug");
            }
          }
          return true;
        },
      };
    },

    // ---- Security events: one of hack, breach or exploit ----
    cyber(opts) { return types[pick(["hack", "breach", "exploit"])](opts); },

    // Hack (bad): attackers drain the price for 6s until you patch the hole. Patch in time and
    // the drain stops and a quarter of the loss comes back.
    hack() {
      const T = 6, need = taps(cfg.news.hackTaps);
      const total = mag(0.25, 0.4);
      const rate = Math.pow(1 - total, 1 / T); // per-second multiplier: the full drain takes T seconds
      let t = 0, n = 0, lost = 0, resolved = false, acc = 0;
      return {
        start() {
          banner.show({ tag: "HACKED", tone: "down", text: L("hack"), sub: "Tap " + need + " times to patch it", meter: { a: 0, b: 0 } });
          TC.events.emit("news", { type: "hack", tone: "down" });
        },
        onTap() { if (!resolved) n++; },
        update(dt) {
          t += dt;
          if (resolved) return t < 2.2;
          if ((acc += dt) >= 0.1) {
            const f = Math.pow(rate, acc) - 1;
            lost = 1 - (1 - lost) * (1 + f);
            TC.market.shift(f, "hack");
            acc = 0;
          }
          this.saved = 1 - lost / total;
          banner.meter(lost / total, n / need);
          banner.sub(Math.max(0, need - n) + " taps to patch · " + Math.max(0, T - t).toFixed(1) + "s");
          if (n >= need) {
            resolved = true; t = 0;
            const back = lost / (1 - lost) * 0.25;
            banner.show({ tag: "PATCHED", tone: "up", text: L("hackPatched", { pct: pct(-lost) }), sub: "Systems restored: a quarter of the loss comes back" });
            TC.events.emit("news", { type: "hackPatched", tone: "up" });
            TC.market.shift(back, "hack");
          } else if (t >= T) {
            resolved = true; t = 0;
            banner.show({ tag: "DRAINED", tone: "down", text: L("hacked", { pct: pct(-lost) }), sub: "" });
            TC.events.emit("news", { type: "hacked", tone: "down", big: true });
          }
          return true;
        },
      };
    },

    // Data breach (bad): the drop lands first. Then 6s of taps win back up to 70% of it.
    breach() {
      const T = 6, need = taps(cfg.news.breachTaps);
      const drop = mag(0.2, 0.35);
      const R = drop / (1 - drop) * 0.7; // rise from the bottom that wins back 70% of the drop
      let t = 0, n = 0, applied = 0, phase = 0;
      return {
        start() {
          banner.show({ tag: "DATA BREACH", tone: "down", text: L("breach", { pct: pct(-drop) }), sub: "Tap to win back trust", meter: { a: 1, b: 0 } });
          TC.events.emit("news", { type: "breach", tone: "down", big: true });
          TC.market.shift(-drop, "breach");
        },
        onTap() { if (phase === 0) n++; },
        update(dt) {
          t += dt;
          if (phase === 1) return t < 2.2;
          const p = Math.min(1, n / need);
          if (p > applied) { TC.market.shift((1 + R * p) / (1 + R * applied) - 1, "breach"); applied = p; }
          this.saved = p * 0.7;
          banner.meter(1 - t / T, p);
          banner.sub(Math.round(p * 70) + "% of the drop won back · " + Math.max(0, T - t).toFixed(1) + "s");
          if (p >= 1 || t >= T) {
            phase = 1; t = 0;
            const good = p >= 0.6;
            banner.show({ tag: good ? "TRUST RESTORED" : "TRUST SHAKEN", tone: good ? "up" : "down", text: L(good ? "breachWin" : "breachLose"), sub: "You won back " + Math.round(p * 70) + "% of the drop" });
            TC.events.emit("news", { type: good ? "breachWin" : "breachLose", tone: good ? "up" : "down" });
          }
          return true;
        },
      };
    },

    // Zero-day exploit (neutral): a researcher finds a hole. Ship the patch in 5s and you look great;
    // miss it and the exploit goes public.
    exploit() {
      const T = 5, need = taps(cfg.news.exploitTaps);
      let t = 0, n = 0, resolved = false;
      return {
        start() {
          banner.show({ tag: "ZERO-DAY", tone: "neutral", text: L("exploit"), sub: "Tap " + need + " times to ship the patch", meter: { a: 0, b: 0 } });
          TC.events.emit("news", { type: "exploit", tone: "neutral" });
        },
        onTap() { if (!resolved) n++; },
        update(dt) {
          t += dt;
          if (resolved) return t < T + 2.2;
          banner.meter(t / T * 0.5, n / need * 0.5);
          banner.sub(Math.max(0, need - n) + " taps left · " + Math.max(0, T - t).toFixed(1) + "s");
          if (n >= need) {
            resolved = true; t = T;
            const up = mag(0.06, 0.12);
            banner.show({ tag: "PATCHED IN TIME", tone: "up", text: L("exploitWin", { pct: pct(up) }), sub: "" });
            TC.events.emit("news", { type: "exploitWin", tone: "up" });
            TC.market.shift(up, "exploit");
          } else if (t >= T) {
            resolved = true;
            const down = mag(0.15, 0.25);
            banner.show({ tag: "EXPLOIT PUBLIC", tone: "down", text: L("exploitLose", { pct: pct(-down) }), sub: "" });
            TC.events.emit("news", { type: "exploitLose", tone: "down", big: true });
            TC.market.shift(-down, "exploit");
          }
          return true;
        },
      };
    },

    // Stock split vote: tap enough in 6s to rally the shareholders and push a 10-for-1 split through.
    // The split is cosmetic (shown price / 10, market cap unchanged); passing it also pops the price
    // and makes buyers 1.5x for 20s, because retail loves cheap shares. Failing dips the price a little.
    split() {
      const T = 6;
      const need = Math.round(cfg.news.splitTaps * (TC.market.has("intel") ? 0.8 : 1));
      let t = 0, taps = 0, resolved = false;
      return {
        start() {
          banner.show({ tag: "SPLIT VOTE", tone: "up", text: L("split"), sub: "Tap " + need + " times to win the vote", meter: { a: 0, b: 0 } });
          TC.events.emit("news", { type: "split", tone: "neutral" });
        },
        onTap() { if (!resolved) taps++; },
        update(dt) {
          t += dt;
          if (!resolved) {
            banner.meter(t / T * 0.5, taps / need * 0.5);
            banner.sub(Math.max(0, need - taps) + " taps left · " + Math.max(0, T - t).toFixed(1) + "s");
            if (taps >= need) {
              resolved = true;
              st().split = (st().split || 1) * 10;
              TC.chart.mark("10:1");
              const up = mag(0.06, 0.12);
              splitBoostUntil = st().clock + 20;
              banner.show({ tag: "10-FOR-1 SPLIT", tone: "up", text: L("splitWin", { pct: pct(up), bid: TC.format.money(TC.market.px(st().basePrice)) }), sub: "Buyers 1.5x for 20s" });
              TC.events.emit("split", { factor: 10, total: st().split });
              TC.events.emit("news", { type: "splitWin", tone: "up", big: true });
              TC.market.shift(up, "split");
              t = T;
            } else if (t >= T) {
              resolved = true;
              const down = mag(0.04, 0.08);
              banner.show({ tag: "VOTE FAILS", tone: "down", text: L("splitLose", { pct: pct(-down) }), sub: "" });
              TC.events.emit("news", { type: "splitLose", tone: "down" });
              TC.market.shift(-down, "split");
            }
            return true;
          }
          return t < T + 2.2;
        },
      };
    },

    // Earnings: countdown, then a gap up or down.
    earnings(opts = {}) {
      const T = 5;
      const beat = Math.random() < (opts.beatOdds ?? (TC.seasons ? TC.seasons.beatOdds() : 0.55));
      const move = beat ? mag(0.15, 0.3) : -mag(0.1, 0.25);
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
      const gain = mag(0.4, 0.8);
      const giveBack = rand(0.75, 1.25);
      let t = 0, phase = 0, start = 0, peak = 0;
      return {
        start() {
          start = st().basePrice;
          banner.show({ tag: "PUMP", tone: "up", text: L("pump", { who: TC.flavor.pick(TC.flavor.pools["handles" + tier()] ? "handles" + tier() : "handles") }), sub: "" });
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
      const R = rival(), gain = mag(0.25, 0.4), keep = 0.3;
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
          TC.market.shift(mag(0.05, 0.1), "rivalScandal");
        },
        update(dt) { t += dt; return t < 4; },
      };
    },

    // Partnership (good): slow rally, and the rival moves with you for a minute.
    partner() {
      const R = rival(), gain = mag(0.15, 0.25);
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
          TC.market.shift(mag(0.08, 0.12), "index");
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
              TC.market.shift(mag(0.04, 0.07), "copycat");
              t = T;
            } else if (t >= T) {
              resolved = true;
              banner.show({ tag: "RETAIL DEFECTS", tone: "down", text: L("copycatLose", { r: "$" + R }), sub: "Retail traders −30% for 20s" });
              TC.debuffs.add("copycat");
              TC.market.shift(-mag(0.06, 0.1), "copycat");
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
          bid = start * (1 - mag(0.25, 0.35));
          banner.show({ tag: "HOSTILE BID", tone: "down", text: L("hostile", { r: "$" + R, bid: TC.format.money(TC.market.px(bid)) }), sub: "Tap " + need + " times to reject it", meter: { a: 0, b: 0 } });
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
              TC.market.shift(mag(0.1, 0.15), "hostile");
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
      const A = rival(), B = rival([A]), drop = mag(0.15, 0.25);
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

  // Chains: some outcomes set off a follow-up event 1.8s later instead of the usual wait.
  // Outcome (the last "news" type an event emitted) -> [next event, chance]. At most 2 follow-ups in a row.
  const CHAIN = {
    hacked: ["breach", 0.5],        // they got in, now the data leaks
    exploitLose: ["hack", 0.45],    // the public exploit gets used
    breachLose: ["headline", 0.35], // regulators and reporters pile on
    miss: ["short", 0.4],           // shorts smell blood
    shortwin: ["headline", 0.3],
    headlineLost: ["short", 0.35],
    opexDown: ["flash", 0.3],
    sector: ["flash", 0.25],
    beat: ["pump", 0.3],            // influencers jump on a beat
    splitWin: ["pump", 0.35],       // cheap shares go viral
    opexUp: ["pump", 0.25],
    exploitWin: ["partner", 0.25],  // a rival trusts your security
    breachWin: ["exploit", 0.2],    // a researcher pokes at the new defences
    whaleDumped: ["flash", 0.3],    // the dump sets off stop losses
    whaleBought: ["pump", 0.3],     // influencers spot the whale
    rugPanic: ["short", 0.35],      // shorts pile onto the panic
    rugSqueeze: ["pump", 0.3],      // influencers dunk on the bears
  };
  const CHAIN_MAX = 2, CHAIN_DELAY = 1.8;
  let lastOutcome = null, chainDepth = 0, chain = null; // chain = { name, at }

  function schedule() {
    nextAt = st().clock + rand(cfg.news.minGap, cfg.news.maxGap) * (TC.seasons ? TC.seasons.gapMult() : 1);
  }

  const api = {
    types,
    active: () => active,
    // Buyer multiplier from news: rival scandal (2x for 10s) and index inclusion (+25% for the run)
    buyerMult: () => (st().clock < boostUntil ? 2 : 1) * (st().clock < splitBoostUntil ? 1.5 : 1) * (st().indexed ? 1.25 : 1),

    init() {
      TC.events.on("buy", (e) => { if (!e.stack && active && active.onTap) active.onTap(); });
      TC.events.on("news", (e) => { if (active) lastOutcome = e.type; });
      TC.events.on("reset", () => { active = null; nextAt = null; chain = null; chainDepth = 0; boostUntil = -1; splitBoostUntil = -1; banner.hide(); });
    },

    trigger(name, opts) {
      if (active) return false;
      // 40% of random events involve a rival ticker
      if (!name && TC.market.px(st().basePrice) >= 1000 && Math.random() < cfg.news.splitChance) name = "split";
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
          let out = lastOutcome;
          if (done.type === "headline") out = (done.saved || 0) < 0.2 ? "headlineLost" : "";
          const link = CHAIN[out];
          if (link && chainDepth < CHAIN_MAX && s.basePrice >= cfg.news.minPrice && Math.random() < link[1]) {
            chain = { name: link[0], at: s.clock + CHAIN_DELAY, from: out };
          } else chainDepth = 0;
          lastOutcome = null;
          TC.events.emit("newsEnd", { type: done.type, saved: done.saved || 0 });
        }
        return;
      }
      if (chain && s.clock >= chain.at) {
        const c = chain;
        chain = null;
        chainDepth++;
        if (api.trigger(c.name)) TC.events.emit("chain", { depth: chainDepth, name: c.name, from: c.from });
        return;
      }
      if (chain) return;
      if (s.basePrice < cfg.news.minPrice) return;
      // Index inclusion fires once per run at a $100B market cap
      if (!s.indexed && TC.market.marketCap(s.bestPrice) >= 1e11) { api.trigger("index"); return; }
      if (nextAt === null) nextAt = s.clock + cfg.news.firstAfter;
      if (s.clock >= nextAt) api.trigger();
    },
  };
  return api;
})();
