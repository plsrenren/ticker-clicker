// DOM side: the quote tape, the buyer desk, the buy button text.
window.TC = window.TC || {};

TC.ui = (() => {
  const $ = (id) => document.getElementById(id);
  const cfg = TC.config, f = TC.format;
  const st = () => TC.state.data;
  const rows = {}; // id -> { btn, name, desc, cost, count }
  let lastPrice = 0;
  let flashTimer = 0;

  function makeRow(item, kind, listEl) {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "item";
    btn.innerHTML =
      '<span class="item-name"></span><span class="item-count"></span>' +
      '<span class="item-desc"></span><span class="item-cost"></span>';
    btn.addEventListener("click", () => {
      kind === "generator" ? TC.market.buyGenerator(item.id) : TC.market.buyUpgrade(item.id);
      api.refresh(true);
    });
    li.appendChild(btn);
    listEl.appendChild(li);
    rows[item.id] = {
      li, btn,
      name: btn.children[0], count: btn.children[1], desc: btn.children[2], cost: btn.children[3],
    };
  }

  // A thing is revealed once the player has come within reach of it.
  const seen = (cost) => st().bestPrice >= cost * 0.3;

  function renderList(items, kind) {
    let shownLocked = false;
    for (const it of items) {
      const r = rows[it.id];
      const owned = kind === "generator" ? st().owned[it.id] || 0 : st().upgrades[it.id];
      const cost = kind === "generator" ? TC.market.generatorCost(it) : it.cost;
      const visible = owned || seen(it.cost);

      if (!visible) {
        // Tease exactly one locked entry per list.
        r.li.hidden = shownLocked;
        shownLocked = true;
        r.btn.classList.add("locked");
        r.btn.disabled = true;
        r.name.textContent = "???";
        r.desc.textContent = "Reach " + f.money(it.cost * 0.3) + " to reveal";
        r.cost.textContent = "";
        r.count.textContent = "";
        continue;
      }

      r.li.hidden = false;
      r.btn.classList.remove("locked");
      r.name.textContent = it.name;
      if (kind === "generator") {
        const sm = TC.seasons ? TC.seasons.genMult(it.id) : 1;
        r.desc.textContent = it.desc + " +" + f.money(it.rate * TC.market.genMult() * sm) + "/s each" +
          (sm < 1 ? " · bear market −" + Math.round((1 - sm) * 100) + "%" : "");
        r.count.textContent = owned || "";
        r.cost.textContent = f.money(cost);
        r.btn.disabled = st().cash < cost;
      } else {
        r.desc.textContent = it.desc;
        r.count.textContent = owned ? "✓" : "";
        r.cost.textContent = owned ? "Owned" : f.money(cost);
        r.btn.disabled = !owned && st().cash < cost;
        r.btn.classList.toggle("owned", !!owned);
        if (owned) r.btn.disabled = true;
      }
    }
  }

  function setDesk(open) {
    $("desk").classList.toggle("open", open);
    $("scrim").hidden = !open;
    $("openDesk").setAttribute("aria-expanded", String(open));
  }

  // Bottom sheet: open from the dock, close by tapping the scrim, Escape, or dragging the handle down.
  function bindDesk() {
    $("openDesk").addEventListener("click", () => setDesk(true));
    $("scrim").addEventListener("pointerdown", (e) => { e.preventDefault(); setDesk(false); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") setDesk(false); });

    const handle = $("deskHandle"), desk = $("desk");
    let startY = null, dy = 0;
    handle.addEventListener("pointerdown", (e) => {
      startY = e.clientY; dy = 0;
      handle.setPointerCapture(e.pointerId);
      desk.style.transition = "none";
    });
    handle.addEventListener("pointermove", (e) => {
      if (startY === null) return;
      dy = Math.max(0, e.clientY - startY);
      desk.style.transform = `translateY(${dy}px)`;
    });
    const end = () => {
      if (startY === null) return;
      startY = null;
      desk.style.transition = "";
      desk.style.transform = "";
      if (dy > 60 || dy === 0) setDesk(false);
    };
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  }

  // ---- Go private card: two taps to confirm ----
  function bindPrivate() {
    const btn = $("goPrivate");
    let armed = null;
    btn.addEventListener("click", () => {
      if (!TC.prestige.available()) return;
      if (!armed) {
        btn.classList.add("armed");
        btn.textContent = "Tap again: reset this run";
        armed = setTimeout(() => { armed = null; btn.classList.remove("armed"); api.refresh(); }, 3000);
        return;
      }
      clearTimeout(armed); armed = null;
      btn.classList.remove("armed");
      TC.prestige.goPrivate();
    });
  }

  function renderPrivate() {
    const s = st(), pc = cfg.prestige, pts = TC.prestige.available();
    const bonus = (n) => "+" + Math.round(n * pc.perPoint * 100) + "%";
    $("privatePts").textContent = f.int(s.prestige.points) + " founder points · " + bonus(s.prestige.points);
    const btn = $("goPrivate");
    if (!TC.prestige.unlocked()) {
      $("privateText").textContent = "Reach a " + f.money(pc.minPrice) + " share price to go private. You restart from $0 but keep founder points, which boost taps and buyers forever.";
      btn.disabled = true;
      if (!btn.classList.contains("armed")) btn.textContent = "Locked until " + f.money(pc.minPrice);
    } else {
      $("privateText").textContent = "Take " + f.int(pts) + " founder points (" + bonus(pts) + " forever). Your price, cash, buyers and upgrades reset, and you list again under a new name.";
      btn.disabled = false;
      if (!btn.classList.contains("armed")) btn.textContent = "Go private for " + f.int(pts) + " points";
    }
  }

  // ---- Line / candles toggle (taps on it must not buy) ----
  function bindModeToggle() {
    const box = $("modeToggle");
    box.addEventListener("pointerdown", (e) => e.stopPropagation());
    box.addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      api.setChartMode(b.dataset.mode);
    });
    api.setChartMode(st().settings.chart);
  }

  // ---- Achievements grid ----
  const achEls = {};
  function buildAchievements() {
    const grid = $("achGrid");
    for (const a of TC.achievements.LIST) {
      const li = document.createElement("li");
      li.className = "ach";
      li.innerHTML = '<span class="ach-name"></span><span class="ach-desc"></span>';
      li.children[0].textContent = a.name;
      li.children[1].textContent = a.desc;
      grid.appendChild(li);
      achEls[a.id] = li;
    }
  }
  function renderAchievements() {
    const got = st().achievements;
    let n = 0;
    for (const a of TC.achievements.LIST) {
      const on = !!got[a.id];
      if (on) n++;
      achEls[a.id].classList.toggle("on", on);
    }
    $("achCount").textContent = n + "/" + TC.achievements.LIST.length + " · +" + Math.round(n * cfg.achievementBonus * 100) + "%";
  }

  const api = {
    init() {
      cfg.generators.forEach((g) => makeRow(g, "generator", $("generators")));
      cfg.upgrades.forEach((u) => makeRow(u, "upgrade", $("upgrades")));

      api.setSymbol(st().symbol);
      bindDesk();
      bindPrivate();
      bindModeToggle();
      buildAchievements();

      TC.events.on("sell", (e) => {
        if (e.manual) api.refresh();
        $("price").classList.remove("tick-up");
        $("price").classList.add("tick-down");
        flashTimer = 0.18;
      });
      TC.events.on("buy", () => {
        $("price").classList.remove("tick-down");
        $("price").classList.add("tick-up");
        flashTimer = 0.08;
        $("hint").classList.add("gone");
      });
      if (st().orders > 0) $("hint").classList.add("gone");
    },

    setSymbol(sym) {
      $("symbol").textContent = "$" + sym;
      document.title = "$" + sym + " · Ticker Clicker";
    },

    // Called every frame for the tape; list state is cheap enough at 60fps but we throttle anyway.
    frame(dt, quote) {
      if (flashTimer > 0 && (flashTimer -= dt) <= 0) $("price").classList.remove("tick-up", "tick-down");

      $("price").textContent = f.money(TC.market.marketCap(quote));
      $("sharePrice").textContent = f.money(quote);
      const open = st().dayOpen;
      const diff = quote - open;
      const ch = $("change");
      ch.textContent = (diff >= 0 ? "+" : "-") + f.money(Math.abs(diff)).slice(1) +
        " (" + (open > 0 ? f.pct(diff / open) : diff > 0 ? "IPO" : "0.00%") + ")";
      ch.className = "change " + (diff > 0.004 ? "up" : diff < -0.004 ? "down" : "flat");
      lastPrice = quote;
    },

    refresh(force) {
      $("cash").textContent = f.money(st().cash);
      $("income").textContent = f.money(TC.market.income()) + "/s";
      $("perClick").textContent = "+" + f.money(TC.market.perClick());
      $("perSec").textContent = "+" + f.money(TC.market.perSecond()) + "/s";
      const s = st(), below = s.bestPrice - s.basePrice;
      $("holdings").textContent = "You earn cash when your share price sets a new high: every $1 above your record pays " +
        f.money(TC.market.cashPerDollar()) + ". " + (below > 0.005
          ? "You're " + f.money(below) + " below your record of " + f.money(s.bestPrice) + ", so nothing pays until you're back above it."
          : "You're at your record of " + f.money(s.bestPrice) + ", so every tap pays.");

      // Sell button
      const sb = $("sell"), cd = TC.market.sellCooldown();
      sb.disabled = !TC.market.canSell();
      sb.style.setProperty("--cd", (cd / cfg.sell.cooldown).toFixed(3));
      const bonus = TC.market.sellBonus();
      sb.classList.toggle("peak", bonus > 1 && TC.market.canSell());
      $("sellSub").textContent =
        st().basePrice < cfg.sell.minPrice ? "Reach " + f.money(cfg.sell.minPrice) + " to sell" :
        cd > 0 ? "Ready in " + Math.ceil(cd) + "s" :
        bonus > 1 ? "PEAK " + bonus + "x · +" + f.money(TC.market.sellValue()) :
        "+" + f.money(TC.market.sellValue()) + " · price −" + Math.round(cfg.sell.drop * 100) + "%";

      // Buy-the-dip button during event dips
      const dip = TC.trade.dipReady();
      $("dipBtn").hidden = !dip;
      if (dip) $("dipSub").textContent = "−" + Math.round(TC.trade.dipDepth() * 100) + "% · stack 12 orders";
      $("orders").textContent = f.int(st().orders) + (st().orders === 1 ? " order filled" : " orders filled");
      renderList(cfg.generators, "generator");
      renderList(cfg.upgrades, "upgrade");
      renderPrivate();
      renderAchievements();

      // Badge: how many things you can buy right now
      const n = cfg.generators.filter((g) => seen(g.cost) && st().cash >= TC.market.generatorCost(g)).length +
        cfg.upgrades.filter((u) => seen(u.cost) && !st().upgrades[u.id] && st().cash >= u.cost).length;
      const b = $("badge");
      b.hidden = n === 0;
      b.textContent = n;
    },

    setChartMode(m) {
      st().settings.chart = m;
      TC.chart.setMode(m);
      document.querySelectorAll("#modeToggle button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === m)));
    },

    openDesk() { setDesk(true); },
    closeDesk() { setDesk(false); },
  };
  return api;
})();
