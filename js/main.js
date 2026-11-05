// Boot, input, and the main loop. Order each frame: rules -> chart -> effects -> DOM.
window.TC = window.TC || {};

(function () {
  const $ = (id) => document.getElementById(id);
  let last = performance.now();
  let uiTimer = 0, saveTimer = 0;

  function start(hotData) {
    TC.state.load();
    if (hotData && hotData.state) Object.assign(TC.state.data, hotData.state);

    TC.chart.init($("chart"));
    TC.effects.init($("fx"));
    TC.ui.init();
    TC.ipo.init(goPublic);
    TC.news.init();
    TC.trade.init();
    TC.moves.init();
    TC.hype.init();
    TC.sound.init();
    TC.seasons.init();
    TC.debuffs.init();
    TC.achievements.init();
    TC.rivals.init();
    TC.events.on("private", () => newRun(false));
    if (!TC.state.data.listed) TC.ipo.show();
    else if (!hotData || !hotData.state) TC.offline.check();

    if (hotData && hotData.history) TC.chart.restore(hotData.history);
    else if (TC.state.data.basePrice > 0) TC.chart.fill(TC.state.data.basePrice);

    bindInput();
    TC.ui.refresh(true);
    requestAnimationFrame(loop);

    window.claude?.hot?.snapshot?.(() => ({ state: TC.state.data, history: TC.chart.snapshot() }));
  }

  // Start over. wipe = true deletes everything; false keeps founder points and achievements.
  function newRun(wipe) {
    wipe ? TC.state.reset() : TC.state.newRun();
    TC.state.save();
    TC.chart.clear();
    $("hint").classList.remove("gone");
    TC.events.emit("reset", {});
    TC.ui.closeDesk();
    TC.ui.setChartMode(TC.state.data.settings.chart);
    TC.ui.refresh(true);
    TC.ipo.show();
  }

  function goPublic(symbol) {
    const s = TC.state.data;
    s.symbol = symbol;
    s.listed = true;
    TC.ui.setSymbol(symbol);
    TC.state.save();
    TC.events.emit("ipo", { symbol });
  }

  function haptic() {
    try { navigator.vibrate && navigator.vibrate(6); } catch (e) { /* not supported */ }
  }

  function bindInput() {
    const wrap = $("chartWrap");
    // pointerdown (not click): no tap delay, and every finger in a multi-touch tap counts
    wrap.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      e.preventDefault();
      const r = wrap.getBoundingClientRect();
      TC.market.buy(e.clientX - r.left, e.clientY - r.top);
      haptic();
    });
    wrap.addEventListener("contextmenu", (e) => e.preventDefault());

    // Zoom the time window: two-finger pinch on touch, scroll wheel or trackpad pinch on desktop.
    // Taps still buy; a pinch only zooms once the fingers actually spread or close.
    const fingers = new Map();
    let pinchDist = 0;
    const dist = () => { const [a, b] = [...fingers.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
    wrap.addEventListener("pointerdown", (e) => {
      if (e.pointerType !== "touch") return;
      fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (fingers.size === 2) pinchDist = dist();
    });
    wrap.addEventListener("pointermove", (e) => {
      if (!fingers.has(e.pointerId)) return;
      fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (fingers.size !== 2 || !pinchDist) return;
      const d = dist();
      if (Math.abs(d - pinchDist) < 6) return;
      TC.chart.zoomBy(pinchDist / d); // spread fingers = fewer seconds on screen = zoom in
      pinchDist = d;
    });
    const lift = (e) => { fingers.delete(e.pointerId); if (fingers.size < 2) pinchDist = 0; };
    wrap.addEventListener("pointerup", lift);
    wrap.addEventListener("pointercancel", lift);
    wrap.addEventListener("wheel", (e) => {
      e.preventDefault();
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      TC.chart.zoomBy(Math.exp(dy * (e.ctrlKey ? 0.01 : 0.0015)));
    }, { passive: false });

    $("sell").addEventListener("click", () => {
      if (TC.market.sell()) {
        try { navigator.vibrate && navigator.vibrate([20, 40, 30]); } catch (e) { /* not supported */ }
      }
    });

    document.addEventListener("keydown", (e) => {
      if (e.code !== "Space" || e.repeat || TC.ipo.visible() || TC.offline.visible()) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLButtonElement) return;
      e.preventDefault();
      TC.market.buy();
    });

    const reset = $("reset");
    let armed = null;
    reset.addEventListener("click", () => {
      if (!armed) {
        reset.textContent = "Tap again to wipe everything, including founder points";
        reset.classList.add("armed");
        armed = setTimeout(() => {
          armed = null;
          reset.textContent = "Delist and wipe everything";
          reset.classList.remove("armed");
        }, 3000);
        return;
      }
      clearTimeout(armed); armed = null;
      reset.textContent = "Delist and wipe everything";
      reset.classList.remove("armed");
      newRun(true);
    });

    window.addEventListener("beforeunload", () => TC.state.save());
    document.addEventListener("visibilitychange", () => { if (document.hidden) TC.state.save(); });
  }

  // If something throws, keep the game running and show what broke (once) instead of freezing.
  let errorShown = false;
  function reportError(err) {
    console.error(err);
    if (errorShown) return;
    errorShown = true;
    const el = document.createElement("div");
    el.className = "err-banner";
    const where = err && err.stack ? " @ " + (err.stack.split("\n").find((l) => /\/js\//.test(l)) || "").replace(/^.*\/js\//, "").replace(/\)$/, "").trim() : "";
    el.textContent = "Something broke: " + (err && err.message ? err.message : String(err)) + where + " (the game kept running; tap to hide)";
    el.addEventListener("click", () => el.remove());
    document.body.appendChild(el);
  }
  // Only our own scripts count: ignore browser noise (ResizeObserver warnings, "Script error."
  // from cross-origin or host-page scripts), which isn't a game problem.
  window.addEventListener("error", (e) => {
    const msg = String(e.message || "");
    if (!e.filename || !/\/js\/[a-z]+\.js/.test(e.filename)) return;
    if (/ResizeObserver|^Script error/i.test(msg)) return;
    reportError(e.error || msg);
  });

  function loop(now) {
    requestAnimationFrame(loop); // schedule first, so one bad frame can't stop the game
    try { frame(now); } catch (err) { reportError(err); }
  }

  function frame(now) {
    const dt = Math.max(0, Math.min(0.1, (now - last) / 1000)); // clamp: no jump after a background tab, no negative first frame
    last = now;
    // Never let a bad number poison the save
    const s = TC.state.data;
    if (!Number.isFinite(s.basePrice) || s.basePrice < 0) s.basePrice = Math.max(0, s.bestPrice * 0.5 || 0);
    if (!Number.isFinite(s.cash)) s.cash = 0;

    TC.market.step(dt);
    TC.news.update(dt);
    TC.trade.update(dt);
    TC.moves.update(dt);
    TC.hype.update(dt);
    TC.seasons.update(dt);
    TC.debuffs.update(dt);
    TC.achievements.update(dt);
    TC.rivals.update(dt);
    const q = TC.market.quote();
    TC.chart.update(dt, q);
    TC.effects.update(dt);
    TC.events.emit("tick", { dt });

    TC.chart.draw();
    TC.effects.draw();
    TC.ui.frame(dt, q);

    if ((uiTimer += dt) > 0.1) { uiTimer = 0; TC.ui.refresh(); }
    if ((saveTimer += dt * 1000) > TC.config.saveMs) { saveTimer = 0; TC.state.save(); }
  }

  const hot = window.claude?.hot;
  hot?.ready ? hot.ready(start) : start(hot?.data ?? {});
})();
