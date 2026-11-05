// Online leaderboards (Leaders tab in the trading desk). Talks to /api/leaderboard (api/leaderboard.js).
//
// Boards: best market cap in one run, and fastest IPO-to-private time. Each has a weekly and an all-time view.
// You're identified by a random player id kept in its own storage key, so delisting doesn't lose your entries.
// The name shown is the ticker you used for that score. Off the real site (file://, the Artifact) the API
// isn't there and the tab says so; the game is unaffected.
window.TC = window.TC || {};

TC.leaderboard = (() => {
  const API = "/api/leaderboard";
  const ID_KEY = "ticker-clicker-player";
  const st = () => TC.state.data;
  const $ = (id) => document.getElementById(id);
  const f = TC.format;
  const online = /^https?:$/.test(location.protocol);

  let view = { board: "cap", period: "week" };
  let sentCap = 0;          // best cap already submitted this run
  let lastLoad = 0, loading = false;

  function playerId() {
    let id = null;
    try { id = localStorage.getItem(ID_KEY); } catch (e) { /* ignore */ }
    if (!/^[a-z0-9]{12,40}$/.test(id || "")) {
      const b = new Uint8Array(12);
      crypto.getRandomValues(b);
      id = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
      try { localStorage.setItem(ID_KEY, id); } catch (e) { /* ignore */ }
    }
    return id;
  }

  // body: { cap?, secs?, sym? }. The server takes one submit per player every few seconds, so retry once on 429.
  function submit(body, retry = true) {
    if (!online) return Promise.resolve(false);
    return fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.assign({ id: playerId(), sym: st().symbol }, body)),
      keepalive: true,
    }).then((r) => {
      if (r.status === 429 && retry) return new Promise((ok) => setTimeout(ok, 6000)).then(() => submit(body, false));
      return r.ok;
    }).catch(() => false);
  }

  // Send your best cap when it has grown 10% since the last send (checked every 20s and on milestones)
  function maybeSendCap() {
    const s = st();
    if (!s.listed) return;
    const cap = TC.market.marketCap(s.bestPrice);
    if (cap < 1e6 || cap < sentCap * 1.1) return;
    submit({ cap }).then((ok) => { if (ok) sentCap = Math.max(sentCap, cap); });
  }

  const fmtScore = (board, v) => board === "cap" ? f.axis(v) : fmtTime(v);
  function fmtTime(secs) {
    const m = Math.floor(secs / 60), s = Math.round(secs % 60);
    return m >= 60 ? Math.floor(m / 60) + "h " + (m % 60) + "m" : m + "m " + String(s).padStart(2, "0") + "s";
  }

  function paintControls() {
    document.querySelectorAll("#lbBoard [data-board]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.board === view.board)));
    document.querySelectorAll("#lbPeriod [data-period]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.period === view.period)));
  }

  function note(text) { $("lbNote").textContent = text; $("lbNote").hidden = !text; }

  function render(data) {
    const list = $("lbList");
    list.replaceChildren();
    for (const row of data.top) {
      const li = document.createElement("li");
      li.className = "lb-row" + (row.you ? " lb-you" : "");
      li.innerHTML = '<span class="lb-rank"></span><span class="lb-sym"></span><span class="lb-score"></span>';
      li.children[0].textContent = row.rank;
      li.children[1].textContent = "$" + row.sym;
      li.children[2].textContent = fmtScore(data.board, row.score);
      list.appendChild(li);
    }
    const what = data.board === "cap" ? "best market cap in one run" : "fastest time from IPO to going private";
    if (!data.top.length) note("No entries " + (data.period === "week" ? "this week" : "yet") + ". Be the first: the board ranks your " + what + ".");
    else if (data.you && !data.top.some((r) => r.you)) note("You're #" + f.int(data.you.rank) + " with " + fmtScore(data.board, data.you.score) + ".");
    else if (!data.you) note(data.board === "cap" ? "Reach a $1M market cap to get on the board." : "Go private to post a time.");
    else note("");
  }

  function load(force) {
    if (!online) { $("lbList").replaceChildren(); note("Leaderboards only work on the live site."); return; }
    if (loading || (!force && performance.now() - lastLoad < 15000)) return;
    loading = true;
    const want = Object.assign({}, view);
    if (force) $("lbList").classList.add("lb-loading");
    fetch(API + "?board=" + want.board + "&period=" + want.period + "&id=" + playerId(), { cache: "no-store" })
      .then((r) => r.ok ? r.json() : Promise.reject(r.status))
      .then((data) => { if (want.board === view.board && want.period === view.period) { lastLoad = performance.now(); render(data); } })
      .catch(() => { $("lbList").replaceChildren(); note("Couldn't reach the leaderboard. Try again in a bit."); })
      .finally(() => { loading = false; $("lbList").classList.remove("lb-loading"); });
  }

  const visible = () => !document.querySelector('.pane[data-pane="leaders"]').hidden;

  return {
    init() {
      const saved = st().settings.leaders;
      if (saved) view = { board: saved.board === "speed" ? "speed" : "cap", period: saved.period === "all" ? "all" : "week" };
      paintControls();
      const pick = (attr) => (e) => {
        const b = e.target.closest("[data-" + attr + "]");
        if (!b) return;
        view[attr] = b.dataset[attr];
        st().settings.leaders = Object.assign({}, view);
        paintControls();
        load(true);
      };
      $("lbBoard").addEventListener("click", pick("board"));
      $("lbPeriod").addEventListener("click", pick("period"));
      // Opening the tab (or the desk while it's on this tab) refreshes the board
      $("deskTabs").addEventListener("click", (e) => { const b = e.target.closest("[data-tab]"); if (b && b.dataset.tab === "leaders") load(false); });
      $("openDesk").addEventListener("click", () => { if (visible()) load(false); });

      TC.events.on("milestone", maybeSendCap);
      TC.events.on("private", ({ best, secs, symbol }) => {
        // Sent before the new run wipes the state; symbol and best come with the event
        submit({ sym: symbol, cap: TC.market.marketCap(best), secs });
        sentCap = 0;
        lastLoad = 0;
      });
      TC.events.on("reset", () => { sentCap = 0; });
      setInterval(maybeSendCap, 20000);
    },
    load,
  };
})();
