// Leaderboards: a Vercel function backed by Upstash Redis (REST API, no dependencies).
//
// Boards:  cap   = best market cap reached in one run (higher wins)
//          speed = seconds of play from IPO to going private (lower wins)
// Periods: week (ISO week, UTC; keys expire after ~5 weeks) and all (all time)
//
// GET  /api/leaderboard?board=cap|speed&period=week|all&id=<player id>
//      -> { board, period, week, top: [{ rank, sym, score, you }], you: { rank, score } | null }
// POST /api/leaderboard  { id, sym, cap?, secs? }
//      -> { ok: true }
//
// Each player id holds one entry per board; a submit only replaces it when it is better.
// The game saves on the player's device, so scores can't be fully trusted. The checks below
// only reject what the game can't produce. Needs KV_REST_API_URL / KV_REST_API_TOKEN
// (set by the Upstash for Redis integration) or UPSTASH_REDIS_REST_URL / _TOKEN.

const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

const TOP = 50;
const MIN_SECS = 60;          // nobody goes private in under a minute
const MIN_CAP = 1e6;          // $1 share price x 1M shares: below this, don't clutter the board
const MAX_CAP = 1e27;         // far above anything the game reaches (going private is a $1T cap)
const WEEK_TTL = 60 * 60 * 24 * 7 * 5;

async function redis(cmds) {
  const r = await fetch(URL_ + "/pipeline", {
    method: "POST",
    headers: { Authorization: "Bearer " + TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify(cmds),
  });
  if (!r.ok) throw new Error("redis " + r.status);
  const out = await r.json();
  return out.map((x) => { if (x.error) throw new Error(x.error); return x.result; });
}

// ISO week label like 2026-W45 (UTC)
function isoWeek(d = new Date()) {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y = t.getUTCFullYear();
  const wk = Math.ceil(((t - Date.UTC(y, 0, 1)) / 864e5 + 1) / 7);
  return y + "-W" + String(wk).padStart(2, "0");
}

const key = (board, period, week) => "lb:" + board + ":" + (period === "week" ? week : "all");
const symKey = (k) => k + ":sym";

async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return JSON.parse(req.body || "{}");
  let raw = "";
  for await (const chunk of req) raw += chunk;
  return JSON.parse(raw || "{}");
}

async function get(req, res) {
  const q = req.query || {};
  const board = q.board === "speed" ? "speed" : "cap";
  const period = q.period === "all" ? "all" : "week";
  const id = /^[a-z0-9]{12,40}$/.test(q.id || "") ? q.id : null;
  const week = isoWeek();
  const k = key(board, period, week);
  const desc = board === "cap";

  const cmds = [desc ? ["ZRANGE", k, 0, TOP - 1, "REV", "WITHSCORES"] : ["ZRANGE", k, 0, TOP - 1, "WITHSCORES"]];
  if (id) cmds.push([desc ? "ZREVRANK" : "ZRANK", k, id], ["ZSCORE", k, id]);
  const [flat, rank, score] = await redis(cmds);

  const ids = [], scores = [];
  for (let i = 0; i < flat.length; i += 2) { ids.push(flat[i]); scores.push(Number(flat[i + 1])); }
  const syms = ids.length ? (await redis([["HMGET", symKey(k), ...ids]]))[0] : [];

  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({
    board, period, week,
    top: ids.map((pid, i) => ({ rank: i + 1, sym: syms[i] || "???", score: scores[i], you: pid === id })),
    you: id && rank != null ? { rank: rank + 1, score: Number(score) } : null,
  });
}

async function post(req, res) {
  let b;
  try { b = await readBody(req); } catch (e) { return res.status(400).json({ error: "bad json" }); }
  const id = String(b.id || "");
  const sym = String(b.sym || "");
  if (!/^[a-z0-9]{12,40}$/.test(id)) return res.status(400).json({ error: "bad id" });
  if (!/^[A-Z]{1,5}$/.test(sym)) return res.status(400).json({ error: "bad symbol" });
  const cap = Number(b.cap), secs = Number(b.secs);
  const hasCap = Number.isFinite(cap) && cap >= MIN_CAP && cap <= MAX_CAP;
  const hasSecs = Number.isFinite(secs) && secs >= MIN_SECS && secs < 1e7;
  if (!hasCap && !hasSecs) return res.status(400).json({ error: "nothing to submit" });

  // One submit per player every 3 seconds
  const [okToGo] = await redis([["SET", "lb:rl:" + id, "1", "NX", "EX", 3]]);
  if (okToGo !== "OK") return res.status(429).json({ error: "slow down" });

  const week = isoWeek();
  const entries = [];
  if (hasCap) entries.push([key("cap", "week", week), "GT", cap], [key("cap", "all"), "GT", cap]);
  if (hasSecs) entries.push([key("speed", "week", week), "LT", Math.round(secs)], [key("speed", "all"), "LT", Math.round(secs)]);

  // ZADD GT/LT CH returns 1 when the entry is new or improved; only then take the new symbol.
  const changed = await redis(entries.map(([k, mode, score]) => ["ZADD", k, mode, "CH", score, id]));
  const follow = [];
  entries.forEach(([k], i) => {
    if (changed[i]) follow.push(["HSET", symKey(k), id, sym]);
    if (k.includes("-W")) follow.push(["EXPIRE", k, WEEK_TTL], ["EXPIRE", symKey(k), WEEK_TTL]);
  });
  if (follow.length) await redis(follow);
  res.status(200).json({ ok: true });
}

module.exports = async (req, res) => {
  if (!URL_ || !TOKEN) return res.status(503).json({ error: "leaderboard storage not configured" });
  try {
    if (req.method === "GET") return await get(req, res);
    if (req.method === "POST") return await post(req, res);
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "method not allowed" });
  } catch (e) {
    return res.status(502).json({ error: "storage error" });
  }
};
