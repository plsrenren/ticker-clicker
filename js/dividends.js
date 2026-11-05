// Dividends: owned "dividend" upgrades pay out on a timer. Each payout hands you cash and the
// price drops by the same share of its value (like a real ex-dividend drop), so it turns
// market cap into steady cash. Switch it off from the desk when you're chasing a new record.
//   Quarterly Dividend   every 30s: price -1%, pays 0.8x what that $ of growth would have earned (no shares sold)
//   Dividend Aristocrat  adds another 1.5% per payout
// Pays nothing below cfg.sell.minPrice. Setting lives in state.dividendsOn (run field).
window.TC = window.TC || {};

TC.dividends = (() => {
  const cfg = TC.config;
  const st = () => TC.state.data;
  const $ = (id) => document.getElementById(id);
  const EVERY = 30;   // seconds between payouts
  const CASH_X = 0.8; // cash per $ of price paid out, relative to cash from new highs (below 1: a real tradeoff)
  let timer = EVERY;
  let lastKey = "";

  const rate = () => cfg.upgrades.reduce((r, u) => (u.kind === "dividend" && st().upgrades[u.id] ? r + u.value : r), 0);
  const on = () => st().dividendsOn !== false;

  function payout() {
    const s = st(), r = rate();
    if (!r || s.basePrice < cfg.sell.minPrice) return;
    const drop = s.basePrice * r;
    const cash = drop * TC.market.cashPerDollar() * CASH_X;
    if (TC.market.has("drip")) {
      // Reinvest: buy stake at the current price, no fee, up to the 25% cap (leftover pays as cash)
      const shares = Math.min(cash / s.basePrice, Math.max(0, cfg.stake.max - s.shares));
      s.shares += shares;
      s.cash += cash - shares * s.basePrice;
      TC.market.shift(-r, "dividend");
      TC.events.emit("dividend", { cash: 0, shares, pct: r });
      return;
    }
    s.cash += cash;
    TC.market.shift(-r, "dividend");
    TC.events.emit("dividend", { cash, pct: r });
  }

  function render() {
    const bar = $("divBar");
    if (!bar) return;
    const r = rate();
    const key = r ? (on() ? "on" : "off") + Math.ceil(timer) + r : "";
    if (key === lastKey) return;
    lastKey = key;
    bar.hidden = !r;
    if (!r) return;
    bar.dataset.on = on() ? "1" : "0";
    bar.setAttribute("aria-pressed", String(on()));
    $("divText").textContent = on()
      ? "Dividends ON · −" + +(r * 100).toFixed(1) + "% price for cash in " + Math.ceil(timer) + "s"
      : "Dividends OFF · tap to turn on";
  }

  return {
    rate,
    on,
    init() {
      $("divBar").addEventListener("click", () => {
        st().dividendsOn = !on();
        if (on()) timer = EVERY;
        lastKey = "";
        render();
      });
      TC.events.on("reset", () => { timer = EVERY; lastKey = ""; render(); });
    },
    update(dt) {
      if (st().listed && rate() && on()) {
        timer -= dt;
        if (timer <= 0) { timer = EVERY; payout(); }
      }
      render();
    },
  };
})();
