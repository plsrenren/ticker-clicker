// Game balance and content. Tweak numbers here without touching game logic.
window.TC = window.TC || {};

TC.config = {
  baseClick: 1,          // dollars added to the price per buy, before upgrades
  costGrowth: 1.15,      // each extra buyer of a kind costs 15% more
  sampleMs: 250,         // how often the chart records a point
  historyPoints: 240,    // default visible window (240 x 250ms = 60s)
  historyMax: 1440,      // samples kept for zooming out (1440 x 250ms = 6 minutes)
  zoomMin: 40,           // most zoomed in: 40 samples = 10s
  wobble: 0.02,          // max ambient noise as a fraction of price, for a living line
  saveMs: 5000,

  // Economy: cash comes from growth. Every $1 the share price climbs above its record pays you cashPerDollar.
  // Dips pay nothing until the price is back above the record.
  cashPerDollar: 0.5,
  sharesOutstanding: 1000000, // market cap = share price x this (the headline number)
  startShares: 100,      // shares you hold (used by SELL)
  sell: {
    offPeak: 0.5,        // sells outside an event peak pay half
    fineWindow: 60,      // selling again within this many seconds draws an SEC fine...
    fine: 0.2,           // ...of this share of your cash
    crashDrop: 0.3,      // selling into a crash drops the price this much instead of the usual drop
    payout: 0.002,       // a sell pays shares x price x this: 0.2x the price
    drop: 0.15,          // and knocks 15% off the price
    cooldown: 15,        // seconds before you can sell again
    minPrice: 5,         // can't sell a penny stock
  },

  // Going private (js/prestige.js): reset the run for permanent founder points.
  prestige: {
    minPrice: 1000000,   // best price this run needed to go private
    scale: 100000,       // points for a run = floor(sqrt(bestPrice / scale))
    perPoint: 0.1,       // each founder point: +10% taps and buyers, forever
  },
  achievementBonus: 0.02, // each achievement: +2% taps and buyers, forever
  offline: {
    efficiency: 0.5,     // buyers run at half speed while you're away
    maxHours: 8,
    minSeconds: 60,
  },
  candleSamples: 8,      // chart samples per candle (8 x 250ms = 2s candles)

  // Market events (js/news.js)
  news: {
    firstAfter: 20,      // seconds after reaching minPrice before the first event
    minGap: 30,          // seconds between events
    maxGap: 55,
    minPrice: 20,        // no events on a penny stock
    shortTaps: 25,       // taps needed to beat a short attack (6 seconds)
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
  upgrades: [
    { id: "market",  name: "Market Orders",   desc: "Buys fill instantly. 2x per buy.",       cost: 50,      kind: "mult",   value: 2 },
    { id: "div1",    name: "Dividend Hike",   desc: "50% more cash from every new high.",       cost: 250,     kind: "yield",  value: 1.5 },
    { id: "margin",  name: "Margin Account",  desc: "Borrowed money buys more. 2x per buy.",  cost: 500,     kind: "mult",   value: 2 },
    { id: "beat",    name: "Earnings Beat",   desc: "Every buyer buys 2x as much.",           cost: 2500,    kind: "gen",    value: 2 },
    { id: "options", name: "Call Options",    desc: "Leverage on every order. 3x per buy.",   cost: 6000,    kind: "mult",   value: 3 },
    { id: "div2",    name: "Special Dividend", desc: "2x cash from every new high.",           cost: 20000,   kind: "yield",  value: 2 },
    { id: "algo",    name: "Algo Execution",  desc: "Each buy adds 2% of buy volume.",        cost: 40000,   kind: "cpsPct", value: 0.02 },
    { id: "squeeze", name: "Short Squeeze",   desc: "Every buyer buys 3x as much.",           cost: 150000,  kind: "gen",    value: 3 },
    { id: "dark",    name: "Dark Pool Access", desc: "Hidden size. 5x per buy.",               cost: 500000,  kind: "mult",   value: 5 },
    { id: "div3",    name: "Buyback Program", desc: "2x cash from every new high.",           cost: 2000000, kind: "yield",  value: 2 },
    { id: "hft",     name: "Co-located Servers", desc: "Each buy adds 5% more of buy volume.", cost: 5000000, kind: "cpsPct", value: 0.05 },
  ],
};

// Cash now only comes from new highs (about $1 per $1 of growth), so prices are scaled down
// from the base list above. Tune pacing here.
TC.config.costScale = 1;
for (const item of [...TC.config.generators, ...TC.config.upgrades]) {
  item.cost = Math.max(5, Math.round(item.cost * TC.config.costScale));
}
