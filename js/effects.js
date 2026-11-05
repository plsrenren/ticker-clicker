// Visual effects layer. Draws on its own canvas over the chart.
//
// Two kinds of things live here:
//   - one-shot effects: factories in `kinds` that return { update(dt) -> alive?, draw(ctx) }
//   - the trade feed: a persistent stack of big trade amounts beside the price
// Hook new effects to game events in the "wiring" block at the bottom.
// Effects never change game state.
window.TC = window.TC || {};

TC.effects = (() => {
  let canvas, ctx, w = 0, h = 0;
  const live = [];
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const token = (name) => getComputedStyle(document.documentElement).getPropertyValue("--" + name).trim();
  let C = {};
  const FRENZY = "#ffc83d"; // market frenzy gold
  // Canvas glow (shadowBlur) is the most expensive thing we draw; main.js turns it off on slow devices
  const glow = () => (TC.perf && TC.perf.low ? 0 : 1);

  function resize() {
    const r = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    w = r.width; h = r.height;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // ---------- One-shot effects ----------
  // Tap heat: rises with fast tapping, cools off over ~1.5s. Makes tap effects bigger and hotter.
  let heat = 0;
  // Mix the neon green toward the white-hot core as heat rises
  const heatColor = (k) => (k > 0.66 ? C.core : C.line);

  const kinds = {
    // Shockwave rings where your finger lands
    tapRipple({ x, y, k = 0 }) {
      let t = 0;
      const life = 0.45 + k * 0.2;
      const max = 34 + k * 46;
      const color = heatColor(k);
      return {
        update(dt) { t += dt; return t < life; },
        draw(g) {
          const p = t / life;
          const ease = 1 - Math.pow(1 - p, 3);
          g.save();
          g.strokeStyle = color;
          g.shadowColor = C.line;
          g.shadowBlur = (14) * glow();
          g.globalAlpha = (1 - p) * 0.9;
          g.lineWidth = 2.5 * (1 - p) + 0.5;
          g.beginPath(); g.arc(x, y, max * ease, 0, Math.PI * 2); g.stroke();
          g.globalAlpha = (1 - p) * 0.5;
          g.beginPath(); g.arc(x, y, max * 0.55 * ease, 0, Math.PI * 2); g.stroke();
          // bright flash at the contact point
          g.globalAlpha = Math.max(0, 1 - p * 3);
          g.fillStyle = C.core;
          g.beginPath(); g.arc(x, y, 5 + k * 5, 0, Math.PI * 2); g.fill();
          g.restore();
        },
      };
    },

    // Little glowing "$" and dots thrown out from the tap
    coin({ x, y, k = 0 }) {
      let t = 0;
      const life = 0.55 + Math.random() * 0.35;
      const a = Math.random() * Math.PI * 2;
      const sp = 70 + Math.random() * (120 + k * 160);
      let vx = Math.cos(a) * sp, vy = Math.sin(a) * sp - 60;
      const glyph = Math.random() < 0.45;
      const size = glyph ? 11 + Math.random() * 6 + k * 4 : 2 + Math.random() * 2;
      const color = Math.random() < k * 0.6 ? C.core : C.line;
      const spin = (Math.random() - 0.5) * 8;
      return {
        update(dt) { t += dt; x += vx * dt; y += vy * dt; vy += 340 * dt; vx *= 0.985; return t < life; },
        draw(g) {
          const p = t / life;
          g.save();
          g.globalAlpha = 1 - p * p;
          g.fillStyle = color;
          g.shadowColor = color;
          g.shadowBlur = (8) * glow();
          if (glyph) {
            g.translate(x, y);
            g.rotate(spin * t);
            g.font = `800 ${size}px "Bricolage Grotesque", system-ui, sans-serif`;
            g.textAlign = "center";
            g.textBaseline = "middle";
            g.fillText("$", 0, 0);
          } else {
            g.fillRect(x - size / 2, y - size / 2, size, size);
          }
          g.restore();
        },
      };
    },

    // Your order: a comet that flies from your finger into the price, then bursts on arrival
    comet({ x, y, k = 0, onArrive }) {
      let t = 0;
      const life = 0.32;
      const sx = x, sy = y;
      const trail = [];
      // Curve sideways a little so a burst of taps fans out
      const bend = (Math.random() - 0.5) * 80;
      let arrived = false;
      return {
        update(dt) {
          t += dt;
          const tip = TC.chart.tip();
          const p = Math.min(1, t / life);
          const e = p * p * (3 - 2 * p);
          const mx = (sx + tip.x) / 2 + bend, my = (sy + tip.y) / 2 - 40;
          // quadratic bezier from finger to the live price
          const cx = (1 - e) * (1 - e) * sx + 2 * (1 - e) * e * mx + e * e * tip.x;
          const cy = (1 - e) * (1 - e) * sy + 2 * (1 - e) * e * my + e * e * tip.y;
          trail.push({ x: cx, y: cy });
          if (trail.length > 10) trail.shift();
          if (p >= 1 && !arrived) { arrived = true; onArrive && onArrive(tip); }
          return t < life + 0.12;
        },
        draw(g) {
          if (trail.length < 2) return;
          const fade = t > life ? 1 - (t - life) / 0.12 : 1;
          g.save();
          g.lineCap = "round";
          g.shadowColor = C.line;
          g.shadowBlur = (12) * glow();
          for (let i = 1; i < trail.length; i++) {
            const q = i / trail.length;
            g.globalAlpha = q * fade;
            g.strokeStyle = q > 0.7 ? C.core : heatColor(k);
            g.lineWidth = 1 + q * (2.5 + k * 2);
            g.beginPath();
            g.moveTo(trail[i - 1].x, trail[i - 1].y);
            g.lineTo(trail[i].x, trail[i].y);
            g.stroke();
          }
          g.restore();
        },
      };
    },

    // A band of light that runs along the chart line from "now" back into the past.
    pulse({ color = C.line, speed = 150, width = 16, life = 1.6, strength = 1 }) {
      let t = 0;
      return {
        update(dt) { t += dt; return t < life && TC.chart.points().length - 1 - t * speed > -width; },
        draw(g) {
          const pts = TC.chart.points();
          if (pts.length < 2) return;
          const head = pts.length - 1 - t * speed;
          const fade = Math.max(0, 1 - t / life) * strength;
          const from = Math.max(0, Math.floor(head - width));
          const to = Math.min(pts.length - 1, Math.ceil(head + width));
          g.save();
          g.lineCap = "round";
          g.strokeStyle = color;
          g.shadowColor = color;
          g.shadowBlur = (20) * glow();
          g.lineWidth = 3.2;
          for (let i = from; i < to; i++) {
            const d = Math.abs(i + 0.5 - head) / width;
            const k = 1 - d * d;
            if (k <= 0) continue;
            g.globalAlpha = Math.min(1, fade * k);
            g.beginPath();
            g.moveTo(pts[i].x, pts[i].y);
            g.lineTo(pts[i + 1].x, pts[i + 1].y);
            g.stroke();
          }
          g.restore();
        },
      };
    },

    // Small sparks thrown off the line tip
    spark({ x, y, color = C.line }) {
      let t = 0;
      const life = 0.45 + Math.random() * 0.3;
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2;
      const sp = 60 + Math.random() * 110;
      let vx = Math.cos(a) * sp, vy = Math.sin(a) * sp;
      return {
        update(dt) { t += dt; x += vx * dt; y += vy * dt; vy += 260 * dt; return t < life; },
        draw(g) {
          g.globalAlpha = 1 - t / life;
          g.fillStyle = color;
          g.fillRect(x - 1.25, y - 1.25, 2.5, 2.5);
          g.globalAlpha = 1;
        },
      };
    },

    // Floating headline text, used for milestones and the IPO
    floatText({ x, y, text, color = C.up, size = 26, life = 1.6 }) {
      let t = 0;
      return {
        update(dt) { t += dt; return t < life; },
        draw(g) {
          const p = t / life;
          g.globalAlpha = 1 - p * p;
          g.fillStyle = color;
          g.shadowColor = color;
          g.shadowBlur = (16) * glow();
          g.font = `800 ${size}px "Bricolage Grotesque", system-ui, sans-serif`;
          g.textAlign = "center";
          g.fillText(text, x, y - 40 * p);
          g.shadowBlur = 0;
          g.globalAlpha = 1;
        },
      };
    },

    // Colored glow around the edges of the chart, for news hits
    // Whole chart flashes a color, then fades (big moves)
    flash({ color = C.down, life = 0.5, strength = 0.3 }) {
      let t = 0;
      return {
        update(dt) { t += dt; return t < life; },
        draw(g) {
          g.save();
          g.globalAlpha = strength * Math.pow(1 - t / life, 2);
          g.fillStyle = color;
          g.fillRect(0, 0, w, h);
          g.restore();
        },
      };
    },

    vignette({ color = C.down, life = 0.9, strength = 0.7 }) {
      let t = 0;
      return {
        update(dt) { t += dt; return t < life; },
        draw(g) {
          const a = strength * (1 - t / life);
          const r = Math.max(w, h) * 0.75;
          const grad = g.createRadialGradient(w / 2, h / 2, r * 0.45, w / 2, h / 2, r);
          grad.addColorStop(0, color + "00");
          grad.addColorStop(1, color);
          g.globalAlpha = a;
          g.fillStyle = grad;
          g.fillRect(0, 0, w, h);
          g.globalAlpha = 1;
        },
      };
    },

    // Expanding ring
    ring({ x, y, color = C.line, life = 0.8, max = 120 }) {
      let t = 0;
      return {
        update(dt) { t += dt; return t < life; },
        draw(g) {
          const p = t / life;
          g.globalAlpha = 1 - p;
          g.strokeStyle = color;
          g.shadowColor = color;
          g.shadowBlur = (12) * glow();
          g.lineWidth = 2;
          g.beginPath(); g.arc(x, y, max * p, 0, Math.PI * 2); g.stroke();
          g.shadowBlur = 0;
          g.globalAlpha = 1;
        },
      };
    },
  };

  // ---------- Trade feed ----------
  // Newest trade sits big and glowing level with the price; older ones slide down,
  // shrink and fade. Rapid trades in the same direction merge into one growing number.
  const feed = {
    items: [],
    add(amount, sign, src = "you") {
      const top = feed.items[0];
      if (top && src === "you" && top.sign === sign && top.src === src && top.age < 0.18) {
        top.amount += amount;
        top.age = 0;
        top.pop = 1;
        return;
      }
      feed.items.unshift({ amount, sign, src, age: 0, pop: 1, y: null });
      if (feed.items.length > 5) feed.items.length = 5;
    },
    update(dt) {
      for (const it of feed.items) { it.age += dt; it.pop = Math.max(0, it.pop - dt * 5); }
      feed.items = feed.items.filter((it) => it.age < 4);
    },
    draw(g) {
      if (!feed.items.length) return;
      const b = TC.chart.bounds();
      const scale = Math.min(1.5, Math.max(0.8, w / 420));
      const ref = Math.max(TC.market.perClick(), 0.01);
      const anchor = Math.max(b.t + 40, Math.min(b.b - 60, TC.chart.tip().y + 12));
      let y = anchor;
      g.textAlign = "right";
      g.textBaseline = "alphabetic";
      feed.items.forEach((it, i) => {
        // Bigger trades print bigger
        const mag = Math.min(1, Math.log10(it.amount / ref + 1) / 2);
        const base = (i === 0 ? 30 + mag * 18 : 22 - i * 2) * scale;
        const size = base * (1 + it.pop * 0.18);
        it.y = it.y === null ? y : it.y + (y - it.y) * 0.25;
        const fadeAge = it.age > 2.5 ? 1 - (it.age - 2.5) / 1.5 : 1;
        const alpha = Math.max(0, (i === 0 ? 1 : 0.55 - i * 0.08) * fadeAge);
        const color = it.sign > 0 ? C.up : C.down;
        g.globalAlpha = alpha;
        g.fillStyle = color;
        g.shadowColor = color;
        g.shadowBlur = (i === 0 ? 18 + it.pop * 14 : 0) * glow();
        g.font = `800 ${size}px "Bricolage Grotesque", system-ui, sans-serif`;
        g.fillText((it.sign > 0 ? "$" : "-$") + TC.format.money(TC.market.px(it.amount)).slice(1), b.r - 14, it.y);
        y += size * 0.95;
      });
      g.shadowBlur = 0;
      g.globalAlpha = 1;
    },
    clear() { feed.items = []; },
  };

  // Screen shake: jolts the chart container, decays quickly.
  let shakeT = 0, shakeMag = 0, wrapEl = null;
  function shake(mag, time = 0.35) {
    if (reduced) return;
    shakeMag = Math.max(shakeMag, mag);
    shakeT = Math.max(shakeT, time);
  }
  function updateShake(dt) {
    if (!wrapEl) return;
    if (shakeT <= 0) { if (wrapEl.style.transform) wrapEl.style.transform = ""; shakeMag = 0; return; }
    shakeT -= dt;
    const m = shakeMag * Math.max(0, shakeT / 0.35);
    wrapEl.style.transform = `translate(${(Math.random() - 0.5) * 2 * m}px, ${(Math.random() - 0.5) * 2 * m}px)`;
  }

  // Charge target line: while you hold, a dashed line climbs the chart to where the price will land
  // when you let go (+$ tag on the right). At full charge it turns solid white and pulses, tagged MAX.
  let chargeClock = 0;
  function drawCharge(g) {
    const c = api.charge;
    if (!c) return;
    chargeClock += 1 / 60;
    const t = chargeClock;
    const tip = TC.chart.tip(), b = TC.chart.bounds();
    const price = TC.state.data.basePrice || 1;
    const shots = c.max ? 15 : Math.round(12 * c.p);
    const add = shots * TC.market.perClick();
    // the y-axis starts at $0, so screen height is proportional to price
    const y = Math.max(b.t, b.b - (b.b - tip.y) * (price + add) / price);
    g.save();
    // the line
    g.strokeStyle = c.max ? C.core : C.line;
    g.shadowColor = C.line;
    g.shadowBlur = (c.max ? 20 + 8 * Math.sin(t * 16) : 8) * glow();
    g.lineWidth = c.max ? 2.5 : 1.5;
    g.setLineDash(c.max ? [] : [6, 6]);
    g.lineDashOffset = -t * 30;
    g.beginPath(); g.moveTo(b.l, y); g.lineTo(b.r, y); g.stroke();
    g.setLineDash([]);
    // a glowing column from the price tip up to the target
    if (tip.y > y) {
      const grad = g.createLinearGradient(0, tip.y, 0, y);
      grad.addColorStop(0, C.line + "00");
      grad.addColorStop(1, c.max ? C.core + "80" : C.line + "59");
      g.fillStyle = grad;
      g.shadowBlur = 0;
      g.fillRect(tip.x - 5, y, 10, tip.y - y);
    }
    // tag
    const label = (c.max ? "MAX  " : "") + "+" + TC.format.money(TC.market.px(add));
    g.font = '700 13px "IBM Plex Mono", monospace';
    const lw = g.measureText(label).width + 16;
    const lx = b.r - lw - 8, ly = Math.max(b.t + 2, y - 24);
    g.fillStyle = c.max ? C.core : C.line;
    g.shadowBlur = (c.max ? 14 : 0) * glow();
    g.beginPath();
    if (g.roundRect) g.roundRect(lx, ly, lw, 20, 5); else g.rect(lx, ly, lw, 20);
    g.fill();
    g.shadowBlur = 0;
    g.fillStyle = "#030605";
    g.textAlign = "left"; g.textBaseline = "middle";
    g.fillText(label, lx + 8, ly + 10);
    g.restore();
  }

  const api = {
    kinds,
    feed,
    shake,
    init(el) {
      canvas = el;
      ctx = canvas.getContext("2d");
      C = { up: token("up"), line: token("line"), down: token("down"), core: token("core") };
      wrapEl = canvas.parentElement;
      resize();
      window.addEventListener("resize", resize);
      wire();
    },
    spawn(kind, opts, cap = 400) {
      if (reduced && kind !== "floatText") return;
      if (kind === "pulse" && TC.chart.mode() === "candles") return; // pulses ride the line

      if (live.filter((e) => e.kind === kind).length >= cap) return;
      const e = kinds[kind](opts);
      e.kind = kind;
      live.push(e);
    },
    update(dt) {
      heat = Math.max(0, heat - dt * 0.7);
      bigMove.update(dt);
      for (let i = live.length - 1; i >= 0; i--) if (!live[i].update(dt)) live.splice(i, 1);
      feed.update(dt);
      updateShake(dt);
    },
    charge: null, // { x, y, p 0-1, max } set by main.js while you hold to charge
    draw() {
      ctx.clearRect(0, 0, w, h);
      for (const e of live) e.draw(ctx);
      feed.draw(ctx);
      drawCharge(ctx);
    },
    clear() { live.length = 0; feed.clear(); },
  };

  // ---------- Big moves ----------
  // Watches the real price over the last second. When it moves more than 6% / 15% / 30% in one
  // direction, fires a tier of effects once (a tier re-arms when the move fades below 3%).
  const TIERS = [0.06, 0.15, 0.3];
  const bigMove = {
    samples: [], fired: { up: 0, down: 0 }, mutedUntil: 0, clock: 0,
    update(dt) {
      const s = TC.state.data;
      if (!s.listed || s.basePrice <= 0) { this.samples.length = 0; return; }
      this.clock += dt;
      const now = s.basePrice;
      this.samples.push({ t: this.clock, p: now });
      while (this.samples.length && this.clock - this.samples[0].t > 1) this.samples.shift();
      let lo = Infinity, hi = 0;
      for (const x of this.samples) { if (x.p < lo) lo = x.p; if (x.p > hi) hi = x.p; }
      const up = lo > 0 ? now / lo - 1 : 0;
      const down = hi > 0 ? 1 - now / hi : 0;
      for (const [dir, mv] of [["up", up], ["down", down]]) {
        if (mv < 0.03) { this.fired[dir] = 0; continue; }
        const tier = TIERS.filter((x) => mv >= x).length;
        if (tier > this.fired[dir]) {
          this.fired[dir] = tier;
          if (this.clock >= this.mutedUntil) fireBig(dir, tier, mv);
        }
      }
    },
  };

  function fireBig(dir, tier, mv) {
    const tip = TC.chart.tip();
    const color = dir === "up" ? C.up : C.down;
    const hot = dir === "up" ? C.core : C.down;
    TC.events.emit("bigMove", { dir, tier, pct: mv });
    // Tier 1 (6%+): thick pulse, ring, small shake
    api.spawn("pulse", { color: hot, speed: 220, width: 30 + tier * 12, life: 1.3, strength: 1.3 + tier * 0.3 });
    api.spawn("ring", { x: tip.x, y: tip.y, color, max: 90 + tier * 60, life: 0.7 });
    for (let i = 0; i < 6 * tier; i++) api.spawn("spark", { x: tip.x, y: tip.y, color: i % 2 ? color : hot }, 200);
    shake(2 + tier * 3, 0.25 + tier * 0.1);
    if (tier < 2) return;
    // Tier 2 (15%+): whole chart flashes, double shockwave, big % call-out
    api.spawn("flash", { color, life: 0.5 + tier * 0.1, strength: tier === 3 ? 0.42 : 0.28 }, 3);
    api.spawn("ring", { x: tip.x, y: tip.y, color: hot, max: 220 + tier * 60, life: 0.9 });
    setTimeout(() => api.spawn("ring", { x: TC.chart.tip().x, y: TC.chart.tip().y, color, max: 300, life: 1 }), 120);
    api.spawn("vignette", { color, life: 1, strength: 0.9 }, 2);
    api.spawn("floatText", { x: w / 2 - 30, y: h * 0.4, text: (dir === "up" ? "+" : "−") + Math.round(mv * 100) + "%", color, size: tier === 3 ? 56 : 42, life: 1.4 });
  }

  // ---------- Wiring: which events trigger which effects ----------
  function wire() {
    TC.events.on("buy", ({ amount, x, y }) => {
      heat = Math.min(1, heat + 0.09);
      const k = heat;
      // Keyboard or button buys start from the bottom middle of the chart
      const fx = x ?? w * 0.45;
      const fy = y ?? h - 40;
      feed.add(amount, +1);
      TC.chart.flash("up");

      // At your finger. Bigger orders (vs the price) hit harder, on top of tap speed.
      const size = Math.min(1, amount / Math.max(TC.state.data.basePrice, 0.01) / 0.04);
      api.spawn("tapRipple", { x: fx, y: fy, k: Math.max(k, size) }, 24);
      if (size > 0.5) {
        const tp = TC.chart.tip();
        api.spawn("ring", { x: tp.x, y: tp.y, color: C.core, max: 60 + size * 80, life: 0.5 });
      }
      const n = 5 + Math.round(k * 9);
      for (let i = 0; i < n; i++) api.spawn("coin", { x: fx, y: fy, k }, 220);

      // Your order flies into the price, then the line lights up
      api.spawn("comet", {
        x: fx, y: fy, k,
        onArrive: (tip) => {
          for (let i = 0; i < 4 + Math.round(k * 6); i++) api.spawn("spark", { x: tip.x, y: tip.y, color: k > 0.66 ? C.core : C.line }, 160);
          api.spawn("pulse", { color: k > 0.66 ? C.core : C.line, strength: 1 + k * 0.6 }, 8);
        },
      }, 30);
      if (k > 0.85) shake(1.5, 0.12); // only a hum when you're really hammering it
    });

    TC.events.on("sell", ({ amount, cash, manual, bonus = 1 }) => {
      feed.add(amount, -1);
      TC.chart.flash("down");
      if (!manual) {
        api.spawn("pulse", { color: C.down, speed: 110, width: 22, strength: 1 }, 8);
        return;
      }
      // You dumped shares: a heavy red wave, a jolt, and the cash you took
      bigMove.mutedUntil = bigMove.clock + 0.6;
      const tip = TC.chart.tip();
      api.spawn("pulse", { color: C.down, speed: 200, width: 45, life: 1.6, strength: 1.8 });
      api.spawn("pulse", { color: C.down, speed: 120, width: 25, life: 2, strength: 1.2 });
      api.spawn("ring", { x: tip.x, y: tip.y, color: C.down, max: 140, life: 0.7 });
      for (let i = 0; i < 14; i++) api.spawn("spark", { x: tip.x, y: tip.y, color: C.down });
      api.spawn("floatText", { x: w / 2 - 30, y: h * 0.3, text: "SOLD +" + TC.format.money(cash), color: C.down, size: 30, life: 1.6 });
      if (bonus > 1) {
        api.spawn("floatText", { x: w / 2 - 30, y: h * 0.3 - 40, text: "PEAK SELL " + bonus + "x", color: C.core, size: 34, life: 1.8 });
        api.spawn("ring", { x: tip.x, y: tip.y, color: C.core, max: 200, life: 0.9 });
        api.spawn("vignette", { color: C.core, life: 0.8, strength: 0.5 }, 2);
      }
      shake(7);
    });

    // A buyer filled an order: its own line in the feed and a soft pulse, no finger effects
    TC.events.on("order", ({ amount }) => {
      feed.add(amount, +1, "buyer");
      const tip = TC.chart.tip();
      const frac = amount / Math.max(TC.state.data.basePrice, 0.01); // order size vs price
      const k = Math.min(1, frac / 0.05);                           // 0 small .. 1 at 5% of price
      api.spawn("pulse", { color: k > 0.6 ? C.core : C.line, speed: 130 + k * 80, width: 12 + k * 22, strength: 0.7 + k * 0.8 }, 8);
      for (let i = 0; i < 2 + Math.round(k * 10); i++) api.spawn("spark", { x: tip.x, y: tip.y }, 160);
      if (k > 0.4) api.spawn("ring", { x: tip.x, y: tip.y, color: C.line, max: 50 + k * 90, life: 0.6 });
      if (k >= 1) shake(2, 0.15);
    });

    TC.events.on("hype", ({ title, tone }) => {
      if (!title) return;
      const color = tone === "down" ? C.down : C.up;
      api.spawn("floatText", { x: w / 2 - 30, y: h * 0.55, text: title, color, size: 26, life: 1.6 });
      api.spawn("vignette", { color, life: 0.8, strength: 0.6 }, 2);
      api.spawn("pulse", { color: tone === "down" ? C.down : C.core, speed: 240, width: 36, life: 1.2, strength: 1.4 });
      shake(tone === "down" ? 5 : 3, 0.3);
    });

    TC.events.on("season", ({ id, name, cause }) => {
      const color = id === "bull" ? C.up : id === "bear" ? C.down : id === "frenzy" ? FRENZY : C.core;
      api.spawn("floatText", { x: w / 2 - 30, y: h * 0.45, text: name.toUpperCase(), color, size: 32, life: 2.2 });
      if (id === "frenzy") { api.spawn("floatText", { x: w / 2 - 30, y: h * 0.45 + 34, text: "EVERYONE PILES IN", color, size: 16, life: 2.2 }); shake(8, 0.6); }
      if (cause === "news") api.spawn("floatText", { x: w / 2 - 30, y: h * 0.45 + 34, text: id === "bear" ? "THE MOOD SOURS" : "THE MOOD TURNS", color, size: 16, life: 2.2 });
      api.spawn("vignette", { color, life: 1.4, strength: 0.8 }, 2);
      api.spawn("pulse", { color, speed: 200, width: 50, life: 1.6, strength: 1.6 });
      shake(id === "bear" ? 6 : 4, 0.4);
    });
    TC.events.on("seasonWarn", ({ next, name }) => {
      const color = next === "bull" ? C.up : next === "bear" ? C.down : C.core;
      api.spawn("floatText", { x: w / 2 - 30, y: h * 0.45, text: name.toUpperCase() + " IN 15s", color, size: 20, life: 1.8 });
    });

    TC.events.on("chain", ({ depth }) => {
      api.spawn("floatText", { x: w / 2 - 60, y: h * 0.38, text: depth > 1 ? "CHAIN REACTION x" + (depth + 1) : "CHAIN REACTION", color: FRENZY, size: 22, life: 1.6 });
      api.spawn("pulse", { color: FRENZY, speed: 260, width: 30, life: 1, strength: 1.2 });
      shake(3 + depth * 2, 0.3);
    });
    TC.events.on("marginCall", () => {
      const tip = TC.chart.tip();
      api.spawn("floatText", { x: w / 2 - 40, y: h * 0.5, text: "MARGIN CALL", color: C.down, size: 30, life: 1.6 });
      api.spawn("vignette", { color: C.down, life: 0.9, strength: 0.8 }, 2);
      api.spawn("ring", { x: tip.x, y: tip.y, color: C.down, max: 150, life: 0.7 });
      shake(6, 0.35);
    });
    TC.events.on("backfire", ({ title }) => {
      const tip = TC.chart.tip();
      api.spawn("floatText", { x: w / 2 - 30, y: h * 0.5, text: title, color: C.down, size: 30, life: 1.6 });
      api.spawn("vignette", { color: C.down, life: 0.9, strength: 0.8 }, 2);
      api.spawn("pulse", { color: C.down, speed: 220, width: 40, life: 1.4, strength: 1.6 });
      api.spawn("ring", { x: tip.x, y: tip.y, color: C.down, max: 150, life: 0.7 });
      shake(7, 0.4);
    });

    TC.events.on("overtrade", ({ kind, title }) => {
      const tip = TC.chart.tip();
      api.spawn("floatText", { x: w / 2 - 40, y: h * 0.46, text: title, color: C.down, size: kind === "halt" ? 34 : 30, life: 1.8 });
      api.spawn("vignette", { color: C.down, life: 1, strength: 0.9 }, 2);
      api.spawn("pulse", { color: C.down, speed: 220, width: 40, life: 1.4, strength: 1.6 });
      api.spawn("ring", { x: tip.x, y: tip.y, color: C.down, max: 160, life: 0.7 });
      if (kind === "halt") api.spawn("flash", { color: C.down, life: 0.5, strength: 0.35 }, 3);
      shake(kind === "halt" ? 9 : 6, 0.4);
    });
    TC.events.on("sellWall", ({ amount, x, y }) => {
      const tip = TC.chart.tip();
      api.spawn("floatText", { x: (x ?? tip.x) - 20, y: (y ?? tip.y) - 24, text: "SELL WALL −" + TC.format.money(TC.market.px(amount)), color: C.down, size: 15, life: 0.9 });
      api.spawn("ring", { x: tip.x, y: tip.y, color: C.down, max: 50, life: 0.4 });
    });
    TC.events.on("halted", ({ x, y }) => {
      const tip = TC.chart.tip();
      api.spawn("floatText", { x: (x ?? tip.x) - 20, y: (y ?? tip.y) - 20, text: "HALTED", color: C.muted || C.down, size: 13, life: 0.6 });
    });

    TC.events.on("dipStake", ({ shares, discount }) => {
      api.spawn("floatText", { x: w / 2 - 70, y: h * 0.4, text: "+" + +(shares / TC.config.sharesOutstanding * 100).toFixed(2) + "% STAKE · " + Math.round(discount * 100) + "% OFF", color: C.up, size: 20, life: 1.6 });
    });
    TC.events.on("split", ({ factor }) => {
      api.spawn("floatText", { x: w / 2 - 80, y: h * 0.42, text: factor + "-FOR-1 SPLIT", color: C.core, size: 30, life: 2 });
      api.spawn("vignette", { color: C.up, life: 1, strength: 0.7 }, 2);
      api.spawn("pulse", { color: C.core, speed: 220, width: 46, life: 1.4, strength: 1.6 });
      TC.chart.flash("up");
      shake(5, 0.35);
    });
    TC.events.on("chargeMax", () => {
      const tip = TC.chart.tip();
      api.spawn("ring", { x: tip.x, y: tip.y, color: C.core, max: 110, life: 0.5 });
      api.spawn("vignette", { color: C.up, life: 0.4, strength: 0.35 }, 2);
      shake(2, 0.15);
    });
    TC.events.on("chargeRelease", ({ x, y, n, max }) => {
      api.spawn("ring", { x, y, color: max ? C.core : C.line, max: max ? 200 : 90 + n * 6, life: max ? 0.8 : 0.5 });
      if (max) {
        api.spawn("floatText", { x: x - 40, y: y - 60, text: "x" + n + " BURST", color: C.up, size: 24, life: 1.2 });
        api.spawn("pulse", { color: C.core, speed: 260, width: 34, life: 1, strength: 1.4 });
        shake(4, 0.25);
      }
    });
    TC.events.on("buyback", ({ cost, insider }) => {
      api.spawn("floatText", { x: w / 2 - 60, y: h * 0.4, text: "BUYBACK +" + +(TC.config.stake.buyback / TC.config.sharesOutstanding * 100).toFixed(2) + "% STAKE", color: C.up, size: 22, life: 1.4 });
      if (insider) {
        api.spawn("floatText", { x: w / 2 - 60, y: h * 0.47, text: "INSIDER BUYING +3%", color: C.up, size: 18, life: 1.6 });
        api.spawn("pulse", { color: C.up, speed: 220, width: 30, life: 1, strength: 1.2 });
      }
      api.spawn("vignette", { color: C.up, life: 0.6, strength: 0.4 }, 2);
    });
    TC.events.on("dividend", ({ cash, shares }) => {
      const tip = TC.chart.tip();
      const text = shares ? "DRIP +" + +(shares / TC.config.sharesOutstanding * 100).toFixed(3) + "% STAKE" : "DIVIDEND +" + TC.format.money(cash);
      api.spawn("floatText", { x: tip.x - 120, y: tip.y - 30, text, color: C.up, size: 20, life: 1.6 });
      api.spawn("ring", { x: tip.x, y: tip.y, color: C.up, max: 70, life: 0.6 });
    });
    TC.events.on("fine", ({ amount }) => {
      api.spawn("floatText", { x: w / 2 - 30, y: h * 0.42, text: "SEC FINE −" + TC.format.money(amount), color: C.down, size: 30, life: 2 });
      api.spawn("flash", { color: C.down, life: 0.6, strength: 0.3 }, 3);
      shake(6, 0.35);
    });
    TC.events.on("crashSell", () => {
      api.spawn("floatText", { x: w / 2 - 30, y: h * 0.58, text: "SOLD INTO THE CRASH", color: C.down, size: 22, life: 1.6 });
    });
    TC.events.on("debuff", ({ id, name }) => {
      if (id === "remorse" || id === "halt" || id === "poach" || id === "copycat") return; // already announced elsewhere
      api.spawn("floatText", { x: w / 2 - 30, y: h * 0.62, text: name.toUpperCase(), color: C.down, size: 22, life: 1.8 });
      api.spawn("vignette", { color: C.down, life: 0.8, strength: 0.5 }, 2);
    });

    TC.events.on("stackBuy", () => {
      api.spawn("floatText", { x: w / 2 - 30, y: h * 0.32, text: "BOUGHT THE DIP", color: C.up, size: 32, life: 1.5 });
      api.spawn("vignette", { color: C.up, life: 0.7, strength: 0.5 }, 2);
      shake(3, 0.25);
    });

    TC.events.on("rally", ({ amount }) => {
      feed.add(amount, +1);
      api.spawn("pulse", { color: C.line, speed: 170, width: 20 }, 6);
      TC.chart.flash("up");
    });

    TC.events.on("news", ({ tone, big }) => {
      const color = tone === "up" ? C.up : tone === "down" ? C.down : C.core;
      api.spawn("vignette", { color, life: big ? 1.1 : 0.8, strength: big ? 0.9 : 0.55 }, 2);
      if (big) shake(tone === "down" ? 9 : 6, 0.45);
    });

    TC.events.on("milestone", ({ price }) => {
      const tip = TC.chart.tip();
      api.spawn("ring", { x: tip.x, y: tip.y, max: 160 });
      api.spawn("pulse", { color: C.core, speed: 260, width: 40, life: 1.2, strength: 1.4 });
      api.spawn("floatText", { x: w / 2 - 30, y: h * 0.22, text: TC.format.axis(TC.market.px(price)) + " CROSSED", color: C.up });
      shake(4, 0.3);
    });

    TC.events.on("ipo", ({ symbol }) => {
      const tip = TC.chart.tip();
      api.spawn("ring", { x: tip.x, y: tip.y, max: 200, life: 1.1 });
      api.spawn("floatText", { x: w / 2 - 30, y: h * 0.4, text: "$" + symbol + " IS LIVE", color: C.up, size: 30, life: 1.8 });
    });

    TC.events.on("private", ({ points }) => {
      api.spawn("vignette", { color: C.core, life: 1.4, strength: 1 });
      api.spawn("floatText", { x: w / 2 - 30, y: h * 0.4, text: "+" + points + " FOUNDER POINTS", color: C.core, size: 28, life: 2 });
      shake(10, 0.5);
    });

    TC.events.on("achievement", () => {
      const tip = TC.chart.tip();
      api.spawn("ring", { x: tip.x, y: tip.y, color: C.core, max: 90, life: 0.7 });
    });

    TC.events.on("offline", () => {
      api.spawn("pulse", { color: C.line, speed: 260, width: 50, life: 1.4, strength: 1.5 });
      api.spawn("vignette", { color: C.up, life: 1, strength: 0.6 });
    });

    TC.events.on("reset", () => api.clear());
  }

  return api;
})();
