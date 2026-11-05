# Ticker Clicker

An incremental clicker game where you are a stock ticker. Tap the chart to buy, push your price to new highs to earn cash, and spend it on buyers and upgrades.

Plain HTML, CSS and JavaScript: no build step. Open `index.html` in a browser, or serve the folder with any static host.

## Layout

- `js/config.js`: balance and content (buyers, upgrades, costs)
- `js/market.js`: the economy rules
- `js/chart.js`, `js/effects.js`: canvas chart and visual effects
- `js/news.js`, `js/moves.js`, `js/seasons.js`, `js/hype.js`, `js/trade.js`: market events, silent swings, bull/bear seasons, hype moves, peak sells and dip buys
- `js/sound.js`: synthesized sound effects
- `js/main.js`: boot and game loop
