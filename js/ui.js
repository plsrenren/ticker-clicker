// DOM side: the quote tape, the buyer desk, the buy button text.
window.TC = window.TC || {};

TC.ui = (() => {
  const $ = (id) => document.getElementById(id);
  const cfg = TC.config, f = TC.format;
  const st = () => TC.state.data;
  const rows = {}; // id -> { btn, name, desc, cost, count }
  let lastPrice = 0;
  let flashTimer = 0;

  // One-line rows: name + short effect on the left, count and price on the right.
  // The flavor text lives in the tooltip (title) to keep rows compact.
  function makeRow(item, kind, listEl) {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "item";
    btn.title = item.desc;
    btn.innerHTML =
      '<span class="item-main"><span class="item-name"></span><span class="item-desc"></span></span>' +
      '<span class="item-count"></span><span class="item-cost"></span>';
    btn.addEventListener("click", () => {
      if (kind === "generator") TC.market.buyGenerators(item.id, buyCount(item));
      else TC.market.buyUpgrade(item.id);
      api.refresh(true);
    });
    li.appendChild(btn);
    listEl.appendChild(li);
    const main = btn.children[0];
    rows[item.id] = {
      li, btn,
      name: main.children[0], desc: main.children[1], count: btn.children[1], cost: btn.children[2],
    };
  }

  // x1 / x10 / Max for buyers
  const qty = () => st().settings.buyQty || "1";
  function buyCount(g) {
    const q = qty();
    if (q === "max") return Math.max(1, TC.market.generatorMax(g));
    return +q;
  }

  // Short effect text for an upgrade ("2x taps", "1.5x cash" ...)
  function upgradeEffect(u) {
    if (u.kind === "mult") return u.value + "x taps";
    if (u.kind === "gen") return u.value + "x buyers";
    if (u.kind === "yield") return u.value + "x cash from highs";
    if (u.kind === "dividend") return "pays cash, price −" + +(u.value * 100).toFixed(1) + "% / 30s";
    if (u.kind === "perk") return u.short;
    if (u.kind === "cpsPct") return "taps add " + Math.round(u.value * 100) + "% of buyers";
    return u.desc;
  }

  // A thing is revealed once the player has come within reach of it.
  const seen = (it) => st().bestPrice >= it.reveal * 0.3;

  function renderList(items, kind) {
    let shownLocked = false;
    for (const it of items) {
      const r = rows[it.id];
      const owned = kind === "generator" ? st().owned[it.id] || 0 : st().upgrades[it.id];
      const cost = kind === "generator" ? TC.market.generatorCost(it) : it.cost;
      const visible = owned || seen(it);

      if (!visible) {
        // Tease exactly one locked entry per list.
        r.li.hidden = shownLocked;
        shownLocked = true;
        r.btn.classList.add("locked");
        r.btn.disabled = true;
        r.name.textContent = "???";
        r.desc.textContent = "Reach " + f.money(TC.market.marketCap(it.reveal * 0.3)) + " market cap";
        r.cost.textContent = "";
        r.count.textContent = "";
        continue;
      }

      r.li.hidden = false;
      r.btn.classList.remove("locked");
      r.name.textContent = it.name;
      if (kind === "generator") {
        const sm = (TC.seasons ? TC.seasons.genMult(it.id) : 1) * (TC.debuffs ? TC.debuffs.genMult(it.id) : 1);
        r.desc.textContent = "+" + f.money(TC.market.px(it.rate * TC.market.genMult() * sm)) + "/s each" +
          (sm < 1 ? " · −" + Math.round((1 - sm) * 100) + "% now" : "");
        r.desc.classList.toggle("nerfed", sm < 1);
        const n = buyCount(it);
        const total = n === 1 ? cost : TC.market.generatorCostN(it, n);
        r.count.textContent = owned || "";
        r.cost.textContent = (n > 1 ? "x" + n + " " : "") + f.money(total);
        r.btn.disabled = st().cash < total;
      } else {
        // Bought upgrades move to the collapsed "Owned" list
        const target = owned ? $("ownedUpgrades") : $("upgrades");
        if (r.li.parentElement !== target) target.appendChild(r.li);
        r.desc.textContent = upgradeEffect(it);
        r.count.textContent = owned ? "✓" : "";
        r.cost.textContent = owned ? "" : f.money(cost);
        r.btn.classList.toggle("owned", !!owned);
        r.btn.disabled = !!owned || st().cash < cost;
      }
    }
  }

  function sortUpgrades() {
    const list = $("upgrades");
    for (const u of cfg.upgrades) if (rows[u.id].li.parentElement === list) list.appendChild(rows[u.id].li);
  }

  // ---- Desk tabs, buy amount, owned toggle ----
  function setTab(tab) {
    st().settings.deskTab = tab;
    document.querySelectorAll("#deskTabs [data-tab]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === tab)));
    document.querySelectorAll(".pane").forEach((p) => { p.hidden = p.dataset.pane !== tab; });
  }
  function bindTabs() {
    $("deskTabs").addEventListener("click", (e) => {
      const b = e.target.closest("[data-tab]");
      if (b) { setTab(b.dataset.tab); markSeen(b.dataset.tab); }
    });
    setTab(st().settings.deskTab || "buyers");
    const paintQty = () => document.querySelectorAll("#buyQty button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.qty === qty())));
    $("buyQty").addEventListener("click", (e) => {
      const b = e.target.closest("[data-qty]");
      if (!b) return;
      st().settings.buyQty = b.dataset.qty;
      paintQty();
      api.refresh(true);
    });
    paintQty();
    $("ownedToggle").addEventListener("click", () => {
      const open = $("ownedUpgrades").hidden;
      $("ownedUpgrades").hidden = !open;
      $("ownedToggle").setAttribute("aria-expanded", String(open));
      api.refresh(true);
    });
  }

  // New-player hints: the Trading desk button and each desk tab shine until pressed once (settings.seen, kept forever)
  const pressed = () => (st().settings.seen = st().settings.seen || {});
  function paintShine() {
    $("openDesk").dataset.shine = pressed().desk ? "" : "1";
    document.querySelectorAll("#deskTabs [data-tab]").forEach((b) => { b.dataset.shine = pressed()[b.dataset.tab] ? "" : "1"; });
  }
  function markSeen(key) {
    if (pressed()[key]) return;
    pressed()[key] = true;
    paintShine();
    TC.state.save();
  }

  function setDesk(open) {
    $("desk").classList.toggle("open", open);
    $("scrim").hidden = !open;
    $("openDesk").setAttribute("aria-expanded", String(open));
  }

  // Bottom sheet: open from the dock, close by tapping the scrim, Escape, or dragging the handle down.
  function bindDesk() {
    $("openDesk").addEventListener("click", () => { setDesk(true); markSeen("desk"); });
    TC.events.on("reset", paintShine);
    paintShine();
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
    const btn = $("goPrivate");
    const unlocked = TC.prestige.unlocked();
    $("privateCard").classList.toggle("ready", unlocked);
    $("privateText").hidden = !unlocked;
    btn.hidden = !unlocked;
    // Log scale so early progress is visible: $1 -> 0%, $1M -> 100%
    const prog = Math.max(0, Math.min(1, Math.log10(Math.max(1, s.bestPrice)) / Math.log10(pc.minPrice)));
    $("privateFill").style.width = (prog * 100).toFixed(1) + "%";
    $("privatePts").textContent = unlocked
      ? f.int(s.prestige.points) + " pts · " + bonus(s.prestige.points)
      : f.axis(TC.market.marketCap(s.bestPrice)) + " / " + f.axis(TC.market.marketCap(pc.minPrice)) + " cap";
    if (!unlocked) {
      btn.disabled = true;
    } else {
      $("privateText").textContent = "Take " + f.int(pts) + " founder points (" + bonus(pts) + " forever, " + TC.prestige.stakeMult().toFixed(2) + "x from your " + (TC.market.stakePct() * 100).toFixed(1) + "% stake). Your price, cash, buyers and upgrades reset, and you list again under a new name.";
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
      bindTabs();
      $("buyback").addEventListener("click", () => { TC.market.buyback(); api.refresh(true); });
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
      $("stakeLine").textContent = "Your stake " + (TC.market.stakePct() * 100).toFixed(1) + "% · " + f.money(TC.market.stakeValue(quote));
      $("sharePrice").textContent = f.money(TC.market.px(quote));
      const open = st().dayOpen;
      const diff = quote - open;
      const ch = $("change");
      ch.textContent = (diff >= 0 ? "+" : "-") + f.money(TC.market.px(Math.abs(diff))).slice(1) +
        " (" + (open > 0 ? f.pct(diff / open) : diff > 0 ? "IPO" : "0.00%") + ")";
      ch.className = "change " + (diff > 0.004 ? "up" : diff < -0.004 ? "down" : "flat");
      lastPrice = quote;
    },

    refresh(force) {
      $("cash").textContent = f.money(st().cash);
      $("income").textContent = f.money(TC.market.income()) + "/s";
      $("perClick").textContent = "+" + f.money(TC.market.px(TC.market.perClick()));
      $("perSec").textContent = "+" + f.money(TC.market.px(TC.market.perSecond())) + "/s";
      const s = st(), below = s.bestPrice - s.basePrice;
      $("holdings").textContent = "How cash works: every $1 your price climbs above its record (" + f.money(s.bestPrice) + ") sells a sliver of your stake for " +
        f.money(TC.market.cashPerDollar()) + ". SELL dumps 3% of your shares. Buy back in dips to grow it again." + (below > 0.005 ? " You're " + f.money(below) + " below it right now." : "");

      // Sell button
      const sb = $("sell"), cd = TC.market.sellCooldown();
      sb.disabled = !TC.market.canSell();
      sb.style.setProperty("--cd", (cd / cfg.sell.cooldown).toFixed(3));
      const bonus = TC.market.sellBonus();
      sb.classList.toggle("peak", bonus > 1 && TC.market.canSell());
      sb.classList.toggle("risky", bonus <= 1 && TC.market.canSell() && TC.market.sellingIntoCrash());
      $("sellSub").textContent =
        st().basePrice < cfg.sell.minPrice ? "Reach " + f.money(cfg.sell.minPrice) + " to sell" :
        cd > 0 ? "Ready in " + Math.ceil(cd) + "s" :
        bonus > 1 ? "PEAK " + bonus + "x size · +" + f.money(TC.market.sellValue()) :
        TC.market.sellingIntoCrash() ? "+" + f.money(TC.market.sellValue()) + " · CRASH: price −" + Math.round(TC.market.sellDrop() * 100) + "%" :
        "+" + f.money(TC.market.sellValue()) + " · half price off-peak";
      sb.title = "Sells " + (TC.market.sellFrac() * 100).toFixed(0) + "% of your shares";

      // Buy-the-dip button during event dips
      const dip = TC.trade.dipReady();
      $("dipBtn").hidden = !dip;
      if (dip) {
        const n = TC.market.dipStakeShares();
        $("dipSub").textContent = "−" + Math.round(TC.trade.dipDepth() * 100) + "% · " +
          (n >= 1 ? "+" + +(n / cfg.sharesOutstanding * 100).toFixed(2) + "% stake for " + f.money(n * st().basePrice) : "stack 12 orders");
      }
      $("orders").textContent = f.int(st().orders) + (st().orders === 1 ? " order filled" : " orders filled");
      renderList(cfg.generators, "generator");
      renderList(cfg.upgrades, "upgrade");
      sortUpgrades();
      const ownedN = cfg.upgrades.filter((u) => st().upgrades[u.id]).length;
      const tog = $("ownedToggle");
      tog.hidden = ownedN === 0;
      tog.textContent = "Owned upgrades · " + ownedN + ($("ownedUpgrades").hidden ? "  ▾" : "  ▴");
      if (!ownedN) $("ownedUpgrades").hidden = true;
      const upN = cfg.upgrades.filter((u) => seen(u) && !st().upgrades[u.id] && st().cash >= u.cost).length;
      $("upBadge").hidden = upN === 0;
      $("upBadge").textContent = upN;
      renderPrivate();
      // Founder stake card
      $("stakePct").textContent = (TC.market.stakePct() * 100).toFixed(2) + "%";
      $("stakeVal").textContent = f.money(TC.market.stakeValue(st().basePrice));
      const bb = $("buyback");
      const full = st().shares + cfg.stake.buyback > cfg.stake.max;
      bb.disabled = !TC.market.canBuyback();
      const off = TC.market.buybackDiscount();
      bb.textContent = full ? "Stake maxed at 25%" : "Buy back " + +(cfg.stake.buyback / cfg.sharesOutstanding * 100).toFixed(2) + "% · " + f.money(TC.market.buybackCost()) + (off >= 0.01 ? " · BEAR " + Math.round(off * 100) + "% OFF" : "");
      bb.dataset.bear = TC.market.buybackBear() && !full ? "1" : "";
      renderAchievements();

      // Badge: how many things you can buy right now
      const n = cfg.generators.filter((g) => seen(g) && st().cash >= TC.market.generatorCost(g)).length +
        cfg.upgrades.filter((u) => seen(u) && !st().upgrades[u.id] && st().cash >= u.cost).length;
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
