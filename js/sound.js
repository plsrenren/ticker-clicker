// Sound: every sound is synthesized with the Web Audio API (no audio files), and each one
// hooks onto a game event, the same way effects.js does. The speaker button on the chart
// mutes and unmutes; the choice is saved in settings.sound.
//
// Where sounds play:
//   buy (your tap)      short blip; pitch climbs while you tap fast
//   buy (stacked dip)   quick rising blips
//   order (buyers)      soft tick, throttled so lots of buyers don't get noisy
//   sell (you)          low thud + coin drop; PEAK SELL adds a bright triple chime
//   milestone           rising four-note arpeggio
//   news                alarm (bad), whoosh (good), clock ticks (earnings)
//   hype                whoosh up, or a buzz when a rumor is denied
//   stackBuy            bass hit + riser
//   purchase            cash-register "ka-ching"
//   achievement         sparkle chime
//   ipo / private       bell / big chord
//   offline collect     coin chime
//   bigMove             6%/15%/30% moves within a second: boom (down) or rising chord (up), bigger per tier
//   season / seasonWarn rising (bull) or falling (bear) brass chord / two-beep warning
window.TC = window.TC || {};

TC.sound = (() => {
  const st = () => TC.state.data;
  let ctx = null, master = null;
  let tapStreak = 0, lastTap = 0, lastTick = 0;

  const on = () => st().settings.sound !== false;

  function ensure() {
    if (ctx) { if (ctx.state === "suspended") ctx.resume(); return true; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.35;
    // Gentle limiter so stacked sounds don't clip
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 6;
    master.connect(comp); comp.connect(ctx.destination);
    return true;
  }

  // One oscillator note with a quick attack and exponential decay.
  function tone({ freq, to = null, type = "sine", dur = 0.12, vol = 0.5, delay = 0, attack = 0.005 }) {
    if (!ctx || !on()) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  // Filtered noise burst (whooshes, thuds, buzz texture).
  function noise({ dur = 0.3, vol = 0.3, from = 800, to = 4000, q = 1, delay = 0, type = "bandpass" }) {
    if (!ctx || !on()) return;
    const t = ctx.currentTime + delay;
    const len = Math.ceil(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource(); src.buffer = buf;
    const f = ctx.createBiquadFilter(); f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(from, t);
    f.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + dur * 0.3);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t); src.stop(t + dur + 0.02);
  }

  const chord = (notes, opts = {}) => notes.forEach((freq, i) => tone({ freq, ...opts, delay: (opts.delay || 0) + i * (opts.spread || 0) }));

  const sfx = {
    tap() {
      const now = performance.now();
      tapStreak = now - lastTap < 220 ? Math.min(tapStreak + 1, 24) : 0;
      lastTap = now;
      const f = 520 * Math.pow(2, tapStreak / 24); // climbs up to an octave
      tone({ freq: f, to: f * 1.5, type: "triangle", dur: 0.07, vol: 0.32 });
    },
    stackTap(i) { tone({ freq: 400 + i * 60, to: 700 + i * 60, type: "square", dur: 0.05, vol: 0.12 }); },
    tick() {
      const now = performance.now();
      if (now - lastTick < 140) return;
      lastTick = now;
      tone({ freq: 1800 + Math.random() * 400, type: "sine", dur: 0.03, vol: 0.06 });
    },
    sell(bonus) {
      tone({ freq: 140, to: 50, type: "sine", dur: 0.35, vol: 0.7 });
      noise({ dur: 0.25, vol: 0.25, from: 600, to: 120, type: "lowpass" });
      chord([1318, 1046, 880], { type: "triangle", dur: 0.12, vol: 0.25, spread: 0.06, delay: 0.05 });
      if (bonus > 1) chord([1568, 2093, 2637], { type: "sine", dur: 0.4, vol: 0.3, spread: 0.08, delay: 0.2 });
    },
    milestone() { chord([523, 659, 784, 1046], { type: "triangle", dur: 0.3, vol: 0.35, spread: 0.08 }); },
    alarm() { for (let i = 0; i < 3; i++) { tone({ freq: 880, type: "square", dur: 0.1, vol: 0.18, delay: i * 0.22 }); tone({ freq: 660, type: "square", dur: 0.1, vol: 0.18, delay: i * 0.22 + 0.11 }); } },
    whoosh() { noise({ dur: 0.6, vol: 0.35, from: 300, to: 5000, q: 2 }); tone({ freq: 300, to: 900, type: "sawtooth", dur: 0.5, vol: 0.08 }); },
    ticks() { for (let i = 0; i < 4; i++) tone({ freq: 1200, type: "square", dur: 0.03, vol: 0.12, delay: i * 0.25 }); },
    buzz() { tone({ freq: 110, type: "sawtooth", dur: 0.4, vol: 0.3 }); tone({ freq: 116, type: "sawtooth", dur: 0.4, vol: 0.25 }); },
    bassHit() { tone({ freq: 90, to: 45, type: "sine", dur: 0.4, vol: 0.8 }); noise({ dur: 0.5, vol: 0.25, from: 200, to: 3000, q: 1.5, delay: 0.05 }); },
    kaching() {
      noise({ dur: 0.08, vol: 0.3, from: 3000, to: 2000, q: 3 });
      chord([1568, 2093], { type: "triangle", dur: 0.35, vol: 0.28, spread: 0.07, delay: 0.05 });
    },
    sparkle() { chord([1046, 1318, 1568, 2093, 2637], { type: "sine", dur: 0.35, vol: 0.2, spread: 0.05 }); },
    bell() { chord([523, 1046, 1568], { type: "sine", dur: 1.2, vol: 0.3, attack: 0.01 }); },
    bigChord() { chord([262, 330, 392, 523, 659], { type: "triangle", dur: 1.6, vol: 0.22, spread: 0.04, attack: 0.02 }); },
    coins() { for (let i = 0; i < 5; i++) tone({ freq: 1800 + Math.random() * 900, type: "triangle", dur: 0.1, vol: 0.18, delay: i * 0.07 }); },
  };

  let stackI = 0;

  function paintButton() {
    const b = document.getElementById("soundBtn");
    if (!b) return;
    b.setAttribute("aria-pressed", on() ? "true" : "false");
    b.setAttribute("aria-label", on() ? "Mute sound" : "Turn sound on");
    b.dataset.on = on() ? "1" : "0";
  }

  return {
    sfx,
    init() {
      // Browsers only allow audio after a user gesture
      const unlock = () => ensure();
      window.addEventListener("pointerdown", unlock, { capture: true });
      window.addEventListener("keydown", unlock, { capture: true });

      const b = document.getElementById("soundBtn");
      b.addEventListener("pointerdown", (e) => e.stopPropagation());
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        st().settings.sound = !on();
        paintButton();
        TC.state.save();
        if (on()) { ensure(); sfx.tap(); }
      });
      paintButton();

      const E = TC.events;
      E.on("buy", (e) => { if (e.stack) sfx.stackTap(stackI++ % 12); else sfx.tap(); });
      E.on("order", () => sfx.tick());
      E.on("sell", (e) => { if (e.manual) sfx.sell(e.bonus || 1); });
      E.on("milestone", () => sfx.milestone());
      E.on("news", ({ tone: t, type }) => {
        if (type === "earnings") sfx.ticks();
        else if (t === "down") sfx.alarm();
        else if (t === "up") sfx.whoosh();
      });
      E.on("hype", ({ tone: t, title }) => { if (t === "down") sfx.buzz(); else if (title) sfx.whoosh(); });
      E.on("stackBuy", () => { stackI = 0; sfx.bassHit(); });
      E.on("purchase", () => sfx.kaching());
      E.on("split", () => { sfx.bell(); sfx.coins(); });
      E.on("chargeMax", () => { tone({ freq: 660, to: 1320, type: "triangle", dur: 0.16, vol: 0.28 }); tone({ freq: 1320, type: "sine", dur: 0.2, vol: 0.18, delay: 0.12 }); });
      E.on("chargeRelease", ({ max }) => { if (max) sfx.bassHit(); else tone({ freq: 220, to: 440, type: "triangle", dur: 0.12, vol: 0.25 }); });
      E.on("achievement", () => sfx.sparkle());
      E.on("ipo", () => sfx.bell());
      E.on("private", () => sfx.bigChord());
      E.on("offline", () => sfx.coins());
      E.on("dividend", () => sfx.coins());
      E.on("buyback", () => sfx.kaching());
      E.on("reset", () => paintButton());
      E.on("season", ({ id }) => {
        if (id === "bull") chord([392, 494, 587, 784], { type: "sawtooth", dur: 0.5, vol: 0.12, spread: 0.09 });
        else if (id === "frenzy") chord([523, 659, 784, 1047, 1319], { type: "square", dur: 0.45, vol: 0.09, spread: 0.06 });
        else if (id === "bear") chord([392, 330, 262, 196], { type: "sawtooth", dur: 0.6, vol: 0.12, spread: 0.12 });
        else chord([440, 440], { type: "triangle", dur: 0.4, vol: 0.2, spread: 0.2 });
      });
      E.on("chain", ({ depth }) => { chord([660, 880, 1175].slice(0, depth + 1), { type: "square", dur: 0.12, vol: 0.12, spread: 0.07 }); });
      E.on("marginCall", () => { sfx.buzz(); tone({ freq: 240, to: 50, type: "square", dur: 0.5, vol: 0.16 }); });
      E.on("backfire", () => { sfx.buzz(); tone({ freq: 300, to: 60, type: "sawtooth", dur: 0.6, vol: 0.2 }); });
      // Big moves: deeper, louder hit for bigger tiers
      E.on("bigMove", ({ dir, tier }) => {
        if (dir === "down") {
          tone({ freq: 120 - tier * 20, to: 35, type: "sine", dur: 0.4 + tier * 0.2, vol: 0.4 + tier * 0.15 });
          noise({ dur: 0.3 + tier * 0.2, vol: 0.15 + tier * 0.08, from: 900, to: 100, type: "lowpass" });
        } else {
          chord([392, 523, 659, 784].slice(0, tier + 1), { type: "triangle", dur: 0.35 + tier * 0.1, vol: 0.18 + tier * 0.05, spread: 0.05 });
          if (tier >= 2) noise({ dur: 0.5, vol: 0.2, from: 400, to: 6000, q: 2 });
        }
      });
      E.on("fine", () => { chord([440, 349, 262], { type: "square", dur: 0.25, vol: 0.15, spread: 0.12 }); });
      E.on("overtrade", (e) => { sfx.buzz(); tone({ freq: e.kind === "halt" ? 180 : 260, to: 50, type: "sawtooth", dur: e.kind === "halt" ? 0.9 : 0.6, vol: 0.22 }); });
      E.on("sellWall", () => { tone({ freq: 200, to: 120, type: "square", dur: 0.08, vol: 0.1 }); });
      E.on("halted", () => { tone({ freq: 110, type: "square", dur: 0.05, vol: 0.06 }); });
      E.on("debuff", (e) => { if (e.id === "remorse" || e.id === "halt") return; tone({ freq: 220, to: 150, type: "triangle", dur: 0.5, vol: 0.25 }); });
      E.on("seasonWarn", () => { tone({ freq: 660, type: "sine", dur: 0.25, vol: 0.2 }); tone({ freq: 660, type: "sine", dur: 0.25, vol: 0.2, delay: 0.35 }); });
    },
  };
})();
