// TV remotes send arrow keys: move focus between game cards with them.
const cards = [...document.querySelectorAll('.game')];
cards[0].focus({ preventScroll: true });
window.addEventListener('keydown', (e) => {
  const i = cards.indexOf(document.activeElement);
  const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
  if (!step) return;
  e.preventDefault();
  cards[(Math.max(i, 0) + step + cards.length) % cards.length].focus();
});
