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
    TC.overtrade.init();
    TC.dividends.init();
    TC.achievements.init();
    TC.rivals.init();
    TC.events.on("private", () => newRun(false));
    const before = TC.state.data.basePrice;
    if (!TC.state.data.listed) TC.ipo.show();
    else if (!hotData || !hotData.state) TC.offline.check();

    // Coming back: draw a believable recent history instead of a flat line.
    // If buyers pushed the price while you were away, the path climbs from where you left it.
    if (hotData && hotData.history) TC.chart.restore(hotData.history);
    else if (TC.state.data.basePrice > 0) {
      const now = TC.state.data.basePrice;
      const from = before > 0 && before < now ? before : now * (0.9 + Math.random() * 0.15);
      TC.chart.walk(from, now);
    }

    bindInput();
    TC.ui.refresh(true);
    fitChart();
    window.addEventListener("resize", fitChart);
    if (window.ResizeObserver) { const ro = new ResizeObserver(fitChart); ro.observe(document.querySelector(".tape")); ro.observe(document.querySelector(".dock")); ro.observe(document.querySelector(".desk")); }
    requestAnimationFrame(loop);

    window.claude?.hot?.snapshot?.(() => ({ state: TC.state.data, history: TC.chart.snapshot() }));
  }

  // The chart canvas fills the whole screen (see CSS). Keep the plot in the gap between header and dock,
  // and on wide screens left of the trading desk column.
  function fitChart() {
    const wrap = $("chartWrap");
    const tape = document.querySelector(".tape").getBoundingClientRect();
    const t = Math.round(tape.bottom + 6);
    const b = Math.round(window.innerHeight - document.querySelector(".dock").getBoundingClientRect().top + 26);
    let l = 10, r = 0;
    if (window.innerWidth >= 900) {
      l = Math.round(tape.left + (parseFloat(getComputedStyle(document.querySelector(".tape")).paddingLeft) || 16));
      r = Math.round(window.innerWidth - document.querySelector(".desk").getBoundingClientRect().left);
    }
    TC.chart.setPad({ t, b, l, r: r + 66 });
    wrap.style.setProperty("--plot-t", t + "px");
    wrap.style.setProperty("--plot-b", b + "px");
    wrap.style.setProperty("--plot-l", l + "px");
    wrap.style.setProperty("--plot-r", r + "px");
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
    // List at the offer price, so the chart starts there instead of at zero
    const ipo = TC.config.ipoPrice;
    if (s.basePrice < ipo) s.basePrice = ipo;
    if (s.bestPrice < ipo) s.bestPrice = ipo;
    s.dayOpen = ipo;
    TC.ui.setSymbol(symbol);
    TC.state.save();
    TC.events.emit("ipo", { symbol });
  }

  // Charge shot: tap and hold to charge, release to fire a burst of buys.
  // Charging starts after CHARGE.delay and is full after CHARGE.full seconds of holding.
  // Release fires up to CHARGE.shots buys (scaled by charge), or CHARGE.maxShots at full charge.
  // Burst buys are normal manual buys, so bear-market overtrading still applies. A second finger (pinch) cancels.
  const CHARGE = { delay: 0.25, full: 3, shots: 12, maxShots: 15, gap: 0.045 };
  let hold = null;
  let burst = null; // { left, x, y, t }
  const chargeOf = (h) => Math.max(0, Math.min(1, (h.t - CHARGE.delay) / (CHARGE.full - CHARGE.delay)));
  function releaseHold(fire) {
    const h = hold;
    hold = null;
    TC.effects.charge = null;
    if (!h || !fire || h.t < CHARGE.delay) return;
    const p = chargeOf(h);
    const n = p >= 1 ? CHARGE.maxShots : Math.round(CHARGE.shots * p);
    if (n < 1) return;
    burst = { left: n, x: h.x, y: h.y, t: 0 };
    TC.events.emit("chargeRelease", { x: h.x, y: h.y, n, max: p >= 1 });
  }
  function tickHold(dt) {
    if (hold && !TC.ipo.visible() && !TC.offline.visible()) {
      hold.t += dt;
      const p = chargeOf(hold);
      TC.effects.charge = hold.t >= CHARGE.delay ? { x: hold.x, y: hold.y, p, max: p >= 1 } : null;
      if (p >= 1 && !hold.maxed) {
        hold.maxed = true;
        TC.events.emit("chargeMax", { x: hold.x, y: hold.y });
        try { navigator.vibrate && navigator.vibrate([15, 30, 15]); } catch (e) { /* not supported */ }
      }
    }
    if (burst) {
      burst.t -= dt;
      while (burst && burst.t <= 0) {
        burst.t += CHARGE.gap;
        const a = Math.random() * Math.PI * 2, r = Math.random() * 26;
        TC.market.buy(burst.x + Math.cos(a) * r, burst.y + Math.sin(a) * r);
        if (--burst.left <= 0) burst = null;
      }
    }
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
      // Start charging (see tickHold). A second finger means a pinch: cancel the charge.
      if (hold && hold.id !== e.pointerId) releaseHold(false);
      else hold = { id: e.pointerId, x: e.clientX - r.left, y: e.clientY - r.top, t: 0, maxed: false };
    });
    wrap.addEventListener("pointermove", (e) => {
      if (!hold || e.pointerId !== hold.id) return;
      const r = wrap.getBoundingClientRect();
      hold.x = e.clientX - r.left; hold.y = e.clientY - r.top;
    });
    const release = (e) => { if (hold && e.pointerId === hold.id) releaseHold(e.type !== "pointercancel"); };
    wrap.addEventListener("pointerup", release);
    wrap.addEventListener("pointercancel", release);
    wrap.addEventListener("pointerleave", release);
    wrap.addEventListener("contextmenu", (e) => e.preventDefault());

    // Zoom like a trading chart:
    //   time axis   horizontal pinch, or scroll wheel / trackpad pinch over the plot
    //   price axis  vertical pinch, or scroll wheel over the price labels (or shift + wheel anywhere)
    //   double-tap / double-click the price labels to go back to the automatic price axis
    // Taps still buy; a pinch only zooms once the fingers actually spread or close.
    const fingers = new Map();
    let pinch = null; // { dx, dy } finger separation on each axis
    const spans = () => { const [a, b] = [...fingers.values()]; return { dx: Math.max(30, Math.abs(a.x - b.x)), dy: Math.max(30, Math.abs(a.y - b.y)) }; };
    const onAxis = (clientX) => clientX - wrap.getBoundingClientRect().left > TC.chart.bounds().r;
    wrap.addEventListener("pointerdown", (e) => {
      if (e.pointerType !== "touch") return;
      fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (fingers.size === 2) pinch = spans();
    });
    wrap.addEventListener("pointermove", (e) => {
      if (!fingers.has(e.pointerId)) return;
      fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (fingers.size !== 2 || !pinch) return;
      const now = spans();
      const fx = pinch.dx / now.dx, fy = pinch.dy / now.dy;
      // Whichever direction the fingers are moving more decides the axis
      if (Math.abs(Math.log(fy)) > Math.abs(Math.log(fx))) {
        if (Math.abs(now.dy - pinch.dy) < 6) return;
        TC.chart.zoomY(fy); // spread vertically = zoom in on price
      } else {
        if (Math.abs(now.dx - pinch.dx) < 6) return;
        TC.chart.zoomBy(fx); // spread horizontally = fewer seconds on screen
      }
      pinch = now;
    });
    let axisTapAt = 0;
    const lift = (e) => {
      if (fingers.size === 1 && !pinch && e.type === "pointerup" && onAxis(e.clientX)) {
        if (performance.now() - axisTapAt < 320) { TC.chart.resetY(); axisTapAt = 0; } else axisTapAt = performance.now();
      }
      fingers.delete(e.pointerId);
      if (fingers.size < 2) pinch = null;
    };
    wrap.addEventListener("pointerup", lift);
    wrap.addEventListener("pointercancel", lift);
    wrap.addEventListener("dblclick", (e) => { if (onAxis(e.clientX)) TC.chart.resetY(); });
    wrap.addEventListener("wheel", (e) => {
      e.preventDefault();
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      const f = Math.exp(dy * (e.ctrlKey ? 0.01 : 0.0015));
      if (e.shiftKey || onAxis(e.clientX)) TC.chart.zoomY(f);
      else TC.chart.zoomBy(f);
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

  // Adaptive quality: if frames run slow (under ~45fps) for 2s, drop the canvas glow; bring it back after 6s of smooth frames
  TC.perf = { low: false, avg: 16, slowFor: 0, fastFor: 0 };
  function trackPerf(ms) {
    const p = TC.perf;
    if (ms > 250) return; // tab switch, not a slow frame
    p.avg += (ms - p.avg) * 0.1;
    if (p.avg > 22) { p.slowFor += ms; p.fastFor = 0; } else if (p.avg < 18) { p.fastFor += ms; p.slowFor = 0; }
    if (!p.low && p.slowFor > 2000) { p.low = true; p.slowFor = 0; }
    if (p.low && p.fastFor > 6000) { p.low = false; p.fastFor = 0; }
  }

  function frame(now) {
    trackPerf(now - last);
    const dt = Math.max(0, Math.min(0.1, (now - last) / 1000)); // clamp: no jump after a background tab, no negative first frame
    last = now;
    // Never let a bad number poison the save
    const s = TC.state.data;
    if (!Number.isFinite(s.basePrice) || s.basePrice < 0) s.basePrice = Math.max(0, s.bestPrice * 0.5 || 0);
    if (!Number.isFinite(s.cash)) s.cash = 0;

    tickHold(dt);
    TC.market.step(dt);
    TC.news.update(dt);
    TC.trade.update(dt);
    TC.moves.update(dt);
    TC.hype.update(dt);
    TC.seasons.update(dt);
    TC.debuffs.update(dt);
    TC.overtrade.update(dt);
    TC.dividends.update(dt);
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
