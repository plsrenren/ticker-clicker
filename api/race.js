// Race rooms: 2-4 players list at the same moment and race to a $1B market cap.
// A Vercel function backed by Upstash Redis (same database as the leaderboards). Clients poll it
// about once a second, so this is a pure race: nobody can touch anyone else's stock.
//
// POST /api/race  { action, ... }   every action answers with the room (see view())
//   create  { id, sym }               new room, you're the host            -> room
//   join    { code, id, sym }         join a room in its lobby (or rejoin)  -> room
//   start   { code, id }              host only, 2+ players                 -> room
//   tick    { code, id, cap?, price? } post your progress, read everyone's -> room
//   rematch { code, id }              host only, after the finish: new room; everyone follows room.next
//
// Storage: one Redis hash per room, race:<CODE>, expiring 3 hours after the last create/join/start.
//   meta        JSON { host, state: lobby|live|done, seed, startAt, created }
//   p:<id>      JSON { slot, sym, cap, price, t }
//   f:<id>      ms after the start when that player reached the goal (HSETNX: first report wins)
//   winner      player id of the first finisher (HSETNX)
//   next        code of the rematch room
// Player ids stay private: the room view lists players by slot and tells you which slot is yours.

const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

const GOAL = 1e9;            // market cap that wins
const MAX_PLAYERS = 4;
const COUNTDOWN_MS = 4000;   // start is announced this long before the race begins
const TTL = 60 * 60 * 3;
const LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // no I or O, they read like 1 and 0

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

async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return JSON.parse(req.body || "{}");
  let raw = "";
  for await (const chunk of req) raw += chunk;
  return JSON.parse(raw || "{}");
}

const key = (code) => "race:" + code;
const newCode = () => Array.from({ length: 4 }, () => LETTERS[Math.floor(Math.random() * LETTERS.length)]).join("");

// HGETALL comes back as a flat [field, value, ...] list
function parse(flat) {
  if (!flat || !flat.length) return null;
  const h = {};
  for (let i = 0; i < flat.length; i += 2) h[flat[i]] = flat[i + 1];
  if (!h.meta) return null;
  const room = { meta: JSON.parse(h.meta), players: {}, finish: {}, winner: h.winner || null, next: h.next || null };
  for (const f in h) {
    if (f.startsWith("p:")) room.players[f.slice(2)] = JSON.parse(h[f]);
    else if (f.startsWith("f:")) room.finish[f.slice(2)] = Number(h[f]);
  }
  return room;
}

function view(code, room, id) {
  const m = room.meta, now = Date.now();
  const players = Object.entries(room.players)
    .map(([pid, p]) => ({
      slot: p.slot, sym: p.sym, cap: p.cap || 0, price: p.price || 0,
      age: p.t ? now - p.t : null,            // ms since this player last reported
      finish: room.finish[pid] ?? null,       // ms from the start to the goal
      host: pid === m.host,
      won: pid === room.winner,
    }))
    .sort((a, b) => a.slot - b.slot);
  const state = room.winner ? "done" : m.state;
  return {
    code, state, now, goal: GOAL, max: MAX_PLAYERS,
    seed: m.seed || null, startAt: m.startAt || null,
    you: room.players[id] ? room.players[id].slot : null,
    host: id === m.host,
    next: room.next,
    players,
  };
}

const fail = (res, status, error) => res.status(status).json({ error });
const okId = (id) => /^[a-z0-9]{12,40}$/.test(id);
const okSym = (s) => /^[A-Z]{1,5}$/.test(s);
const okCode = (c) => /^[A-Z]{4}$/.test(c);

async function load(code) {
  const [flat] = await redis([["HGETALL", key(code)]]);
  return parse(flat);
}

async function create(id, sym) {
  for (let tries = 0; tries < 8; tries++) {
    const code = newCode();
    const meta = { host: id, state: "lobby", created: Date.now() };
    const [made] = await redis([["HSETNX", key(code), "meta", JSON.stringify(meta)]]);
    if (!made) continue; // code taken, roll again
    await redis([["HSET", key(code), "p:" + id, JSON.stringify({ slot: 0, sym, cap: 0, price: 0, t: Date.now() })], ["EXPIRE", key(code), TTL]]);
    return code;
  }
  throw new Error("no free code");
}

async function handler(req, res) {
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return fail(res, 405, "method not allowed"); }
  let b;
  try { b = await readBody(req); } catch (e) { return fail(res, 400, "bad json"); }
  const action = String(b.action || "");
  const id = String(b.id || "");
  const sym = String(b.sym || "");
  const code = String(b.code || "").toUpperCase();
  if (!okId(id)) return fail(res, 400, "bad id");
  res.setHeader("Cache-Control", "no-store");

  if (action === "create") {
    if (!okSym(sym)) return fail(res, 400, "bad symbol");
    const c = await create(id, sym);
    return res.status(200).json(view(c, await load(c), id));
  }

  if (!okCode(code)) return fail(res, 400, "bad code");
  let room = await load(code);
  if (!room) return fail(res, 404, "Race not found. It may have expired.");
  const me = room.players[id];

  if (action === "join") {
    if (!okSym(sym)) return fail(res, 400, "bad symbol");
    if (!me) {
      if (room.meta.state !== "lobby" || room.winner) return fail(res, 409, "This race already started.");
      const list = Object.values(room.players);
      if (list.length >= MAX_PLAYERS) return fail(res, 409, "This race is full.");
      if (list.some((p) => p.sym === sym)) return fail(res, 409, "$" + sym + " is taken in this race. Pick another ticker.");
      const used = new Set(list.map((p) => p.slot));
      let slot = 0;
      while (used.has(slot)) slot++;
      await redis([["HSET", key(code), "p:" + id, JSON.stringify({ slot, sym, cap: 0, price: 0, t: Date.now() })], ["EXPIRE", key(code), TTL]]);
    } else if (room.meta.state === "lobby" && me.sym !== sym) {
      if (Object.entries(room.players).some(([pid, p]) => pid !== id && p.sym === sym)) return fail(res, 409, "$" + sym + " is taken in this race.");
      await redis([["HSET", key(code), "p:" + id, JSON.stringify(Object.assign({}, me, { sym }))]]);
    }
    return res.status(200).json(view(code, await load(code), id));
  }

  if (!me) return fail(res, 403, "You're not in this race.");

  if (action === "start") {
    if (room.meta.host !== id) return fail(res, 403, "Only the host can start.");
    if (room.meta.state === "lobby") {
      if (Object.keys(room.players).length < 2) return fail(res, 409, "Wait for at least one more player.");
      const meta = Object.assign({}, room.meta, { state: "live", startAt: Date.now() + COUNTDOWN_MS, seed: Math.floor(Math.random() * 2 ** 31) });
      await redis([["HSET", key(code), "meta", JSON.stringify(meta)], ["EXPIRE", key(code), TTL]]);
    }
    return res.status(200).json(view(code, await load(code), id));
  }

  if (action === "tick") {
    const cmds = [];
    const live = room.meta.state === "live" && Date.now() >= room.meta.startAt;
    const cap = Number(b.cap), price = Number(b.price);
    if (live && Number.isFinite(cap) && cap >= 0 && cap < 1e30) {
      const p = Object.assign({}, me, { cap: Math.max(cap, me.cap || 0), price: Number.isFinite(price) ? price : me.price, t: Date.now() });
      cmds.push(["HSET", key(code), "p:" + id, JSON.stringify(p)]);
      if (cap >= GOAL) {
        cmds.push(["HSETNX", key(code), "f:" + id, String(Date.now() - room.meta.startAt)]);
        cmds.push(["HSETNX", key(code), "winner", id]);
      }
    } else {
      cmds.push(["HSET", key(code), "p:" + id, JSON.stringify(Object.assign({}, me, { t: Date.now() }))]);
    }
    cmds.push(["HGETALL", key(code)]);
    const out = await redis(cmds);
    return res.status(200).json(view(code, parse(out[out.length - 1]), id));
  }

  if (action === "rematch") {
    if (room.meta.host !== id) return fail(res, 403, "Only the host can start a rematch.");
    if (!room.winner) return fail(res, 409, "The race isn't over yet.");
    if (!room.next) {
      const c = await create(id, me.sym);
      const [set] = await redis([["HSETNX", key(code), "next", c]]);
      if (!set) await redis([["DEL", key(c)]]); // someone beat us to it
    }
    return res.status(200).json(view(code, await load(code), id));
  }

  return fail(res, 400, "unknown action");
}

module.exports = async (req, res) => {
  if (!URL_ || !TOKEN) return fail(res, 503, "race storage not configured");
  try { return await handler(req, res); } catch (e) { return fail(res, 502, "storage error"); }
};
