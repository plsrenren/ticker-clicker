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
- `js/race.js`, `api/race.js`: race mode at `/race` (lobby, invite links, polling, results); `js/rng.js` gives everyone in a race the same dice
- `js/main.js`: boot and game loop

## Leaderboards

The game itself is static. Leaderboards need the `/api/leaderboard` function on Vercel plus an Upstash Redis database: add **Upstash for Redis** from the Vercel Marketplace and connect it to the project, which sets `KV_REST_API_URL` and `KV_REST_API_TOKEN`. Without them the API answers 503 and the Leaders tab says it can't reach the board; the rest of the game is unaffected.

## Race mode

Open `/race` to start a race and share the `/race/ABCD` link. 2 to 4 players list at $0.10 at the same moment, and the first to a $1B market cap wins. Each race starts from a fresh save (no founder points or upgrades), every player gets the same news and season dice, and rivals' lines are drawn on your chart on a log axis. Clients poll `/api/race` about once a second, so it's a pure race. It uses the same Upstash database as the leaderboards; `vercel.json` rewrites `/race/*` to the game.
