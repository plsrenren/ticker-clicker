// Game balance and content. Tweak numbers here without touching game logic.
window.TC = window.TC || {};

TC.config = {
  baseClick: 0.25,       // dollars added to the price per buy, before upgrades (slow opening; tuned with the bot sim)
  costGrowth: 1.15,      // each extra buyer of a kind costs 15% more
  sampleMs: 250,         // how often the chart records a point
  historyPoints: 240,    // default visible window (240 x 250ms = 60s)
  historyMax: 1440,      // samples kept for zooming out (1440 x 250ms = 6 minutes)
  zoomMin: 40,           // most zoomed in: 40 samples = 10s
  wobble: 0.02,          // max ambient noise as a fraction of price, for a living line
  saveMs: 5000,

  // Economy: cash comes from growth. Every $1 the share price climbs above its record pays you cashPerDollar.
  // Dips pay nothing until the price is back above the record.
  // Founder stake: you own part of the company. Cash comes from selling a little of it.
  //   NEW HIGHS  every $1 the price climbs above its record pays cashOut x your shares, and you sell
  //              the matching shares (about cashOut x shares x rise / price), so your stake shrinks
  //   SELL       sells sell.stakePct of your shares at once
  //   BUYBACK    spend cash to buy 0.05% of the company back at the current price (+ fee)
  //   Dividends pay cash without selling shares. Going private resets the stake.
  ipoPrice: 0.1,             // share price you list at (a penny stock)
  sharesOutstanding: 1000000, // market cap = share price x this (the headline number)
  stake: {
    start: 100000,       // 10% of the company at IPO
    cashOut: 0.05,       // cash per $1 of new high = this x your shares (5,000 at a 10% stake)
    floor: 20000,        // new highs stop selling shares below 2%; they still pay
    buyback: 500,        // shares per buyback (0.05% of the company; small enough to afford in a bear)
    fee: 0.03,           // buybacks cost 3% over your record price...
    heat: 0.01,          // ...plus 1% more per recent buyback (5 buybacks = the old +5% per 0.25%)...
    heatFade: 0.05 / 60, // ...fading 5% per minute
    max: 250000,         // can't own more than 25%
    insiderBump: 0.03,   // bear market: a buyback is priced at the current price, bumps it 3% (once per calm window)...
    insiderCalm: 10,     // ...and pauses the bear bleed for 10s
    marginDrop: 0.1,     // Margin Account: a drop this far below the recent high triggers a margin call...
    marginHit: [0.06, 0.1], // ...that dumps the price this much more...
    marginGap: 25,       // ...at most once every 25s
    hostileShares: 10000, // losing a hostile bid sells 1% of the company (at most 20% of your shares) at the bid
    dipShares: 5000,     // BUY THE DIP also buys up to 0.5% of the company at the dip price (no fee), once per event
    econ: 2,             // save version of this economy (older saves get migrated in state.js)
  },
  sell: {
    offPeak: 0.5,        // sells outside an event peak pay half
    fineWindow: 30,      // selling again within this many seconds risks an SEC fine...
    fineChance: 0.65,    // ...this often...
    fine: 0.2,           // ...costing this share of your cash
    crashDrop: 0.3,      // selling into a crash drops the price this much instead of the usual drop
    stakePct: 0.03,      // off-peak sell: 3% of your shares at half price
    peakPct: 0.02,       // peak sell: bonus x 2% of your shares at full price (2x 4%, 3x 6%, 4x 8%)
    drop: 0.15,          // and knocks 15% off the price
    cooldown: 15,        // seconds before you can sell again
    minPrice: 5,         // can't sell a penny stock
  },

  // Going private (js/prestige.js): reset the run for permanent founder points.
  prestige: {
    minPrice: 1000000,   // best price this run needed to go private
    scale: 100000,       // points for a run = floor(sqrt(bestPrice / scale))
    perPoint: 0.1,       // each founder point: +10% taps and buyers, forever
    stakeBase: 0.05,     // points x (your stake / 5%) when you go private
  },
  achievementBonus: 0.02, // each achievement: +2% taps and buyers, forever
  offline: {
    efficiency: 0.5,     // buyers run at half speed while you're away
    maxHours: 8,
    minSeconds: 60,
  },
  candleSamples: 8,      // chart samples per candle (8 x 250ms = 2s candles)
  // Trader overlays on the LIVE chart (js/chart.js), cosmetic only. Lengths are in chart samples (250ms).
  indicators: {
    fast: 20, slow: 60,    // moving averages: 5s and 15s
    crossPct: 0.002,       // MAs must be 0.2% of price apart to count as crossed (stops chop spam)
    crossCooldown: 12,     // seconds between GOLDEN / DEATH CROSS labels
    pivot: 12,             // a swing high/low is the extreme of the 3s either side of it
    breakPct: 0.01,        // price must clear a level by 1% to call a BREAKOUT / BREAKDOWN
    breakCooldown: 8,      // seconds between break labels
    volBarPx: 6,           // volume bars: samples are grouped so each bar is at least this wide
    volHeight: 0.14,       // volume bars: share of the plot height (max 46px)
    volPerPct: 3,          // volume a market event adds per 1% it moves the price (a tap or buyer order is 1)
    tagLife: 2.2,          // seconds a label floats
  },

  // Market events (js/news.js)
  news: {
    firstAfter: 20,      // seconds after reaching minPrice before the first event
    minGap: 30,          // seconds between events
    maxGap: 55,
    minPrice: 5,         // events start at a $5M market cap (small ones: see intensity in news.js)
    intensity: { min: 0.5, perDecade: 0.12, max: 1.1 }, // event size x0.5 at $5M cap, x0.74 at $500M, x0.98 at $50B, x1.1 at $500B+ (sim-tuned: same end time)
    neighborChance: 0.006, // per second under a $5M cap (about once every ~3 min there), once per run
    shortTaps: 25,
    splitTaps: 30,       // taps in 6s to push a stock split through (only offered above a $1,000 share price)
    opexTaps: 0.065,     // options expiry: pressure each tap adds (sellers pull it down 0.2/s, so about 3 taps/s holds it)
    gammaTaps: 14,       // taps in 4s after a short squeeze to set off the gamma squeeze leg
    hackTaps: 22,
    rugTaps: 18,
    whaleTaps: 24,       // taps to absorb a whale dump (6s)         // taps to calm holders during a rug rumor (6s)        // taps to patch a hack before it drains the price (6s)
    breachTaps: 26,      // taps after a data breach to win back 70% of the drop (6s)
    exploitTaps: 20,     // taps to ship a patch before a zero-day goes public (5s)
    splitChance: 0.35,
    luckyChance: 0.025,  // 1 in 40 manual buys is a lucky fill...
    luckyMult: 5,        // ...worth 5x (no special effect: the bigger +$ and jump speak for themselves)   // chance a random event is a split vote while the shown price is $1,000+       // taps needed to beat a short attack (6 seconds)
  },

  // Passive buyers: each owned unit buys `rate` dollars of your stock per second.
  generators: [
    { id: "retail",  name: "Retail Trader",   desc: "Buys the dip. Every dip.",          cost: 15,       rate: 0.1 },
    { id: "bot",     name: "Trading Bot",     desc: "Runs a strategy nobody audited.",   cost: 100,      rate: 1 },
    { id: "influ",   name: "Finfluencer",     desc: "Posts your chart with rockets.",    cost: 1100,     rate: 8 },
    { id: "hedge",   name: "Hedge Fund",      desc: "Two and twenty, all in on you.",    cost: 12000,    rate: 47 },
    { id: "maker",   name: "Market Maker",    desc: "Keeps the order book thick.",       cost: 130000,   rate: 260 },
    { id: "index",   name: "Index Inclusion", desc: "Every pension fund must hold you.", cost: 1400000,  rate: 1400 },
    { id: "sov",     name: "Sovereign Fund",  desc: "A country decides you're the plan.", cost: 20000000, rate: 7800 },
  ],

  // One-time upgrades.
  // kind "mult": multiplies price per tap.   kind "cpsPct": each tap adds a % of buyers' per-second volume.
  // kind "gen": multiplies all buyers.        kind "yield": multiplies cash per $1 of new highs.
  // kind "dividend": pays cash every 30s and drops the price by value (see dividends.js).
  // kind "perk": a rule change, checked by id with TC.market.has(id) where it applies.
  upgrades: [
    { id: "market",  name: "Market Orders",   desc: "Buys fill instantly. 2x per buy.",       cost: 50,      kind: "mult",   value: 2 },
    { id: "div1",    name: "Investor Hype",   desc: "50% more cash from every new high.",       cost: 250,     kind: "yield",  value: 1.5 },
    { id: "divq",    name: "Quarterly Dividend", desc: "Every 30s: pays cash, price drops 1%. Toggle it on the desk.", cost: 500, kind: "dividend", value: 0.01 },
    { id: "agency",  name: "Hype Agency",     desc: "Hype moves come back 25% sooner.",       cost: 600,     kind: "perk",   short: "hype cooldowns −25%" },
    { id: "prfirm",  name: "PR Firm",         desc: "Bad headlines hit 30% softer, and each defending tap saves more.", cost: 1200, kind: "perk", short: "headlines −30%, taps save more" },
    { id: "drip",    name: "Dividend Reinvestment", desc: "Dividends buy back stake instead of paying cash. No fee.", cost: 1500, kind: "perk", short: "dividends → stake, no fee" },
    { id: "margin",  name: "Margin Account",  desc: "Borrowed money buys more: 3x per buy. A 10% drop triggers a margin call dump.", cost: 500, kind: "mult", value: 3 },
    { id: "beat",    name: "Earnings Beat",   desc: "Every buyer buys 2x as much.",           cost: 2500,    kind: "gen",    value: 2 },
    { id: "intel",   name: "Short Intel",     desc: "Short attacks and split votes need 20% fewer taps.", cost: 3000, kind: "perk", short: "tap events −20% taps" },
    { id: "options", name: "Call Options",    desc: "Leverage on every order. 3x per buy.",   cost: 6000,    kind: "mult",   value: 3 },
    { id: "diamond", name: "Diamond Hands Club", desc: "Retail traders and finfluencers keep half their buying in bear markets.", cost: 8000, kind: "perk", short: "bear: retail keeps 50%" },
    { id: "meme",    name: "Meme Status",     desc: "The internet adopts you. Every market event swings 1.5x bigger, good and bad.", cost: 12000, kind: "perk", short: "events swing 1.5x" },
    { id: "div2",    name: "Analyst Upgrade", desc: "2x cash from every new high.",           cost: 20000,   kind: "yield",  value: 2 },
    { id: "algo",    name: "Algo Execution",  desc: "Each buy adds 2% of buy volume.",        cost: 40000,   kind: "cpsPct", value: 0.02 },
    { id: "algobb",  name: "Algo Buyback Desk", desc: "In a bear, auto-buys back a stake chunk whenever the discount passes 25% and you have the cash.", cost: 25000, kind: "perk", short: "auto bear buybacks" },
    { id: "squeeze", name: "Short Squeeze",   desc: "Every buyer buys 3x as much.",           cost: 150000,  kind: "gen",    value: 3 },
    { id: "divA",    name: "Dividend Aristocrat", desc: "Dividends pay out 1.5% more of the price each time.", cost: 300000, kind: "dividend", value: 0.015 },
    { id: "dark",    name: "Dark Pool Access", desc: "Hidden size. 5x per buy.",               cost: 500000,  kind: "mult",   value: 5 },
    { id: "div3",    name: "Buyback Program", desc: "2x cash from every new high.",           cost: 2000000, kind: "yield",  value: 2 },
    { id: "hft",     name: "Co-located Servers", desc: "Each buy adds 5% more of buy volume.", cost: 5000000, kind: "cpsPct", value: 0.05 },
  ],
};

// Cash now only comes from new highs (about $1 per $1 of growth), so prices are scaled down
// from the base list above. Tune pacing here.
// Costs are in stake-sized cash (x10,000 the old list). `reveal` keeps the old number:
// a thing shows up once your best share price reaches 30% of it.
TC.config.costScale = 10000;
for (const item of [...TC.config.generators, ...TC.config.upgrades]) {
  item.reveal = item.cost;
  item.cost = Math.round(item.cost * TC.config.costScale);
}
