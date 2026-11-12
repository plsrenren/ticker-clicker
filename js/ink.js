// Sketchbook drawing helpers for the canvases (chart.js, effects.js): wobbly ink lines and shapes.
// The wobble "boils" like the CSS outlines: it is stable within a frame and picks a new shape
// 3 times a second (same .66s, 3-step rhythm as the button outlines). Only used when TC.sketch is on.
window.TC = window.TC || {};

TC.ink = (() => {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const frame = () => (reduced ? 0 : Math.floor(performance.now() / 220) % 3);
  // Stable pseudo-random number in [-1, 1] for (i, salt) within the current boil frame
  function jit(i, salt = 0) {
    const s = Math.sin((i + 1) * 12.9898 + (salt + frame() * 7.31) * 78.233) * 43758.5453;
    return (s - Math.floor(s)) * 2 - 1;
  }
  // Points along a straight line, each nudged by up to `amp` px (one point every ~`seg` px)
  function linePts(x1, y1, x2, y2, amp, salt, seg = 36) {
    const n = Math.max(1, Math.round(Math.hypot(x2 - x1, y2 - y1) / seg));
    const out = [];
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      out.push([x1 + (x2 - x1) * t + jit(k * 2, salt) * amp, y1 + (y2 - y1) * t + jit(k * 2 + 1, salt) * amp]);
    }
    return out;
  }
  const api = {
    jit,
    frame,
    pen: "#2b2224",
    paper: "#f4f1e6",
    // Add a wobbly straight line to the current path
    line(g, x1, y1, x2, y2, amp = 1, salt = 0) {
      linePts(x1, y1, x2, y2, amp, salt).forEach(([x, y], k) => (k ? g.lineTo(x, y) : g.moveTo(x, y)));
    },
    // New path: a hand-drawn rectangle (corners overshoot a touch, like a quick pen sketch)
    rect(g, x, y, w, h, amp = 1.2, salt = 0) {
      const o = amp * 0.8;
      g.beginPath();
      const sides = [
        linePts(x - o, y, x + w + o * jit(1, salt), y, amp, salt + 1),
        linePts(x + w, y - o, x + w, y + h + o * jit(2, salt), amp, salt + 2),
        linePts(x + w + o, y + h, x - o * jit(3, salt), y + h, amp, salt + 3),
        linePts(x, y + h + o, x, y - o * jit(4, salt), amp, salt + 4),
      ];
      sides.forEach((s, i) => s.forEach(([px, py], k) => (i === 0 && k === 0 ? g.moveTo(px, py) : g.lineTo(px, py))));
      g.closePath();
    },
    // New path: a five-point doodle star
    star(g, x, y, r, rot = 0, salt = 0) {
      g.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = rot - Math.PI / 2 + (i * Math.PI) / 5;
        const rr = (i % 2 ? r * 0.45 : r) * (1 + jit(i, salt) * 0.08);
        i ? g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr) : g.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
      }
      g.closePath();
    },
    // Text with a thick ink outline under the fill (like the market cap in Sketchbook)
    text(g, text, x, y, fill, size) {
      g.lineJoin = "round";
      g.miterLimit = 2;
      g.lineWidth = Math.max(3, size * 0.2);
      g.strokeStyle = api.pen;
      g.strokeText(text, x, y + size * 0.05);
      g.strokeText(text, x, y);
      g.fillStyle = fill;
      g.fillText(text, x, y);
    },
    // Diagonal pencil hatching inside the current clip
    hatch(g, x, y, w, h, gap = 9, color = "#00000022", width = 1.2, salt = 0) {
      g.strokeStyle = color;
      g.lineWidth = width;
      g.beginPath();
      for (let d = -h; d < w; d += gap) {
        const j = jit(d, salt) * 1.5;
        g.moveTo(x + d + j, y + h);
        g.lineTo(x + d + h + j, y);
      }
      g.stroke();
    },
    // A paper note: wobbly paper rectangle with an ink edge and a strip of tape
    note(g, x, y, w, h, { fill = api.paper, rot = -0.035, tape = true, salt = 0 } = {}) {
      g.save();
      g.translate(x + w / 2, y + h / 2);
      g.rotate(rot);
      g.fillStyle = "#00000033";
      api.rect(g, -w / 2 + 1.5, -h / 2 + 2.5, w, h, 1, salt);
      g.fill();
      g.fillStyle = fill;
      api.rect(g, -w / 2, -h / 2, w, h, 1, salt);
      g.fill();
      g.strokeStyle = api.pen;
      g.lineWidth = 1.8;
      g.stroke();
      if (tape) {
        g.rotate(-0.25);
        g.fillStyle = "#fffaf0a6";
        g.fillRect(-w / 2 - 6, -h / 2 - 4, 18, 8);
      }
      g.restore();
    },
  };
  return api;
})();
