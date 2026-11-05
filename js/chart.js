// The price chart. Owns its canvas, its history buffer and its y-scale.
// Exposes geometry so effects can draw on top of the line:
//   TC.chart.points()    screen points of the line this frame [{x, y}], oldest first
//   TC.chart.tip()       the newest point
//   TC.chart.bounds()    plot rectangle {l, r, t, b, w, h}
//   TC.chart.flash(kind) flashes the price tag ("up" or "down")
//   TC.chart.zoomBy(f)   scale the visible time window (f < 1 zooms in); saved in settings.zoom
window.TC = window.TC || {};

TC.chart = (() => {
  const cfg = TC.config;
  let canvas, ctx, w = 0, h = 0, dpr = 1;
  let history = [];      // close of each sample
  let hiArr = [], loArr = []; // high/low seen during each sample, for candle wicks
  let mode = "line";     // "line" | "candles"
  let pts = [];
  let sinceSample = 0;
  let yMax = 10;            // animated top of the y-axis
  let tagFlash = { kind: "up", t: 0 };
  const pad = { l: 10, r: 66, t: 18, b: 26 };
  const MAX = cfg.historyMax || cfg.historyPoints;
  let span = cfg.historyPoints; // visible samples (zoom level)
  const clampSpan = (v) => Math.round(Math.max(cfg.zoomMin || 40, Math.min(MAX, v)));
  // First history index that is (partly) on screen
  const visStart = () => Math.max(0, history.length - span - 1);
  const C = {};

  function readColors() {
    const cs = getComputedStyle(document.documentElement);
    for (const k of ["line", "core", "rule", "muted", "axis", "up", "down", "ink"]) {
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
  const yOf = (v) => pad.t + plotH() * (1 - v / yMax);
  const xOf = (i, shift) => pad.l + plotW() * ((i - (history.length - span) - shift) / (span - 1));

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

  const api = {
    init(el) {
      const saved = TC.state && TC.state.data.settings.zoom;
      if (saved) span = clampSpan(saved);
      canvas = el;
      ctx = canvas.getContext("2d");
      readColors();
      resize();
      window.addEventListener("resize", resize);
      api.clear();
    },

    clear() {
      api.fill(0);
      yMax = 10;
    },

    // Restore the visible line to a flat level (used after loading a save).
    fill(value) {
      history = new Array(MAX).fill(value);
      hiArr = history.slice(); loArr = history.slice();
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
    },

    snapshot() { return history.slice(); },
    restore(arr) {
      if (!Array.isArray(arr) || !arr.length) return;
      history = arr.slice(-MAX);
      hiArr = history.slice(); loArr = history.slice();
    },

    mode: () => mode,
    setMode(m) { mode = m === "candles" ? "candles" : "line"; },

    span: () => span,
    zoomBy(f) {
      const next = clampSpan(span * f);
      if (next === span) return;
      span = next;
      if (TC.state) TC.state.data.settings.zoom = span;
    },

    update(dt, live) {
      sinceSample += dt * 1000;
      while (sinceSample >= cfg.sampleMs) {
        sinceSample -= cfg.sampleMs;
        history.push(live); hiArr.push(live); loArr.push(live);
        if (history.length > MAX) { history.shift(); hiArr.shift(); loArr.shift(); }
      }
      const L = history.length - 1;
      history[L] = live;
      if (live > hiArr[L]) hiArr[L] = live;
      if (live < loArr[L]) loArr[L] = live;

      // Ease the y-axis toward headroom above the visible peak.
      const vs = visStart();
      const peak = Math.max(...(mode === "candles" ? hiArr : history).slice(vs), 1);
      const target = Math.max(10, peak * 1.25);
      const k = target > yMax ? 8 : 1.5; // grow fast, shrink slowly
      yMax += (target - yMax) * Math.min(1, k * dt);

      if (tagFlash.t > 0) tagFlash.t -= dt;

      // Screen points for this frame (smooth scroll between samples; newest point pinned to "now").
      const shift = sinceSample / cfg.sampleMs;
      const n = history.length;
      pts = [];
      for (let i = vs; i < n; i++) pts.push({ x: xOf(i, i === n - 1 ? 0 : shift), y: yOf(history[i]) });
    },

    points: () => pts,
    tip: () => pts[pts.length - 1] || { x: w - pad.r, y: h - pad.b },
    // Inset the plot (e.g. when the chart sits behind the header and dock)
    setPad(p) { Object.assign(pad, p); },
    bounds: () => ({ l: pad.l, r: w - pad.r, t: pad.t, b: h - pad.b, w, h }),
    flash(kind) { tagFlash = { kind, t: 0.35 }; },

    draw() {
      ctx.clearRect(0, 0, w, h);
      if (!pts.length) return;
      const n = history.length;

      // Grid + y labels
      const step = niceStep(yMax, 5);
      ctx.font = '500 10px "IBM Plex Mono", monospace';
      ctx.textBaseline = "middle";
      ctx.textAlign = "left";
      for (let v = 0; v <= yMax; v += step) {
        const y = Math.round(yOf(v)) + 0.5;
        ctx.strokeStyle = C.rule;
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke();
        ctx.fillStyle = C.axis;
        ctx.fillText(TC.format.axis(TC.market.px(v)), w - pad.r + 8, y);
      }

      // Time labels
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      const secs = (span * cfg.sampleMs) / 1000;
      // About 4 labels whatever the zoom
      const every = [2, 5, 10, 15, 30, 60, 90, 120].find((e) => secs / e <= 4.5) || 120;
      const fmt = (s) => s === 0 ? "now" : s < 60 ? `-${s}s` : s % 60 ? `-${Math.floor(s / 60)}m${s % 60}s` : `-${s / 60}m`;
      for (let s = 0; s <= secs + 0.01; s += every) {
        const x = pad.l + plotW() * (1 - s / secs);
        ctx.fillStyle = C.muted;
        ctx.fillText(fmt(s), x, h - pad.b + 8);
      }

      ctx.save();
      ctx.beginPath();
      ctx.rect(pad.l, 0, plotW(), h - pad.b);
      ctx.clip();

      if (mode === "candles") {
        drawCandles();
        ctx.restore();
      } else {
      // Soft area under the line
      const grad = ctx.createLinearGradient(0, pad.t, 0, h - pad.b);
      grad.addColorStop(0, C.line + "26");
      grad.addColorStop(1, C.line + "00");
      ctx.beginPath();
      ctx.moveTo(pts[0].x, yOf(0));
      for (const p of pts) ctx.lineTo(p.x, p.y);
      ctx.lineTo(pts[pts.length - 1].x, yOf(0));
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();

      // Neon line: a wide blurred glow, then a bright thin core
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.shadowColor = C.line;
      ctx.shadowBlur = 16;
      ctx.strokeStyle = C.line + "aa";
      ctx.lineWidth = 3;
      strokeLine();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = C.core;
      ctx.lineWidth = 1.4;
      strokeLine();
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
