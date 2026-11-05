# Ticker Clicker

An incremental clicker game where you are a stock ticker. Tap the chart to buy, push your price to new highs to earn cash, and spend it on buyers and upgrades.

Plain HTML, CSS and JavaScript: no build step. Open `index.html` in a browser, or serve the folder with any static host.

## Layout

- `js/config.js`: balance and content (buyers, upgrades, costs)
- `js/market.js`: the economy rules
- `js/chart.js`, `js/effects.js`: canvas chart and visual effects
- `js/news.js`, `js/moves.js`, `js/seasons.js`, `js/hype.js`, `js/trade.js`: market events, silent swings, bull/bear seasons, hype moves, peak sells and dip buys
- `js/sound.js`: synthesized sound effects
- `js/leaderboard.js`: Leaders tab (weekly and all-time boards for best market cap and fastest time to go private)
- `api/leaderboard.js`: Vercel function behind the leaderboards, storing scores in Upstash Redis
- `js/main.js`: boot and game loop

## Leaderboards

The game itself is static. Leaderboards need the `/api/leaderboard` function on Vercel plus an Upstash Redis database: add **Upstash for Redis** from the Vercel Marketplace and connect it to the project, which sets `KV_REST_API_URL` and `KV_REST_API_TOKEN`. Without them the API answers 503 and the Leaders tab says it can't reach the board; the rest of the game is unaffected.
