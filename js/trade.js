// Event trading: timing plays during market events.
//   PEAK SELL  - sell near the high of an event that pushed the price up: 2x cash (within 10%)
//                or 3x (within 2%).
//   BUY THE DIP - when an event knocks the price 12% below its high, a button appears once per
//                event. Tapping it fires a stack of 12 big buy orders that bounce the price back.
// Both windows stay open for a few seconds after the event ends.
window.TC = window.TC || {};

TC.trade = (() => {
  const st = () => TC.state.data;
  const $ = (id) => document.getElementById(id);
  const GRACE = 2.5;        // seconds the windows stay open after an event ends
  const PEAK_MIN_RISE = 1.05; // the event must have pushed the price 5% above where it started
  const DIP = 0.88;         // dip button shows at or below 88% of the event high
  const STACK_ORDERS = 12;

  let ev = null;    // { ref, start, high, grace, stackUsed }
  let stack = null; // { left, each, timer, x, y }

  const api = {
    init() {
      const btn = $("dipBtn");
      // pointerdown so it doesn't also count as a tap on the chart underneath
      btn.addEventListener("pointerdown", (e) => {
        e.stopPropagation();
        e.preventDefault();
        api.stackBuy();
      });
      TC.events.on("reset", () => { ev = null; stack = null; });
    },

    // Cash multiplier a sell would get right now.
    peakBonus() {
      if (!ev || ev.high < ev.start * PEAK_MIN_RISE) return 1;
      const r = st().basePrice / ev.high;
      const base = r >= 0.98 ? 3 : r >= 0.9 ? 2 : 1;
      return base > 1 ? base + (TC.seasons ? TC.seasons.peakExtra() : 0) : 1;
    },

    // How far below the event high the price is (0.2 = 20% down).
    dipDepth() { return ev ? 1 - st().basePrice / ev.high : 0; },
    dipReady() { return !!ev && !ev.stackUsed && st().basePrice <= ev.high * (TC.seasons ? TC.seasons.dipLine() : DIP); },

    stackBuy() {
      if (!api.dipReady()) return false;
      ev.stackUsed = true;
      const s = st();
      // Worth about 30 taps, kept between a 12% and 25% bounce
      const total = Math.max(Math.min(TC.market.perClick() * 30, s.basePrice * 0.25), s.basePrice * 0.12) * (TC.seasons ? TC.seasons.stackMult() : 1);
      const wrap = $("chartWrap").getBoundingClientRect();
      const b = $("dipBtn").getBoundingClientRect();
      stack = {
        left: STACK_ORDERS, each: total / STACK_ORDERS, timer: 0,
        x: b.left + b.width / 2 - wrap.left, y: b.top + b.height / 2 - wrap.top,
      };
      TC.events.emit("stackBuy", { total });
      return true;
    },

    update(dt) {
      const s = st();
      if (!s.listed) return;
      const active = TC.news.active();
      if (active) {
        if (!ev || ev.ref !== active) ev = { ref: active, start: s.basePrice, high: s.basePrice, grace: GRACE, stackUsed: false };
        if (s.basePrice > ev.high) ev.high = s.basePrice;
      } else if (ev && (ev.grace -= dt) <= 0) {
        ev = null;
      }

      // Fire the stacked orders one after another
      if (stack) {
        stack.timer -= dt;
        while (stack.timer <= 0 && stack.left > 0) {
          stack.timer += 0.07;
          stack.left--;
          TC.market.push(stack.each);
          s.orders++;
          const jx = (Math.random() - 0.5) * 60;
          TC.events.emit("buy", { amount: stack.each, x: stack.x + jx, y: stack.y, manual: false, stack: true });
        }
        if (stack.left <= 0) stack = null;
      }
    },
  };
  return api;
})();
