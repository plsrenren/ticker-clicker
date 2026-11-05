// The IPO screen: the player names their ticker before the game starts.
window.TC = window.TC || {};

TC.ipo = (() => {
  const $ = (id) => document.getElementById(id);
  let onDone = null;

  const clean = (v) => v.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 5);

  function sync() {
    const input = $("ipoInput");
    const v = clean(input.value);
    if (input.value !== v) input.value = v;
    $("ipoGo").disabled = v.length === 0;
    const at = "$" + TC.config.ipoPrice.toFixed(2);
    $("ipoGo").textContent = v ? `List $${v} at ${at}` : `Go public at ${at}`;
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
      sync();
      $("ipo").hidden = false;
      // Autofocus only with a mouse/keyboard; on phones the keyboard would pop up over the screen.
      if (window.matchMedia("(hover: hover)").matches) setTimeout(() => $("ipoInput").focus(), 50);
    },
    visible: () => !$("ipo").hidden,
  };
})();
