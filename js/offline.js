// Offline earnings: buyers and dividends keep running (at reduced speed) while you're away.
window.TC = window.TC || {};

TC.offline = (() => {
  const cfg = TC.config;
  const st = () => TC.state.data;
  const $ = (id) => document.getElementById(id);

  function duration(sec) {
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
    return h ? `${h}h ${m}m` : m ? `${m}m` : `${Math.round(sec)}s`;
  }

  return {
    // Call once after loading a save, before the chart is filled. Applies the gains and shows the summary.
    check() {
      const s = st();
      if (!s.listed || !s.lastSeen) return;
      const secs = Math.min((Date.now() - s.lastSeen) / 1000, cfg.offline.maxHours * 3600);
      if (secs < cfg.offline.minSeconds) return;

      const eff = cfg.offline.efficiency;
      const ps = TC.market.perSecond() * eff;             // price per second
      const dPrice = ps * secs;
      if (dPrice < 0.01) return;
      const cashBefore = s.cash;
      TC.market.push(dPrice);                             // pays for any part above the record
      const dCash = s.cash - cashBefore;

      $("offTime").textContent = duration(secs);
      $("offPrice").textContent = "+" + TC.format.money(dPrice);
      $("offCash").textContent = "+" + TC.format.money(dCash);
      $("offSym").textContent = "$" + s.symbol;
      $("offline").hidden = false;
      $("offGo").onclick = () => {
        $("offline").hidden = true;
        TC.events.emit("offline", { secs, dPrice, dCash });
      };
    },
    visible: () => !$("offline").hidden,
  };
})();
