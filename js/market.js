// Game rules: what things cost, how price moves, how price turns into cash.
//
// The economy loop:
//   taps + buyers  -> push the PRICE up
//   NEW HIGHS      -> every $1 the price climbs above its record sells a sliver of your stake -> CASH
//                     (dips and recoveries pay nothing until the record is broken again)
//   CASH           -> buys buyers and upgrades, which push the price up faster
//   SELL           -> instant cash, but the price drops 15% below your record and there's a cooldown
window.TC = window.TC || {};

TC.market = (() => {
  const cfg = TC.config;
  const st = () => TC.state.data;
  let wobble = 0;      // mean-reverting noise so the line breathes between buys
  let dipTimer = 2;    // seconds until profit-takers nudge the price (cosmetic red dip)
  let earnedAcc = 0;   // cash earned since the last step, for the smoothed rate
  // Buyers fill orders one at a time instead of all at once. Each buyer type saves up its
  // share of the price and fills it as a single order on its own staggered timer.
  const orderBook = {}; // id -> { pending, timer }
  const MIN_ORDER_GAP = 0.3; // seconds between any two buyer orders
  let lastOrderAt = -1;
  function orderGap(n) {
    // More of a buyer means it trades more often (but each order stays readable)
    const base = Math.max(0.6, 2.6 / Math.sqrt(n));
    return base * (0.55 + Math.random() * 0.9);
  }
  let earnRate = 0;    // smoothed cash per second, for the UI

  function upgradeProduct(kind) {
    if (TC.debuffs && TC.debuffs.active("poach")) return 1; // exec poached: upgrades off
    return cfg.upgrades.reduce((m, u) => (st().upgrades[u.id] && u.kind === kind ? m * u.value : m), 1);
  }

  const api = {
    generatorCost(g) {
      return Math.ceil(g.cost * Math.pow(cfg.costGrowth, st().owned[g.id] || 0));
    },

    // Permanent multiplier from founder points and achievements, applied to taps, buyers and dividends.
    metaMult() {
      const s = st();
      return (1 + cfg.prestige.perPoint * s.prestige.points) *
        (1 + cfg.achievementBonus * Object.keys(s.achievements).length);
    },

    // Multiplier on every buyer from upgrades.
    genMult: () => upgradeProduct("gen"),

    // Price added per second by all buyers.
    perSecond() {
      const raw = cfg.generators.reduce((sum, g) => sum + g.rate * (st().owned[g.id] || 0) * (TC.seasons ? TC.seasons.genMult(g.id) : 1) * (TC.debuffs ? TC.debuffs.genMult(g.id) : 1), 0);
      return raw * upgradeProduct("gen") * api.metaMult() * (TC.hype ? TC.hype.buyerMult() : 1) * (TC.seasons ? TC.seasons.buyerMult() : 1) * (TC.debuffs ? TC.debuffs.buyerMult() : 1) * (TC.news && TC.news.buyerMult ? TC.news.buyerMult() : 1);
    },

    // Price added per tap.
    perClick() {
      const pct = TC.debuffs && TC.debuffs.active("poach") ? 0 : cfg.upgrades.reduce((p, u) => (st().upgrades[u.id] && u.kind === "cpsPct" ? p + u.value : p), 0);
      return cfg.baseClick * upgradeProduct("mult") * api.metaMult() * (TC.hype ? TC.hype.tapMult() : 1) * (TC.debuffs ? TC.debuffs.tapMult() : 1) + api.perSecond() * pct;
    },

    // Cash paid per $1 the price climbs above its record.
    // Cash paid per $1 the price climbs above its record: a slice of your stake.
    cashPerDollar() {
      return cfg.stake.cashOut * st().shares * upgradeProduct("yield");
    },
    stakePct: () => st().shares / cfg.sharesOutstanding,
    stakeValue: (price) => st().shares * (price ?? api.quote()),
    // Buybacks are priced at your record high (no discount for buying in a dip) outside a bear market, plus a fee,
    // plus a premium that grows 10% per buyback and fades over a minute.
    // In a bear market buybacks are priced at the current (beaten-down) price instead of the record: buy low.
    buybackBear: () => !!(TC.seasons && TC.seasons.current() === "bear"),
    buybackPrice: () => (api.buybackBear() ? st().basePrice : Math.max(st().basePrice, st().bestPrice)),
    buybackDiscount: () => (api.buybackBear() && st().bestPrice > 0 ? Math.max(0, 1 - st().basePrice / st().bestPrice) : 0),
    buybackCost: () => cfg.stake.buyback * api.buybackPrice() * (1 + cfg.stake.fee + api.buybackHeat()),
    buybackHeat: () => Math.max(0, (st().buybackHeat || 0) - (st().clock - (st().buybackAt || 0)) * cfg.stake.heatFade),
    canBuyback: () => st().listed && st().basePrice > 0 && st().shares + cfg.stake.buyback <= cfg.stake.max && st().cash >= api.buybackCost(),
    // Discounted buyback that rides along with BUY THE DIP: at the current (dipped) price, no fee.
    // Only offered once per event, so it can't be farmed. Buys what your cash covers, up to dipShares.
    dipStakeShares() {
      const s = st();
      if (!s.basePrice) return 0;
      return Math.max(0, Math.min(cfg.stake.dipShares, Math.floor(s.cash / s.basePrice), cfg.stake.max - s.shares));
    },
    dipBuyback() {
      const s = st(), n = api.dipStakeShares();
      if (n < 1) return 0;
      const cost = n * s.basePrice;
      s.cash -= cost;
      s.shares += n;
      TC.events.emit("dipStake", { shares: n, cost, discount: 1 - s.basePrice / s.bestPrice });
      return n;
    },
    buyback() {
      if (!api.canBuyback()) return false;
      const s = st(), cost = api.buybackCost();
      s.cash -= cost;
      s.shares += cfg.stake.buyback;
      s.buybackHeat = api.buybackHeat() + cfg.stake.heat;
      s.buybackAt = s.clock;
      // Insider buying: the founder buying in a bear calms the market (+3%, bear bleed paused 10s)
      const insider = api.buybackBear();
      if (insider) { api.shift(cfg.stake.insiderBump, "insider"); TC.seasons.calm(cfg.stake.insiderCalm); }
      TC.events.emit("buyback", { cost, shares: cfg.stake.buyback, insider });
      return true;
    },

    // Smoothed cash earned per second (0 while the price is below its record).
    income: () => earnRate,

    // Headline number: share price x shares outstanding.
    marketCap: (price) => (price ?? api.quote()) * cfg.sharesOutstanding,

    // Cash a sell would pay right now, and the price after it.
    // Peak sells are a bigger offering: hot demand lets you dump bonus x 2% of your shares at full price.
    // Off-peak sells dump 3% at half price. Either way shares never sell above the price,
    // so selling and buying back can't print money.
    sellFrac() {
      const b = api.sellBonus();
      return b > 1 ? cfg.sell.peakPct * b : cfg.sell.stakePct;
    },
    sellValue() {
      const b = api.sellBonus();
      return st().shares * api.sellFrac() * st().basePrice * (b > 1 ? 1 : b);
    },
    // Peak-sell multiplier during market events (see trade.js)
    // 0.5x off-peak, 2-4x at an event peak
    sellBonus() {
      const b = TC.trade ? TC.trade.peakBonus() : 1;
      return b > 1 ? b : cfg.sell.offPeak;
    },
    // Selling while an event has the price well below its high = selling into a crash
    sellingIntoCrash: () => !!(TC.trade && TC.trade.inCrash()),
    sellDrop: () => (api.sellingIntoCrash() ? cfg.sell.crashDrop : cfg.sell.drop),
    // Selling again this soon risks an SEC fine (cfg.sell.fineChance)
    fineRisk: () => st().clock - st().lastSellAt < cfg.sell.fineWindow,
    sellCooldown() { return Math.max(0, st().sellReadyAt - st().clock); },
    canSell() { return st().listed && st().basePrice >= cfg.sell.minPrice && api.sellCooldown() === 0; },

    // Apply buying pressure to the price.
    push(amount) {
      const s = st();
      const before = s.basePrice;
      const record = s.bestPrice;
      s.basePrice += amount;
      if (s.basePrice > record) {
        // New high: you get paid for the part above the old record
        const rise = s.basePrice - record;
        const earned = rise * api.cashPerDollar();
        s.cash += earned;
        // ...paid by selling that slice of your stake (never below the floor)
        if (s.shares > cfg.stake.floor) {
          const sold = cfg.stake.cashOut * s.shares * rise / Math.max(s.basePrice, 10);
          s.shares = Math.max(cfg.stake.floor, s.shares - sold);
        }
        earnedAcc += earned;
        s.bestPrice = s.basePrice;
      }
      if (s.basePrice > s.lifetime.bestPrice) s.lifetime.bestPrice = s.basePrice;
      // Milestones the first time the price crosses each power of ten ($10, $100, $1K ...)
      const pow = Math.floor(Math.log10(s.basePrice));
      if (before > 0 && pow > Math.floor(Math.log10(before)) && Math.pow(10, pow) > s.bestMilestone) {
        s.bestMilestone = Math.pow(10, pow);
        TC.events.emit("milestone", { price: s.bestMilestone });
      }
    },

    buy(x = null, y = null) {
      if (!st().listed) return;
      // Bear-market overtrading: halts swallow the tap, sell walls flip it into a drop
      const ot = TC.overtrade ? TC.overtrade.tap() : "ok";
      if (ot === "halt") { TC.events.emit("halted", { x, y }); return; }
      const amount = api.perClick();
      if (ot === "wall") {
        st().basePrice = Math.max(0.01, st().basePrice - amount);
        TC.events.emit("sellWall", { amount, x, y });
        return;
      }
      api.push(amount);
      if (TC.overtrade) TC.overtrade.landed(amount);
      st().orders++;
      st().lifetime.taps++;
      wobble = Math.abs(wobble) * 0.5; // a buy kicks noise upward
      TC.events.emit("buy", { amount, x, y, manual: true });
    },

    // Secondary offering: cash now, price drops by cfg.sell.drop.
    sell() {
      if (!api.canSell()) return false;
      const s = st();
      const bonus = api.sellBonus();
      const cash = api.sellValue();
      const before = api.quote();
      const crash = api.sellingIntoCrash();
      const fined = api.fineRisk() && Math.random() < cfg.sell.fineChance;
      s.cash += cash;
      s.shares *= 1 - api.sellFrac();
      s.basePrice *= 1 - api.sellDrop();
      s.lastSellAt = s.clock;
      s.sells++;
      s.lifetime.sells++;
      s.sellReadyAt = s.clock + cfg.sell.cooldown;
      wobble = -cfg.wobble;
      dipTimer = 4; // let your own sell own the moment
      TC.events.emit("sell", { amount: before - api.quote(), cash, manual: true, bonus, crash, atTop: before >= s.bestPrice * 0.95 });
      if (crash) TC.events.emit("crashSell", {});
      if (fined) {
        const fine = s.cash * cfg.sell.fine;
        s.cash -= fine;
        TC.events.emit("fine", { amount: fine });
      }
      return true;
    },

    // Move the real price by a fraction (+0.2 = up 20%). Used by market events.
    shift(frac, source) {
      const s = st();
      if (!frac || s.basePrice <= 0) return;
      const before = api.quote();
      if (frac > 0) api.push(s.basePrice * frac);
      else s.basePrice *= 1 + Math.max(frac, -0.95);
      const amount = Math.abs(api.quote() - before);
      TC.events.emit(frac > 0 ? "rally" : "sell", { amount, manual: false, source });
    },

    buyGenerator(id) {
      const g = cfg.generators.find((x) => x.id === id);
      const cost = api.generatorCost(g);
      if (st().cash < cost) return false;
      st().cash -= cost;
      st().owned[id] = (st().owned[id] || 0) + 1;
      TC.events.emit("purchase", { kind: "generator", id, cost });
      return true;
    },

    // Cost of the next n of a buyer, and how many you can afford right now
    generatorCostN(g, n) {
      const k = st().owned[g.id] || 0, r = cfg.costGrowth;
      let total = 0;
      for (let i = 0; i < n; i++) total += Math.ceil(g.cost * Math.pow(r, k + i));
      return total;
    },
    generatorMax(g) {
      let n = 0, total = 0;
      const k = st().owned[g.id] || 0;
      while (n < 1000) {
        const c = Math.ceil(g.cost * Math.pow(cfg.costGrowth, k + n));
        if (total + c > st().cash) break;
        total += c; n++;
      }
      return n;
    },
    buyGenerators(id, n) {
      let bought = 0;
      for (let i = 0; i < n; i++) { if (!api.buyGenerator(id)) break; bought++; }
      return bought;
    },

    buyUpgrade(id) {
      const u = cfg.upgrades.find((x) => x.id === id);
      if (st().upgrades[id] || st().cash < u.cost) return false;
      st().cash -= u.cost;
      st().upgrades[id] = true;
      TC.events.emit("purchase", { kind: "upgrade", id, cost: u.cost });
      return true;
    },

    // Advance the market by dt seconds.
    step(dt) {
      const s = st();
      if (!s.listed) return;
      s.clock += dt;

      const m = upgradeProduct("gen") * api.metaMult() * (TC.hype ? TC.hype.buyerMult() : 1) * (TC.seasons ? TC.seasons.buyerMult() : 1) * (TC.debuffs ? TC.debuffs.buyerMult() : 1) * (TC.news && TC.news.buyerMult ? TC.news.buyerMult() : 1);
      for (const g of cfg.generators) {
        const n = s.owned[g.id] || 0;
        let o = orderBook[g.id];
        if (!n) { if (o) o.pending = 0; continue; }
        if (!o) o = orderBook[g.id] = { pending: 0, timer: Math.random() * orderGap(n) };
        o.pending += g.rate * n * m * (TC.seasons ? TC.seasons.genMult(g.id) : 1) * (TC.debuffs ? TC.debuffs.genMult(g.id) : 1) * dt;
        o.timer -= dt;
        if (o.timer <= 0) {
          // Keep orders from different buyers apart so each one reads on its own
          const since = s.clock - lastOrderAt;
          if (since >= 0 && since < MIN_ORDER_GAP) { o.timer = MIN_ORDER_GAP - since + Math.random() * 0.15; continue; }
          lastOrderAt = s.clock;
          o.timer = orderGap(n);
          const amount = o.pending;
          o.pending = 0;
          api.push(amount);
          TC.events.emit("order", { amount, id: g.id, name: g.name });
        }
      }
      if (dt > 0) {
        const k = Math.min(1, dt / 1.5);
        earnRate += (earnedAcc / dt - earnRate) * k;
        earnedAcc = 0;
      }

      wobble += (Math.random() - 0.5) * cfg.wobble * 0.6 * Math.min(dt * 10, 1);
      wobble *= 0.97;
      wobble = Math.max(-cfg.wobble, Math.min(cfg.wobble, wobble));

      // Profit-takers: a short red dip now and then. Moves the shown quote only.
      dipTimer -= dt;
      if (dipTimer <= 0 && s.basePrice > 3 && !(TC.news && TC.news.active())) {
        dipTimer = 2 + Math.random() * 4;
        const before = api.quote();
        wobble = -cfg.wobble * (0.6 + Math.random() * 0.4);
        const amount = before - api.quote();
        if (amount > 0) TC.events.emit("sell", { amount, manual: false });
      }
    },

    // The price shown on the tape and chart: true price plus noise.
    quote() {
      return st().basePrice * (1 + wobble);
    },
  };
  return api;
})();
