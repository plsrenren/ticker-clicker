// The IPO screen: the player names their ticker before the game starts.
window.TC = window.TC || {};

TC.ipo = (() => {
  const $ = (id) => document.getElementById(id);
  const SUGGESTIONS = ["MOON", "YOLO", "STONK", "BAGS", "HODL", "TEND", "PUMP", "APE", "RKT", "GAIN", "BULL", "DIAM"];
  let onDone = null;

  const clean = (v) => v.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 5);

  function sync() {
    const input = $("ipoInput");
    const v = clean(input.value);
    if (input.value !== v) input.value = v;
    $("ipoGo").disabled = v.length === 0;
    $("ipoGo").textContent = v ? `List $${v} at $0.00` : "Go public at $0.00";
  }

  function chips() {
    const box = $("ipoChips");
    box.replaceChildren();
    const pick = SUGGESTIONS.slice().sort(() => Math.random() - 0.5).slice(0, 4);
    for (const s of pick) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "chip";
      b.textContent = "$" + s;
      b.addEventListener("click", () => { $("ipoInput").value = s; sync(); });
      box.appendChild(b);
    }
  }

  return {
    init(done) {
      onDone = done;
      $("ipoInput").addEventListener("input", sync);
      $("ipoForm").addEventListener("submit", (e) => {
        e.preventDefault();
        const v = clean($("ipoInput").value);
        if (!v) return;
        $("ipo").hidden = true;
        $("ipoInput").blur();
        onDone && onDone(v);
      });
    },
    show() {
      $("ipoInput").value = "";
      chips();
      sync();
      $("ipo").hidden = false;
      // Autofocus only with a mouse/keyboard; on phones the keyboard would cover the suggestions.
      if (window.matchMedia("(hover: hover)").matches) setTimeout(() => $("ipoInput").focus(), 50);
    },
    visible: () => !$("ipo").hidden,
  };
})();
