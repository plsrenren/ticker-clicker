// Race mode: 2-4 players list at $0.10 at the same moment; the first to a $1B market cap wins.
//
// Served at /race (start a race) and /race/ABCD (the invite link). Talks to /api/race (api/race.js),
// polling about once a second: you post your price and best market cap, and get everyone else's back.
// It's a pure race, nobody can touch anyone else's stock. What's shared:
//   - the start moment (the server picks it, the countdown is synced to the server clock)
//   - the luck: one seed for the room, so news and seasons draw the same dice (js/rng.js, seasons.js)
//   - the chart: rivals' lines are drawn on yours (chart.js asks TC.race.rivals())
// Each race has its own save (state.js), starting fresh with no founder points, upgrades or trophies.
window.TC = window.TC || {};

TC.race = (() => {
  const API = "/api/race";
  const $ = (id) => document.getElementById(id);
  const st = () => TC.state.data;
  const f = TC.format;
  const on = !!(TC.mode && TC.mode.race);

  let goPublic = null;
  let room = null;           // last room view from the server
  let offset = 0;            // server clock - local clock (ms)
  let screen = null;         // "create" | "join" | "lobby" | "countdown" | "results" | "error"
  let pollTimer = null, busy = false, doneSince = 0;
  let mySym = "";
  const smooth = {};         // slot -> smoothed price for the chart
  let lastSmooth = 0;

  const id = () => TC.leaderboard.playerId();
  const serverNow = () => Date.now() + offset;
  const clean = (v) => v.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 5);
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const clock = (ms) => { const sec = Math.max(0, Math.floor(ms / 1000)); return Math.floor(sec / 60) + ":" + String(sec % 60).padStart(2, "0"); };
  const COLORS = ["#4dc3ff", "#ffb547", "#ff6bd5", "#b892ff"]; // same as chart.js
  const colorOf = (p) => (room && p.slot === room.you ? "var(--line)" : COLORS[p.slot % COLORS.length]);

  async function call(action, extra) {
    const r = await fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.assign({ action, id: id(), code: TC.mode.code }, extra)),
    });
    let data = null;
    try { data = await r.json(); } catch (e) { /* not json */ }
    if (!r.ok) throw new Error((data && data.error) || "Couldn't reach the race server.");
    return data;
  }

  function accept(v) {
    room = v;
    offset = v.now - Date.now();
    if (v.code && TC.mode.code !== v.code) {
      TC.mode.code = v.code;
      history.replaceState(null, "", "/race/" + v.code);
    }
  }

  // ---------- screens ----------
  function show(name, html) {
    screen = name;
    $("raceCard").innerHTML = html;
    $("race").hidden = false;
  }
  function hide() { $("race").hidden = true; screen = null; }

  function tickerForm(eyebrow, title, sub, button) {
    show(eyebrow === "join" ? "join" : "create", `
      <p class="ipo-eyebrow">${title.eyebrow}</p>
      <h1 class="ipo-title">${title.text}</h1>
      <p class="ipo-sub">${sub}</p>
      <form id="raceForm" autocomplete="off">
        <label class="ipo-field" for="raceInput">
          <span class="ipo-dollar">$</span>
          <input id="raceInput" class="ipo-input" maxlength="5" spellcheck="false" autocapitalize="characters" inputmode="text" placeholder="YOU" aria-label="Ticker symbol" value="${esc(mySym)}">
        </label>
        <button class="ipo-go" id="raceGo" type="submit" ${mySym ? "" : "disabled"}>${button}</button>
      </form>
      <p class="race-msg" id="raceMsg" hidden></p>
      <a class="race-link" href="/">Back to solo game</a>`);
    const input = $("raceInput");
    input.addEventListener("input", () => { const v = clean(input.value); if (input.value !== v) input.value = v; $("raceGo").disabled = !v; });
    if (window.matchMedia("(hover: hover)").matches) setTimeout(() => input.focus(), 50);
    $("raceForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const v = clean(input.value);
      if (!v || busy) return;
      mySym = v;
      busy = true;
      $("raceGo").disabled = true;
      try {
        accept(await call(eyebrow === "join" ? "join" : "create", { sym: v }));
        renderLobby();
        poll();
      } catch (err) {
        $("raceMsg").textContent = err.message; $("raceMsg").hidden = false;
        $("raceGo").disabled = false;
      }
      busy = false;
    });
  }

  function showCreate() {
    tickerForm("create", { eyebrow: "Race mode", text: "Race your friends" },
      "2 to 4 players list at $0.10 at the same moment. First to a $1B market cap wins.", "Create race");
  }
  function showJoin() {
    tickerForm("join", { eyebrow: "Race " + esc(TC.mode.code), text: "Name your ticker" },
      "You've been invited to a race. First to a $1B market cap wins.", "Join race");
  }
  function showError(msg) {
    stopPoll();
    show("error", `
      <p class="ipo-eyebrow">Race mode</p>
      <h1 class="ipo-title">Can't join</h1>
      <p class="ipo-sub">${esc(msg)}</p>
      <a class="ipo-go race-btn" href="/race">Start a new race</a>
      <a class="race-link" href="/">Back to solo game</a>`);
  }

  function slotRows() {
    const rows = [];
    for (let i = 0; i < room.max; i++) {
      const p = room.players.find((x) => x.slot === i) || null;
      rows.push(p
        ? `<li><i style="background:${colorOf(p)}"></i><b>$${esc(p.sym)}</b><span>${p.slot === room.you ? "you" : ""}${p.host ? (p.slot === room.you ? " · host" : "host") : ""}</span></li>`
        : `<li class="empty"><i></i><b>Open seat</b><span></span></li>`);
    }
    return rows.join("");
  }

  function renderLobby() {
    const n = room.players.length;
    const action = room.host
      ? `<button class="ipo-go" id="raceStart" type="button" ${n < 2 ? "disabled" : ""}>${n < 2 ? "Waiting for players" : "Start race · " + n + " players"}</button>`
      : `<p class="race-wait">Waiting for the host to start</p>`;
    const html = `
      <p class="ipo-eyebrow">Race code</p>
      <h1 class="race-code">${esc(room.code)}</h1>
      <button class="race-invite" id="raceInvite" type="button">Invite friends</button>
      <ul class="race-slots">${slotRows()}</ul>
      <p class="ipo-sub">Everyone lists at $0.10 together. First to a $1B market cap wins.</p>
      ${action}
      <p class="race-msg" id="raceMsg" hidden></p>`;
    // Don't rebuild an identical screen (keeps button feedback like "Link copied")
    if (screen === "lobby" && $("raceCard").dataset.sig === html) return;
    show("lobby", html);
    $("raceCard").dataset.sig = html;
    $("raceInvite").addEventListener("click", invite);
    if ($("raceStart")) $("raceStart").addEventListener("click", async () => {
      if (busy) return;
      busy = true;
      $("raceStart").disabled = true;
      try { accept(await call("start")); step(); }
      catch (err) { $("raceMsg").textContent = err.message; $("raceMsg").hidden = false; $("raceStart").disabled = false; }
      busy = false;
    });
  }

  async function invite() {
    const url = location.origin + "/race/" + room.code;
    const btn = $("raceInvite");
    try {
      if (navigator.share && window.matchMedia("(pointer: coarse)").matches) {
        await navigator.share({ title: "Ticker Clicker race", text: "Race me to a $1B market cap. Code " + room.code, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      btn.textContent = "Link copied";
    } catch (e) {
      btn.textContent = url; // last resort: show it so it can be copied by hand
    }
    setTimeout(() => { if ($("raceInvite")) $("raceInvite").textContent = "Invite friends"; }, 2500);
  }

  function renderCountdown() {
    const left = Math.ceil((room.startAt - serverNow()) / 1000);
    const html = `<p class="ipo-eyebrow">Race ${esc(room.code)} · ${room.players.length} players</p><div class="race-count">${Math.max(1, left)}</div><p class="ipo-sub">First to a $1B market cap wins</p>`;
    if (screen !== "countdown") show("countdown", html); else $("raceCard").innerHTML = html;
  }

  function standings() {
    // Finished players by time, then everyone else by best market cap
    return room.players.slice().sort((a, b) => {
      if (a.finish != null || b.finish != null) return (a.finish ?? Infinity) - (b.finish ?? Infinity);
      return b.cap - a.cap;
    });
  }

  function renderResults() {
    const list = standings();
    const win = list[0];
    const youWon = win && win.slot === room.you;
    const rows = list.map((p, i) => `<li><span class="race-place">${i + 1}</span><i style="background:${colorOf(p)}"></i><b>$${esc(p.sym)}</b><span>${p.finish != null ? clock(p.finish) : f.axis(p.cap)}</span></li>`).join("");
    const action = room.host
      ? `<button class="ipo-go" id="raceAgain" type="button">Rematch</button>`
      : `<p class="race-wait">Waiting for the host to call a rematch</p>`;
    const html = `
      <p class="ipo-eyebrow">Race ${esc(room.code)} · finished</p>
      <h1 class="ipo-title">${youWon ? "You win!" : "$" + esc(win ? win.sym : "?") + " wins"}</h1>
      <p class="ipo-sub">${win && win.finish != null ? "Reached $1B in " + clock(win.finish) + "." : ""}</p>
      <ol class="race-results">${rows}</ol>
      ${action}
      <a class="race-link" href="/">Back to solo game</a>`;
    if (screen === "results" && $("raceCard").dataset.sig === html) return;
    show("results", html);
    $("raceCard").dataset.sig = html;
    if ($("raceAgain")) $("raceAgain").addEventListener("click", async () => {
      if (busy) return;
      busy = true;
      $("raceAgain").disabled = true;
      try { accept(await call("rematch")); step(); } catch (e) { $("raceAgain").disabled = false; }
      busy = false;
    });
  }

  // ---------- polling ----------
  function stopPoll() { clearTimeout(pollTimer); pollTimer = null; }
  function poll() {
    stopPoll();
    const run = async () => {
      try {
        const s = st();
        const extra = s.listed && live() ? { cap: TC.market.marketCap(s.bestPrice), price: TC.market.quote() } : {};
        accept(await call("tick", extra));
        step();
      } catch (err) {
        if (/not found|not in this race/i.test(err.message)) return showError(err.message);
        // network blip: keep trying
      }
      const wait = !room ? 2000 : room.state === "done" ? 2000 : room.state === "lobby" ? 1500 : 1000;
      if (room && room.state === "done" && doneSince && Date.now() - doneSince > 15 * 60 * 1000) return; // stop after 15 min
      pollTimer = setTimeout(run, wait);
    };
    run();
  }
  // Send right away when you cross the goal, without waiting for the next poll
  let goalSent = false;
  function checkGoal() {
    if (goalSent || !live() || !room || room.state !== "live") return;
    if (TC.market.marketCap(st().bestPrice) >= room.goal) { goalSent = true; poll(); }
  }

  // React to the latest room view
  function step() {
    if (!room) return;
    if (room.you == null) { showJoin(); return; }
    if (room.state === "lobby") return renderLobby();
    if (room.state === "done") {
      if (!doneSince) doneSince = Date.now();
      if (room.next) return follow(room.next);
      return renderResults();
    }
    // live: count down, then list everyone at once
    if (serverNow() < room.startAt) return renderCountdown();
    startRun();
  }

  function startRun() {
    const s = st();
    TC.rng.seed(room.seed);
    if (!s.listed) {
      const me = room.players.find((p) => p.slot === room.you);
      goPublic(me ? me.sym : mySym || "YOU");
    }
    if (screen) hide();
    $("raceHud").hidden = false;
  }

  // Rematch: everyone moves to the new room with the same ticker
  async function follow(code) {
    stopPoll();
    const me = room.players.find((p) => p.slot === room.you);
    try { sessionStorage.setItem("tc-race-sym", me ? me.sym : mySym); } catch (e) { /* ignore */ }
    location.href = "/race/" + code;
  }

  // ---------- HUD (top-left of the chart while racing) ----------
  let hudT = 0;
  function renderHud(dt) {
    if ((hudT += dt) < 0.25 || !room || $("raceHud").hidden) return;
    hudT = 0;
    const elapsed = clock(serverNow() - room.startAt);
    const rows = standingsLive().map((p) => `<li${p.slot === room.you ? ' class="you"' : ""}><i style="background:${colorOf(p)}"></i><b>$${esc(p.sym)}</b><span>${p.finish != null ? "⚑ " + clock(p.finish) : f.axis(p.cap)}</span></li>`).join("");
    $("raceHud").innerHTML = `<div class="race-hud-head"><span>RACE TO $1B</span><span>${room.state === "done" ? "FINISHED" : elapsed}</span></div><ol>${rows}</ol>`;
  }
  // Standings during the race: your own number is live, everyone else's is from the last poll
  function standingsLive() {
    const mine = TC.market.marketCap(st().bestPrice);
    return room.players.map((p) => p.slot === room.you ? Object.assign({}, p, { cap: Math.max(p.cap, mine) }) : p)
      .sort((a, b) => (a.finish ?? Infinity) - (b.finish ?? Infinity) || b.cap - a.cap);
  }

  function live() { return on && !!room && room.state !== "lobby" && room.startAt != null && serverNow() >= room.startAt; }

  const api = {
    on: () => on,
    live,
    // Seconds since the start (server clock)
    elapsed: () => (room && room.startAt ? (serverNow() - room.startAt) / 1000 : 0),
    // Everyone else, for the chart: { slot, sym, price (eased toward the last report), finish }
    rivals() {
      if (!room) return [];
      const now = performance.now(), dt = Math.min(0.5, (now - lastSmooth) / 1000);
      lastSmooth = now;
      return room.players.filter((p) => p.slot !== room.you && p.price > 0).map((p) => {
        const cur = smooth[p.slot];
        // ease in log space, so a 10x jump glides instead of teleporting
        smooth[p.slot] = cur > 0 ? Math.exp(Math.log(cur) + (Math.log(p.price) - Math.log(cur)) * Math.min(1, 3 * dt)) : p.price;
        return { slot: p.slot, sym: p.sym, price: smooth[p.slot], finish: p.finish };
      });
    },

    init(onPublic) {
      goPublic = onPublic;
      document.documentElement.dataset.mode = "race";
      try { mySym = clean(sessionStorage.getItem("tc-race-sym") || ""); sessionStorage.removeItem("tc-race-sym"); } catch (e) { /* ignore */ }
      if (!mySym && st().symbol && st().symbol !== "YOU") mySym = st().symbol;
      TC.events.on("tick", ({ dt }) => { renderHud(dt); checkGoal(); if (screen === "countdown") step(); });
      if (!TC.mode.code) return showCreate();
      // Invite link or a reload: ask the room who we are
      show("loading", `<p class="ipo-eyebrow">Race ${esc(TC.mode.code)}</p><h1 class="ipo-title">Connecting…</h1>`);
      call("tick", {}).then((v) => {
        accept(v);
        step();
        poll();
      }).catch((err) => {
        if (/not in this race/i.test(err.message)) {
          if (mySym) { // rematch: join straight away with the same ticker
            return call("join", { sym: mySym }).then((v) => { accept(v); step(); poll(); }).catch(() => showJoin());
          }
          return showJoin();
        }
        showError(err.message);
      });
    },
  };
  return api;
})();
