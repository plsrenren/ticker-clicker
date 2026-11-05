window.TC = window.TC || {};

TC.format = {
  money(n) {
    if (!isFinite(n)) return "$∞";
    const sign = n < 0 ? "-" : "";
    n = Math.abs(n);
    if (n < 1000) return sign + "$" + n.toFixed(2);
    const units = ["K", "M", "B", "T", "Qa", "Qi", "Sx", "Sp", "Oc", "No", "Dc"];
    let i = -1;
    while (n >= 1000 && i < units.length - 1) { n /= 1000; i++; }
    return sign + "$" + n.toFixed(n < 10 ? 2 : n < 100 ? 1 : 0) + units[i];
  },
  // Compact axis label without cents for whole numbers.
  axis(n) {
    if (n === 0) return "$0";
    if (n < 10) return "$" + n.toFixed(n % 1 ? 2 : 0);
    if (n < 1000) return "$" + Math.round(n);
    return TC.format.money(n);
  },
  pct(n) { return (n >= 0 ? "+" : "") + (n * 100).toFixed(2) + "%"; },
  int(n) { return Math.floor(n).toLocaleString("en-US"); },
};
