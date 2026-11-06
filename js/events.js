// Tiny event bus. Game logic emits, visuals subscribe. New effects should hook in
// here instead of being wired into game code.
//
// Events emitted today:
//   "buy"       { amount, x, y, manual }   a manual buy (x/y are chart-local px, or null for keyboard/button)
//   "sell"      { amount, cash, manual }   price dropped: manual = you sold (cash = what you got), else profit-takers (cosmetic)
//   "rally"     { amount, source }         price pushed up by a market event
//   "news"      { type, tone, big }        a market event started or resolved (tone: up/down/neutral)
//   "newsEnd"   { type, saved }            a market event finished
//   "private"   { points, total, symbol, best, secs }  went private (main.js starts a new run)
//   "offline"   { secs, dPrice, dCash }    collected offline earnings
//   "achievement" { id, name }
//   "purchase"  { kind, id, cost }         bought a generator or upgrade
//   "milestone" { price }                  price crossed a power of ten
//   "tick"      { dt }                     every animation frame
//   "ipo"       { symbol }                 player named their ticker and listed
//   "reset"     {}
window.TC = window.TC || {};

TC.events = (() => {
  const handlers = {};
  return {
    on(name, fn) { (handlers[name] ||= []).push(fn); return () => this.off(name, fn); },
    off(name, fn) { handlers[name] = (handlers[name] || []).filter((h) => h !== fn); },
    emit(name, payload) { (handlers[name] || []).forEach((h) => h(payload)); },
  };
})();
