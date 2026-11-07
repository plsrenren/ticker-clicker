// The price chart. Owns its canvas, its history buffer and its y-scale.
// Exposes geometry so effects can draw on top of the line:
//   TC.chart.points()    screen points of the line this frame [{x, y}], oldest first
//   TC.chart.tip()       the newest point
//   TC.chart.bounds()    plot rectangle {l, r, t, b, w, h}
//   TC.chart.flash(kind) flashes the price tag ("up" or "down")
//   TC.chart.zoomBy(f)   scale the visible time window (f < 1 zooms in); saved in settings.zoom
//   TC.chart.zoomY(f)    scale the price axis around the current price (f < 1 zooms in); settings.yZoom
//   TC.chart.resetY()    back to the automatic price axis
//   TC.chart.setRange(r) "live" (follows the price, zoomable) or "all" (the whole run since the IPO)
//   TC.chart.setMA(on)   show the two moving averages (cross labels show either way)
// Trader overlays on the LIVE view, all cosmetic: volume bars (trades per sample), support and
// resistance at recent swing highs/lows with BREAKOUT / BREAKDOWN labels, and fast/slow moving
// averages with GOLDEN CROSS / DEATH CROSS labels. They emit "breakout" and "maCross" events.
window.TC = window.TC || {};

TC.chart = (() => {
  const cfg = TC.config;
  let canvas, ctx, w = 0, h = 0, dpr = 1;
  let history = [];      // close of each sample
  let hiArr = [], loArr = []; // high/low seen during each sample, for candle wicks
  let volArr = [];       // trades (taps, buyer orders, sells) during each sample, for volume bars
  let mode = "line";     // "line" | "candles"
  let range = "live";    // "live" | "all"
  // Long-term record of the whole run for the ALL view, kept in the save (state.runChart):
  // one point every `every` seconds; when it gets too long, pairs merge and `every` doubles.
  const RUN_MAX = 600;
  let pts = [];
  let sinceSample = 0;
  let yMax = 10;            // animated top of the y-axis
  let yMin = 0;
  let yScale = 1;           // manual price-axis zoom on top of the auto range (1 = auto)             // animated bottom of the y-axis (the current price sits near the middle)
  let tagFlash = { kind: "up", t: 0 };
  let glowT = 0;            // extra line glow after a new all-time high (seconds left)
  const pad = { l: 10, r: 66, t: 18, b: 26 };
  const MAX = cfg.historyMax || cfg.historyPoints;
  let span = cfg.historyPoints; // visible samples (zoom level)
  const clampSpan = (v) => Math.round(Math.max(cfg.zoomMin || 40, Math.min(MAX, v)));
  // First history index that is (partly) on screen
  const visStart = () => Math.max(0, history.length - span - 1);
  const C = {};

  function readColors() {
    const cs = getComputedStyle(document.documentElement);
    for (const k of ["line", "core", "rule", "muted", "axis", "up", "down", "ink", "ma-fast", "ma-slow"]) {
      C[k] = cs.getPropertyValue("--" + k).trim();
    }
  }

  function resize() {
    const r = canvas.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    w = r.width; h = r.height;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // Pick a "nice" tick step (1, 2, 5 x 10^n) for a range.
  function niceStep(range, count) {
    const raw = range / count;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const n = raw / mag;
    return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * mag;
  }

  const plotW = () => w - pad.l - pad.r;
  const plotH = () => h - pad.t - pad.b;
  const yOf = (v) => pad.t + plotH() * (1 - (v - yMin) / Math.max(1e-9, yMax - yMin));
  const xOf = (i, shift) => pad.l + plotW() * ((i - (history.length - span) - shift) / (span - 1));

  function runRec() {
    const s = TC.state && TC.state.data;
    return s && s.runChart && Array.isArray(s.runChart.p) ? s.runChart : null;
  }
  // Start the record. A run already under way (a save from before this record existed) gets a
  // believable made-up path from $0 at the IPO to now, the same way the live chart is filled on load.
  // n points from $0 to `to`: an ease-in climb in log space with some noise and the odd dip
  function fakePath(n, to) {
    const a = Math.log(Math.min(to, 0.25)), b = Math.log(to), path = [], out = [];
    let x = 0;
    for (let i = 0; i < n; i++) { x += (Math.random() - 0.5) * 0.08 + (Math.random() < 0.01 ? -0.15 : 0); path.push(x); }
    for (let i = 0; i < n; i++) {
      const f = i / (n - 1);
      out.push(i === 0 ? 0 : Math.exp(a + (b - a) * Math.pow(f, 0.8) + path[i] - path[n - 1] * f));
    }
    out[n - 1] = to;
    return out;
  }
  function halve(r) {
    const p = [], hi = [], lo = [];
    for (let i = 0; i < r.p.length; i += 2) {
      const j = Math.min(i + 1, r.p.length - 1);
      p.push(i === 0 ? r.p[0] : r.p[j]); hi.push(Math.max(r.hi[i], r.hi[j])); lo.push(Math.min(r.lo[i], r.lo[j])); // keep the IPO point
    }
    r.p = p; r.hi = hi; r.lo = lo; r.every *= 2;
  }
  // A record that began mid-run (made by the first version of this view): fill in the time before it
  function backfill(s, r) {
    r.fromIpo = true;
    const pre = s.clock - ((r.p.length - 1) * r.every + r.t);
    if (pre < 6 || !(r.p[0] > 0)) { r.p.unshift(0); r.hi.unshift(0); r.lo.unshift(0); return; }
    const n = Math.max(2, Math.round(pre / r.every));
    const fake = fakePath(n + 1, r.p[0]).slice(0, n);
    r.p = fake.concat(r.p); r.hi = fake.concat(r.hi); r.lo = fake.concat(r.lo);
    while (r.p.length > RUN_MAX) halve(r);
  }
  function startRun(s, live) {
    const r = { every: 2, t: 0, p: [], hi: [], lo: [], fromIpo: true };
    if (s.clock >= 6 && live > 0) {
      const n = Math.max(3, Math.min(RUN_MAX, Math.floor(s.clock / 2)));
      r.every = s.clock / (n - 1);
      r.p = fakePath(n, live); r.hi = r.p.slice(); r.lo = r.p.slice();
    } else {
      // A fresh listing: pin the IPO point at $0, then the live point keeps updating after it
      r.p = [0, live]; r.hi = [0, live]; r.lo = [0, live];
    }
    return (s.runChart = r);
  }
  function recordRun(dt, live) {
    const s = TC.state && TC.state.data;
    if (!s || !s.listed || !(live >= 0)) return;
    const r = runRec() || startRun(s, live);
    if (!r.fromIpo) backfill(s, r);
    const L = r.p.length - 1;
    r.t += dt;
    if (L < 0 || r.t >= r.every) {
      r.t = L < 0 ? 0 : Math.min(r.t - r.every, r.every);
      r.p.push(live); r.hi.push(live); r.lo.push(live);
      if (r.p.length > RUN_MAX) halve(r);
    } else {
      r.p[L] = live;
      if (live > r.hi[L]) r.hi[L] = live;
      if (live < r.lo[L]) r.lo[L] = live;
    }
  }
  // Chart markers (stock splits). LIVE keeps them by sample number, ALL by seconds since the record began.
  let sampleN = 0;
  let liveMarks = [];   // [{ n, label }]
  const runTotal = (r) => (r.p.length - 1) * r.every + r.t;
  function drawMark(x, label) {
    if (x < pad.l || x > w - pad.r) return;
    const top = pad.t, bot = h - pad.b;
    ctx.strokeStyle = C.core + "88"; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, top + 18); ctx.lineTo(Math.round(x) + 0.5, bot); ctx.stroke(); ctx.setLineDash([]);
    ctx.font = '600 10px "IBM Plex Mono", monospace';
    const tw = ctx.measureText(label).width + 10;
    const lx = Math.min(w - pad.r - tw, Math.max(pad.l, x - tw / 2));
    ctx.fillStyle = C.core;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(lx, top, tw, 16, 4); else ctx.rect(lx, top, tw, 16);
    ctx.fill();
    ctx.fillStyle = C.ink; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(label, lx + tw / 2, top + 8);
  }
  const allOn = () => { const r = range === "all" && runRec(); return !!r && r.p.length >= 3; };

  // Candles for the ALL view: about 60 across the run
  function drawCandlesAll() {
    const r = runRec(), n = r.p.length;
    const K = Math.max(1, Math.ceil(n / 60));
    const step = plotW() / (n - 1);
    const bodyW = Math.max(2, step * K * 0.62);
    let open = r.p[0];
    for (let start = 0; start < n; start += K) {
      const end = Math.min(n - 1, start + K - 1);
      let hi = -Infinity, lo = Infinity;
      for (let i = start; i <= end; i++) { if (r.hi[i] > hi) hi = r.hi[i]; if (r.lo[i] < lo) lo = r.lo[i]; }
      const close = r.p[end];
      const color = close >= open ? C.up : C.down;
      const cx = pad.l + step * (start + end) / 2;
      ctx.strokeStyle = color; ctx.fillStyle = color; ctx.shadowColor = color; ctx.shadowBlur = 8; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(cx, yOf(hi)); ctx.lineTo(cx, yOf(lo)); ctx.stroke();
      const yO = yOf(open), yC = yOf(close);
      ctx.fillRect(cx - bodyW / 2, Math.min(yO, yC), bodyW, Math.max(1.5, Math.abs(yC - yO)));
      ctx.shadowBlur = 0;
      open = close;
    }
  }

  function strokeLine() {
    ctx.beginPath();
    for (let i = 0; i < pts.length; i++) i ? ctx.lineTo(pts[i].x, pts[i].y) : ctx.moveTo(pts[i].x, pts[i].y);
    ctx.stroke();
  }

  // Group samples into candles; the newest candle is still forming.
  function drawCandles() {
    const K = Math.max(2, Math.round(cfg.candleSamples * span / cfg.historyPoints));
    const n = history.length;
    const shift = sinceSample / cfg.sampleMs;
    const step = plotW() / (span - 1);
    const bodyW = Math.max(2, step * K * 0.62);
    // Align groups to the newest sample so the forming candle is always on the right
    let first = (n - 1) % K;
    const vs = visStart();
    while (first + K < vs) first += K;
    let open = history[Math.max(0, first - K)];
    for (let end = first; end < n; end += K) {
      const start = Math.max(0, end - K + 1);
      let hi = -Infinity, lo = Infinity;
      for (let i = start; i <= end; i++) { if (hiArr[i] > hi) hi = hiArr[i]; if (loArr[i] < lo) lo = loArr[i]; }
      const close = history[end];
      const up = close >= open;
      const color = up ? C.up : C.down;
      const cx = (xOf(start, end === n - 1 ? 0 : shift) + xOf(end, end === n - 1 ? 0 : shift)) / 2;
      const yO = yOf(open), yC = yOf(close);
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = 10;
      ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(cx, yOf(hi)); ctx.lineTo(cx, yOf(lo)); ctx.stroke();
      const top = Math.min(yO, yC), hgt = Math.max(1.5, Math.abs(yC - yO));
      ctx.fillRect(cx - bodyW / 2, top, bodyW, hgt);
      ctx.shadowBlur = 0;
      open = close;
    }
  }

  // ---- Trader overlays (LIVE view) ----
  const IND = cfg.indicators;
  let showMA = false;
  let res = null, sup = null;   // { v, ath } levels being watched
  let maSign = 0;               // +1 fast above slow, -1 below (with hysteresis)
  let lastBreak = -1e9, lastCross = -1e9;
  let tags = [];                // floating labels [{ n, v, text, color, t }], n = sample number
  let secs = 0;                 // own clock for cooldowns

  function resetInd() { res = sup = null; maSign = 0; tags = []; }
  // Simple moving average of `len` closes ending at history index i
  function sma(i, len) {
    const a = Math.max(0, i - len + 1);
    let sum = 0;
    for (let k = a; k <= i; k++) sum += history[k];
    return sum / (i - a + 1);
  }
  function addTag(text, color, v) {
    tags.push({ n: sampleN, v, text, color, t: 0 });
    if (tags.length > 6) tags.shift();
  }
  // Swing levels: a sample that is the high (low) of the samples `w` either side of it.
  // Resistance is the nearest swing high above the price (or your all-time high), support the nearest swing low below.
  function findLevels(live) {
    const n = history.length, wv = IND.pivot, a = visStart() + wv, b = n - 1 - wv;
    let r = Infinity, s = -Infinity;
    for (let i = a; i <= b; i++) {
      const v = history[i];
      if (v > live * 1.002 && v < r || v < live * 0.998 && v > s) {
        let hi = true, lo = true;
        for (let k = i - wv; k <= i + wv && (hi || lo); k++) {
          if (history[k] > v) hi = false;
          if (history[k] < v) lo = false;
        }
        if (hi && v > live * 1.002 && v < r) r = v;
        if (lo && v < live * 0.998 && v > s) s = v;
      }
    }
    const best = (TC.state && TC.state.data.bestPrice) || 0;
    if (!isFinite(r) && best > live * 1.002) res = { v: best, ath: true };
    else res = isFinite(r) ? { v: r, ath: false } : null;
    sup = isFinite(s) && s > 0 ? { v: s } : null;
  }
  // Runs once per new chart sample
  function onSample(live) {
    if (!(live > 0) || !TC.state || !TC.state.data.listed) return;
    // Breaks of the levels we were watching
    if (res && live > res.v * (1 + IND.breakPct)) {
      if (!res.ath && secs - lastBreak > IND.breakCooldown) {
        lastBreak = secs;
        addTag("BREAKOUT", C.up, res.v);
        TC.events.emit("breakout", { dir: "up", level: res.v });
      }
      res = null;
    }
    if (sup && live < sup.v * (1 - IND.breakPct)) {
      if (secs - lastBreak > IND.breakCooldown) {
        lastBreak = secs;
        addTag("BREAKDOWN", C.down, sup.v);
        TC.events.emit("breakout", { dir: "down", level: sup.v });
      }
      sup = null;
    }
    findLevels(live);
    // Moving average cross, with a little hysteresis so chop doesn't spam labels
    const L = history.length - 1;
    const f = sma(L, IND.fast), sl = sma(L, IND.slow);
    const d = (f - sl) / Math.max(1e-9, live);
    const sign = d > IND.crossPct ? 1 : d < -IND.crossPct ? -1 : 0;
    if (sign && sign !== maSign) {
      if (maSign && secs - lastCross > IND.crossCooldown) {
        lastCross = secs;
        addTag(sign > 0 ? "GOLDEN CROSS" : "DEATH CROSS", sign > 0 ? C["ma-fast"] : C.down, (f + sl) / 2);
        TC.events.emit("maCross", { dir: sign > 0 ? "golden" : "death" });
      }
      maSign = sign;
    }
  }

  function drawVolume(shift) {
    const n = history.length, vs = visStart();
    let max = 4;
    for (let i = vs; i < n; i++) if (volArr[i] > max) max = volArr[i];
    const bot = h - pad.b, H = Math.min(46, plotH() * IND.volHeight);
    const bw = Math.max(1, plotW() / (span - 1) * 0.7);
    for (let i = Math.max(1, vs); i < n; i++) {
      const v = volArr[i];
      if (!v) continue;
      const x = xOf(i, i === n - 1 ? 0 : shift);
      const bh = Math.max(1, H * v / max);
      ctx.fillStyle = (history[i] >= history[i - 1] ? C.up : C.down) + "4d";
      ctx.fillRect(x - bw / 2, bot - bh, bw, bh);
    }
  }

  function drawLevel(lv, color, text) {
    if (!lv) return;
    const y = Math.round(yOf(lv.v)) + 0.5;
    if (y < pad.t || y > h - pad.b) return;
    ctx.strokeStyle = color + "59"; ctx.lineWidth = 1; ctx.setLineDash([6, 5]);
    ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke(); ctx.setLineDash([]);
    ctx.font = '500 9px "IBM Plex Mono", monospace'; ctx.fillStyle = color + "b3";
    ctx.textAlign = "left"; ctx.textBaseline = text === "S" ? "top" : "bottom";
    ctx.fillText(text + " " + TC.format.axis(TC.market.px(lv.v)), pad.l + 4, text === "S" ? y + 3 : y - 3);
  }

  function drawMA(shift) {
    const n = history.length, vs = Math.max(0, visStart());
    ctx.lineJoin = "round"; ctx.lineWidth = 1.3;
    for (const [len, color] of [[IND.slow, C["ma-slow"]], [IND.fast, C["ma-fast"]]]) {
      ctx.strokeStyle = color + "cc";
      ctx.beginPath();
      for (let i = vs; i < n; i++) {
        const x = xOf(i, i === n - 1 ? 0 : shift), y = yOf(sma(i, len));
        i === vs ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }

  function drawTags(shift, dt) {
    const life = IND.tagLife;
    tags = tags.filter((t) => t.t < life);
    ctx.font = '700 10px "IBM Plex Mono", monospace';
    const placed = [];
    for (const t of tags) {
      t.t += dt;
      const a = Math.min(1, t.t / 0.15, (life - t.t) / 0.6);
      const x = Math.min(w - pad.r - 8, xOf(history.length - 1 - (sampleN - t.n), shift));
      let y = Math.max(pad.t + 30, Math.min(h - pad.b - 30, yOf(t.v))) - 16 - t.t * 6;
      const tw = ctx.measureText(t.text).width + 12;
      const lx = Math.min(w - pad.r - tw - 4, Math.max(pad.l, x - tw / 2));
      // Don't let two labels sit on top of each other
      while (placed.some((q) => lx < q.x + q.w && q.x < lx + tw && Math.abs(q.y - y) < 20)) y -= 21;
      placed.push({ x: lx, y, w: tw });
      ctx.globalAlpha = Math.max(0, a);
      ctx.fillStyle = C.ink + "d9"; ctx.strokeStyle = t.color; ctx.lineWidth = 1;
      ctx.shadowColor = t.color; ctx.shadowBlur = 10;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(lx, y - 9, tw, 18, 9); else ctx.rect(lx, y - 9, tw, 18);
      ctx.fill(); ctx.stroke(); ctx.shadowBlur = 0;
      ctx.fillStyle = t.color; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(t.text, lx + tw / 2, y + 0.5);
      ctx.globalAlpha = 1;
    }
  }
  let lastDraw = 0;

  const api = {
    init(el) {
      const saved = TC.state && TC.state.data.settings.zoom;
      if (saved) span = clampSpan(saved);
      const sy = TC.state && TC.state.data.settings.yZoom;
      if (sy) yScale = Math.max(0.15, Math.min(6, sy));
      canvas = el;
      ctx = canvas.getContext("2d");
      readColors();
      resize();
      window.addEventListener("resize", resize);
      showMA = !!(TC.state && TC.state.data.settings.ma);
      // Volume: every trade counts once, whoever made it
      const vol = () => { if (volArr.length) volArr[volArr.length - 1]++; };
      for (const e of ["buy", "order", "sell", "rally"]) TC.events.on(e, vol);
      api.clear();
    },

    clear() {
      liveMarks = [];
      api.fill(0);
      yMax = 10; yMin = 0;
    },

    // Restore the visible line to a flat level (used after loading a save).
    fill(value) {
      history = new Array(MAX).fill(value);
      hiArr = history.slice(); loArr = history.slice();
      volArr = new Array(MAX).fill(0);
      resetInd();
    },

    // Fill the history with a made-up but believable path that ends exactly at `to`
    // (used when you come back to the game, so the chart isn't a flat line).
    // A random walk in log space with fat-tailed jumps, bent so it starts near `from` and lands on `to`.
    walk(from, to) {
      if (!(to > 0)) return api.fill(to || 0);
      if (!(from > 0)) from = to;
      const n = MAX, vol = 0.006, path = new Array(n);
      let x = 0;
      for (let i = 0; i < n; i++) {
        let step = (Math.random() - 0.5) * 2 * vol;
        if (Math.random() < 0.012) step += (Math.random() < 0.5 ? -1 : 1) * (0.02 + Math.random() * 0.05); // the odd spike or drop
        x += step;
        path[i] = x;
      }
      // Brownian bridge: remove the walk's own drift, then add the real move from `from` to `to`
      const a = Math.log(from), b = Math.log(to), end = path[n - 1];
      history = new Array(n); hiArr = new Array(n); loArr = new Array(n);
      for (let i = 0; i < n; i++) {
        const f = i / (n - 1);
        const v = Math.exp(a + (b - a) * f + path[i] - end * f);
        const w = v * vol * Math.random();
        history[i] = v; hiArr[i] = v + w; loArr[i] = Math.max(0, v - w);
      }
      history[n - 1] = hiArr[n - 1] = loArr[n - 1] = to;
      // Believable made-up volume: light, with bursts on the bigger moves
      volArr = history.map((v, i) => i ? Math.round(Math.random() * 3 + Math.abs(v / history[i - 1] - 1) * 400) : 0);
      resetInd();
    },

    snapshot() { return history.slice(); },
    restore(arr) {
      if (!Array.isArray(arr) || !arr.length) return;
      history = arr.slice(-MAX);
      hiArr = history.slice(); loArr = history.slice();
      volArr = new Array(history.length).fill(0);
      resetInd();
    },

    // Drop a marker at "now" on both views (e.g. "10:1" for a stock split)
    mark(label) {
      liveMarks.push({ n: sampleN, label });
      if (liveMarks.length > 20) liveMarks.shift();
      const r = runRec();
      if (r) { (r.marks = r.marks || []).push({ at: runTotal(r), label }); }
    },
    range: () => range,
    setRange(r) { range = r === "all" ? "all" : "live"; },
    ma: () => showMA,
    setMA(on) { showMA = !!on; },
    mode: () => mode,
    setMode(m) { mode = m === "candles" ? "candles" : "line"; },

    span: () => span,
    yZoomed: () => Math.abs(yScale - 1) > 0.01,
    zoomY(f) {
      if (range === "all") return TC.ui && TC.ui.setChartRange("live"); // zooming means you want the live view back
      yScale = Math.max(0.15, Math.min(6, yScale * f));
      if (TC.state) TC.state.data.settings.yZoom = yScale;
    },
    resetY() { yScale = 1; if (TC.state) TC.state.data.settings.yZoom = 1; },
    zoomBy(f) {
      if (range === "all") return TC.ui && TC.ui.setChartRange("live");
      const next = clampSpan(span * f);
      if (next === span) return;
      span = next;
      if (TC.state) TC.state.data.settings.zoom = span;
    },

    update(dt, live) {
      sinceSample += dt * 1000;
      while (sinceSample >= cfg.sampleMs) {
        sinceSample -= cfg.sampleMs;
        history.push(live); hiArr.push(live); loArr.push(live); volArr.push(0);
        sampleN++;
        if (history.length > MAX) { history.shift(); hiArr.shift(); loArr.shift(); volArr.shift(); }
        onSample(live);
      }
      secs += dt;
      const L = history.length - 1;
      history[L] = live;
      if (live > hiArr[L]) hiArr[L] = live;
      if (live < loArr[L]) loArr[L] = live;
      recordRun(dt, live);

      if (allOn()) {
        // ALL: the whole run fits the plot; the axis spans its low to high (and your ATH)
        const r = runRec(), n = r.p.length;
        let hi = Math.max(...(mode === "candles" ? r.hi : r.p), live, TC.state.data.bestPrice || 0);
        const margin = Math.max(hi * 0.08, 0.5);
        const tMax = hi + margin, tMin = 0; // ALL always starts from $0
        yMax += (tMax - yMax) * Math.min(1, 6 * dt);
        yMin += (tMin - yMin) * Math.min(1, 6 * dt);
        if (tagFlash.t > 0) tagFlash.t -= dt;
        if (glowT > 0) glowT -= dt;
        pts = [];
        for (let i = 0; i < n; i++) pts.push({ x: pad.l + plotW() * (i / (n - 1)), y: yOf(i === n - 1 ? live : r.p[i]) });
        return;
      }

      // Ease the y-axis so the current price sits near the middle: the range reaches as far
      // above and below it as the furthest visible point, plus 15%, and never narrower than +-10%.
      const vs = visStart();
      const peak = Math.max(...(mode === "candles" ? hiArr : history).slice(vs), 1);
      const low = Math.min(...(mode === "candles" ? loArr : history).slice(vs));
      const half = Math.max(peak - live, live - low, live * 0.1, 0.5) * 1.15 * yScale;
      const tMax = live + half, tMin = Math.max(0, live - half);
      const kMax = tMax > yMax ? 8 : 1.5, kMin = tMin < yMin ? 8 : 1.5; // widen fast, tighten slowly
      yMax += (tMax - yMax) * Math.min(1, kMax * dt);
      yMin += (tMin - yMin) * Math.min(1, kMin * dt);

      if (tagFlash.t > 0) tagFlash.t -= dt;
      if (glowT > 0) glowT -= dt;

      // Screen points for this frame (smooth scroll between samples; newest point pinned to "now").
      const shift = sinceSample / cfg.sampleMs;
      const n = history.length;
      pts = [];
      for (let i = vs; i < n; i++) pts.push({ x: xOf(i, i === n - 1 ? 0 : shift), y: yOf(history[i]) });
    },

    points: () => pts,
    yOf: (v) => yOf(v),
    tip: () => pts[pts.length - 1] || { x: w - pad.r, y: h - pad.b },
    // Inset the plot (e.g. when the chart sits behind the header and dock)
    setPad(p) { Object.assign(pad, p); },
    bounds: () => ({ l: pad.l, r: w - pad.r, t: pad.t, b: h - pad.b, w, h }),
    flash(kind) { tagFlash = { kind, t: 0.35 }; },
    glow(secs = 1.2) { glowT = secs; },

    draw() {
      ctx.clearRect(0, 0, w, h);
      if (!pts.length) return;
      const n = history.length;

      // Grid + y labels
      const step = niceStep(yMax - yMin, 5);
      ctx.font = '500 10px "IBM Plex Mono", monospace';
      ctx.textBaseline = "middle";
      ctx.textAlign = "left";
      for (let v = Math.ceil(yMin / step) * step; v <= yMax; v += step) {
        const y = Math.round(yOf(v)) + 0.5;
        ctx.strokeStyle = C.rule;
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke();
        ctx.fillStyle = C.axis;
        ctx.fillText(TC.format.axis(TC.market.px(v)), w - pad.r + 8, y);
      }

      const all = allOn();
      if (!all && Math.abs(yScale - 1) > 0.01) {
        ctx.fillStyle = C.muted;
        ctx.textAlign = "left";
        ctx.fillText("AUTO ↺", w - pad.r + 8, h - pad.b - 10);
      }

      // Time labels
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      if (all) {
        // ALL: four labels from the start of the run to now
        const r = runRec();
        const total = (r.p.length - 1) * r.every + r.t;
        const long = (s) => s < 60 ? `-${Math.round(s)}s` : s < 3600 ? `-${Math.round(s / 60)}m` : `-${Math.floor(s / 3600)}h${Math.round((s % 3600) / 60)}m`;
        for (let k = 0; k <= 3; k++) {
          const x = pad.l + plotW() * (k / 3);
          ctx.fillStyle = C.muted;
          ctx.textAlign = k === 0 ? "left" : k === 3 ? "right" : "center";
          ctx.fillText(k === 3 ? "now" : k === 0 && r.fromIpo ? "IPO" : long(total * (1 - k / 3)), x, h - pad.b + 8);
        }
        ctx.textAlign = "center";
      }
      const secs = all ? 0 : (span * cfg.sampleMs) / 1000;
      // About 4 labels whatever the zoom
      const every = [2, 5, 10, 15, 30, 60, 90, 120].find((e) => secs / e <= 4.5) || 120;
      const fmt = (s) => s === 0 ? "now" : s < 60 ? `-${s}s` : s % 60 ? `-${Math.floor(s / 60)}m${s % 60}s` : `-${s / 60}m`;
      for (let s = 0; !all && s <= secs + 0.01; s += every) {
        const x = pad.l + plotW() * (1 - s / secs);
        ctx.fillStyle = C.muted;
        ctx.fillText(fmt(s), x, h - pad.b + 8);
      }

      ctx.save();
      ctx.beginPath();
      ctx.rect(pad.l, 0, plotW(), h - pad.b);
      ctx.clip();

      // ALL: dotted line at your all-time high
      const best = TC.state && TC.state.data.bestPrice;
      if (all && best > 0) {
        const y = Math.round(yOf(best)) + 0.5;
        ctx.strokeStyle = C.up + "66"; ctx.lineWidth = 1; ctx.setLineDash([2, 4]);
        ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke(); ctx.setLineDash([]);
        ctx.font = '500 10px "IBM Plex Mono", monospace'; ctx.fillStyle = C.up; ctx.textAlign = "left"; ctx.textBaseline = "bottom";
        ctx.fillText("ATH " + TC.format.axis(TC.market.px(best)), pad.l + 4, y - 3);
      }

      // Markers (stock splits)
      if (all) {
        const r = runRec(), total = runTotal(r);
        for (const m of r.marks || []) drawMark(pad.l + plotW() * (m.at / Math.max(1e-9, total)), m.label);
      } else {
        const shift = sinceSample / cfg.sampleMs;
        for (const m of liveMarks) drawMark(xOf(history.length - 1 - (sampleN - m.n), shift), m.label);
      }

      const shiftNow = sinceSample / cfg.sampleMs;
      const now = performance.now(), fdt = lastDraw ? Math.min(0.1, (now - lastDraw) / 1000) : 0;
      lastDraw = now;
      if (!all) {
        drawVolume(shiftNow);
        drawLevel(res, res && res.ath ? C.up : C.down, res && res.ath ? "ATH" : "R");
        drawLevel(sup, C.axis, "S");
        if (showMA) drawMA(shiftNow);
      }

      if (mode === "candles") {
        all ? drawCandlesAll() : drawCandles();
        if (!all) drawTags(shiftNow, fdt);
        ctx.restore();
      } else {
      // Soft area under the line
      const grad = ctx.createLinearGradient(0, pad.t, 0, h - pad.b);
      grad.addColorStop(0, C.line + "26");
      grad.addColorStop(1, C.line + "00");
      ctx.beginPath();
      ctx.moveTo(pts[0].x, h - pad.b);
      for (const p of pts) ctx.lineTo(p.x, p.y);
      ctx.lineTo(pts[pts.length - 1].x, h - pad.b);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();

      // Neon line: a wide blurred glow, then a bright thin core
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.shadowColor = C.line;
      const boost = Math.max(0, glowT) / 1.2;
      ctx.shadowBlur = 16 + boost * 22;
      ctx.strokeStyle = boost > 0 ? C.line : C.line + "aa";
      ctx.lineWidth = 3 + boost * 2.5;
      strokeLine();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = C.core;
      ctx.lineWidth = 1.4;
      strokeLine();
      if (!all) drawTags(shiftNow, fdt);
      ctx.restore();
      }

      // Live price guide + dot
      const t = api.tip();
      ctx.strokeStyle = C.line + "40";
      ctx.setLineDash([3, 4]);
      ctx.beginPath(); ctx.moveTo(pad.l, t.y); ctx.lineTo(w - pad.r, t.y); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = C.core;
      ctx.shadowColor = C.line;
      ctx.shadowBlur = 12;
      ctx.beginPath(); ctx.arc(t.x, t.y, 3.5, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;

      // Price tag pill: green, flashes red on a sell
      const label = TC.format.axis(TC.market.px(history[n - 1]));
      ctx.font = '600 11px "IBM Plex Mono", monospace';
      const lw = ctx.measureText(label).width + 14;
      const ly = Math.max(pad.t, Math.min(h - pad.b, t.y));
      const tagColor = tagFlash.t > 0 && tagFlash.kind === "down" ? C.down : C.up;
      ctx.fillStyle = tagColor;
      if (tagFlash.t > 0) { ctx.shadowColor = tagColor; ctx.shadowBlur = 14; }
      const x0 = w - pad.r + 2;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x0, ly - 11, lw, 22, 5); else ctx.rect(x0, ly - 11, lw, 22);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = C.ink;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(label, x0 + 7, ly);
    },
  };
  return api;
})();
