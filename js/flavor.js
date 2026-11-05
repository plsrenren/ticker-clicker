// Flavor text for news banners. Each key holds a pool of templates; TC.flavor.line(key, vars)
// picks one at random (never the same one twice in a row) and fills in the {placeholders}:
//   {you} your ticker ($MOON)   {r} a rival ticker   {pct} a move like +18%
//   {a} {b} two rivals and {pa} {pb} their moves (sector crash)   {bid} a share price
// Add lines freely: the game only cares about the keys.
window.TC = window.TC || {};

TC.flavor = (() => {
  const P = {
    // ---- classic events ----
    headline: [
      "{you}: CEO posts a meme at 3am",
      "{you}: Auditor resigns, cites \"vibes\"",
      "{you}: Factory turns out to be a green screen",
      "{you}: CFO spotted buying a yacht named EXIT",
      "{you}: Product recalled for being a jpeg",
      "{you}: Regulators would like a word",
      "{you}: Earnings call accidentally streamed from a casino",
      "{you}: Headquarters is a PO box in a strip mall",
      "{you}: CEO replies \"ratio\" to the SEC",
      "{you}: Board meeting held in a group chat named \"lol\"",
      "{you}: Flagship product is just the competitor's, but blue",
      "{you}: Interns found running the treasury",
      "{you}: Annual report written entirely in emojis",
      "{you}: Founder livestreams himself shorting the stock",
      "{you}: \"Revenue\" turns out to be a typo",
      "{you}: Company mascot arrested",
      "{you}: Data center was a gaming PC under a desk",
      "{you}: CFO answers every question with \"trust me bro\"",
    ],
    headlineSub: ["Tap fast to defend the price", "Buy the panic. Tap!", "Hold the line: tap tap tap", "Defend the chart"],
    flash: [
      "{you} drops {pct} in seconds",
      "{you} falls {pct} before anyone finishes their coffee",
      "A fat-finger trade sends {you} {pct}",
      "Algorithms panic: {you} {pct} in a blink",
      "Someone sold {you} by accident. {pct}",
    ],
    flashSub: ["Hold on…", "Don't look", "Breathe", "This is fine"],
    recover: ["Dip buyers step in", "Bargain hunters swarm {you}", "The bots change their minds", "Never mind, it was a glitch"],
    short: [
      "Short sellers are piling into {you}",
      "A hedge fund just bet billions against {you}",
      "Anonymous report calls {you} \"a vibe, not a company\"",
      "Shorts publish a 90-page PDF on {you}",
      "Famous bear says {you} is \"going to zero\"",
    ],
    squeeze: ["Shorts are covering. {you} {pct}", "Short squeeze! {you} {pct}", "The hedge fund taps out. {you} {pct}", "Diamond hands win. {you} {pct}"],
    shortWin: ["{you} {pct}", "The shorts were right this time. {you} {pct}", "Bears feast. {you} {pct}"],
    earningsIn: ["{you} reports in {n}", "{you} earnings in {n}", "Analysts hold their breath… {n}"],
    earningsSub: ["Beat or miss?", "Guidance or vibes?", "Did they make money?", "Fingers crossed"],
    beat: [
      "Crushed estimates. {you} gaps {pct}",
      "Record quarter. {you} gaps {pct}",
      "Revenue up, vibes up. {you} {pct}",
      "Analysts scramble to raise targets. {you} {pct}",
      "Turns out they make money. {you} {pct}",
    ],
    miss: [
      "Missed estimates. {you} gaps {pct}",
      "Guidance cut. {you} {pct}",
      "\"Investing in the future\" means losses. {you} {pct}",
      "CFO blames the weather. {you} {pct}",
      "Revenue \"temporarily shy\". {you} {pct}",
    ],
    pump: [
      "{who}: \"{you} is going to the moon\"",
      "{who}: \"Mortgaged my house for {you}\"",
      "{who}: \"{you} to $1M, not financial advice\"",
      "{who} posts {you} with 14 rocket emojis",
      "{who}: \"If you're not in {you} you're ngmi\"",
      "{who}: \"Just told my grandma to buy {you}\"",
    ],
    handles: ["@moonboy_capital", "@stonkwizard", "@diamondhandz", "@yolo_daily", "@chartwhisperer", "@lambo_or_bust", "@degen_dad", "@bagholder420"],
    pumpOut: ["Early buyers take profits…", "The influencers are selling…", "Somebody's exiting…"],

    // ---- size tiers: news.js uses key + "Small" under a $100M market cap and key + "Big" from $50B ----
    headlineSmall: [
      "{you}: Local blog questions the business model",
      "{you}: CEO's mom unfollows the company page",
      "{you}: Only office plant dies, staff morale low",
      "{you}: Yelp review calls HQ \"a garage\"",
      "{you}: Website down, intern was on vacation",
      "{you}: Accountant is also the delivery driver",
      "{you}: Annual meeting attended by 3 people and a dog",
      "{you}: Founder's group chat leaks: \"lol we're broke\"",
    ],
    headlineBig: [
      "{you}: FBI raids headquarters",
      "{you}: Senate subpoenas the CEO",
      "{you}: DOJ opens antitrust probe",
      "{you}: EU hands down an $8 billion fine",
      "{you}: Whistleblower testifies before Congress",
      "{you}: Three countries ban the flagship product",
      "{you}: Central bank calls it \"a systemic risk\"",
      "{you}: Global outage takes down half the internet",
    ],
    shortSmall: [
      "A guy on a forum is shorting {you}",
      "Some newsletter calls {you} \"overhyped\"",
      "A college finance club bets against {you}",
    ],
    shortBig: [
      "The world's biggest hedge funds pile into {you} shorts",
      "Billionaire bear goes on TV: \"{you} is the bubble\"",
      "Short interest in {you} hits a record $40 billion",
    ],
    beatSmall: ["Turned a profit for once. {you} {pct}", "Sold more than 12 units. {you} {pct}", "First positive quarter ever. {you} {pct}"],
    beatBig: ["Biggest quarter in corporate history. {you} {pct}", "{you} earns more than most countries. {pct}", "Profit tops $100 billion. {you} {pct}"],
    missSmall: ["Revenue was mostly the founder's savings. {you} {pct}", "Sold 4 units, returned 3. {you} {pct}", "Ran out of money for the earnings call. {you} {pct}"],
    missBig: ["First revenue drop in a decade. {you} {pct}", "Guidance slashed, world markets wobble. {you} {pct}", "{you} misses by $20 billion. {pct}"],
    handlesSmall: ["@my_cousin_trades", "@dave_from_accounting", "@pennystockpete", "@300followers", "@uncle_gary_invests"],
    handlesBig: ["@the_richest_man", "@famous_rapper", "@ex_president", "@pop_superstar", "@sovereign_fund_ceo"],

    split: [
      "{you} board proposes a 10-for-1 stock split",
      "{you} wants to split its stock. Shareholders vote now",
      "Split vote: should {you} shares get 10x cheaper?",
      "{you} CEO: \"our shares are too expensive to meme\"",
    ],
    splitWin: ["Split approved. {you} now trades at {bid}. {pct}", "10-for-1 done. Retail piles in at {bid}. {pct}", "Cheap shares! {you} at {bid} and climbing. {pct}"],
    splitLose: ["Shareholders vote no on the split. {you} {pct}", "Split rejected: \"we like our expensive shares\". {pct}", "Not enough votes. No split. {you} {pct}"],

    opex: [
      "Options expiry: billions in {you} contracts pinned at {bid}",
      "Max pain is {bid}. Market makers want {you} pinned there",
      "Triple witching: {you} stuck at {bid} as options expire",
    ],
    opexUp: ["Calls print! {you} rips off the pin. {pct}", "Pin breaks upward: {you} {pct}", "Call holders cash in, {you} {pct}"],
    opexDown: ["Puts pay out. {you} drops off the pin. {pct}", "Pin breaks down: {you} {pct}", "Max pain wins. {you} {pct}"],
    gamma: ["Gamma squeeze! Dealers forced to buy {you}. {pct}", "Second leg: options dealers chase {you} {pct}", "Calls go in the money, dealers panic-buy {you}. {pct}"],

    hack: [
      "{you} hacked: attackers are dumping shares from stolen accounts",
      "Hackers inside {you}'s trading systems",
      "{you} treasury wallet compromised. Funds draining",
      "Ransomware locks {you}'s servers, demands 400 BTC",
      "{you}'s password was \"password\". Hackers noticed",
    ],
    hackSmall: [
      "{you}'s website defaced by a bored teenager",
      "Someone guessed {you}'s admin password: \"admin\"",
      "{you}'s only server infected by a screensaver virus",
    ],
    hackBig: [
      "State hackers breach {you}'s core network",
      "{you} hit by the largest cyberattack in history",
      "Hackers take {you}'s cloud offline across three continents",
    ],
    hackPatched: ["Hole patched. {you} stops the bleeding at {pct}", "Attackers locked out. {you} {pct} and recovering", "Security team wins: {you} patched at {pct}"],
    hacked: ["Hackers walk away with it. {you} {pct}", "Too late: {you} drained {pct}", "The attack ran its course. {you} {pct}"],
    breach: [
      "{you} data breach: 40 million users exposed. {pct}",
      "{you} customer data for sale on the dark web. {pct}",
      "{you} left a database open to the internet. {pct}",
      "Leaked: every {you} password, in plain text. {pct}",
    ],
    breachSmall: ["{you} emailed its customer list to everyone. All 212 of them. {pct}", "{you} intern posts the user database on a forum. {pct}"],
    breachBig: ["{you} breach exposes a billion accounts. {pct}", "Regulators on three continents probe {you}'s breach. {pct}"],
    breachWin: ["Free credit monitoring for everyone. Users forgive {you}", "{you} CEO's apology video goes viral, in a good way", "Fast response wins users back to {you}"],
    breachLose: ["Users delete {you} in droves", "Class action filed against {you}", "\"We take security seriously\", says {you}. Nobody buys it"],
    exploit: [
      "Researcher finds a zero-day in {you}. Patch before it goes public",
      "White-hat reports a critical exploit in {you}",
      "Bug bounty hunter: \"{you} has a hole you could drive a truck through\"",
      "Zero-day in {you} spotted on a hacker forum",
    ],
    exploitWin: ["{you} patches in record time. Security praised. {pct}", "Exploit closed before anyone used it. {you} {pct}", "{you} pays the bounty, wins the headlines. {pct}"],
    exploitLose: ["Exploit goes public. {you} {pct}", "Hackers beat the patch. {you} {pct}", "Zero-day used in the wild. {you} {pct}"],

    // ---- rival events ----
    takeover: [
      "{r} in talks to buy {you}",
      "{r} reportedly circling {you}",
      "Sources: {r} wants {you}, \"badly\"",
      "{r} CEO spotted at {you} HQ",
      "{r} hires bankers to study {you}",
    ],
    takeoverOff: ["{r} walks away from {you}", "{r}: \"we were never serious\"", "Deal dies over the name of the merged company", "{r} saw the books"],
    rivalScandal: [
      "{r} CEO arrested. Investors flee to {you}",
      "{r} books found in a group chat. Investors flee to {you}",
      "{r}'s \"AI\" was three interns. Money pours into {you}",
      "{r}'s auditor is the CEO's cousin. Everyone buys {you}",
      "{r} caught counting the same dollar twice. {you} benefits",
      "{r} product catches fire on live TV. {you} wins",
    ],
    partner: [
      "{r} picks {you} as its supplier",
      "{r} signs a 10-year deal with {you}",
      "{r} will put {you} in every product",
      "{r} and {you} announce a \"synergy\"",
      "{r} buys a stake in {you}",
    ],
    index: ["{you} replaces {r} in the index", "{you} joins the big index. {r} gets kicked out", "Index funds forced to buy {you}. Bye, {r}"],
    copycat: [
      "{r} launches a cheaper {you}",
      "{r} releases \"{you} Lite\"",
      "{r} copies {you}'s whole product, adds a logo",
      "{r}'s new thing looks exactly like {you}",
    ],
    copycatWin: ["Nobody wants {r}'s version", "{r}'s knockoff gets one-star reviews", "{r} quietly discontinues its copy"],
    copycatLose: ["Retail traders switch to {r}", "{r}'s knockoff is trending", "Your fans just bought {r}"],
    hostile: [
      "{r} bids {bid} a share for {you}",
      "{r} launches a hostile bid: {bid} a share",
      "{r} offers {bid} a share and \"a firm handshake\"",
      "{r} wants {you} for {bid} a share. Rude",
    ],
    hostileWin: ["The board tells {r} no", "{you} rejects {r}: \"not for sale\"", "{r}'s bid gets laughed out of the room"],
    sector: [
      "Meme stocks crash: {a} {pa}, {b} {pb}. {you} next?",
      "Everything is red: {a} {pa}, {b} {pb}. {you} wobbles",
      "Bubble talk spreads: {a} {pa}, {b} {pb}. {you} feels it",
      "Margin calls everywhere: {a} {pa}, {b} {pb}. {you} dragged down",
    ],
    poach: [
      "Your {who} just joined {r}",
      "{r} poaches your {who} with a bigger desk",
      "Your {who} quits for {r}, takes the stapler",
      "{r} lures away your {who} with free snacks",
    ],
    execs: ["CFO", "CTO", "head of growth", "only engineer", "chief vibes officer", "lawyer"],
  };

  const last = {};
  function pick(key) {
    const pool = P[key] || [key];
    if (pool.length === 1) return pool[0];
    let i;
    do { i = Math.floor(Math.random() * pool.length); } while (i === last[key]);
    last[key] = i;
    return pool[i];
  }

  return {
    pools: P,
    pick,
    line(key, vars = {}) {
      return pick(key).replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? vars[k] : m));
    },
  };
})();
