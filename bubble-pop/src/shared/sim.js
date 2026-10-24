// Pretend camera for testing without a person in front of a camera. Open any game with ?sim in the address.
// Keyboard for player 1: arrows step left/right, Up jumps, Down crouches, H raises a hand; the mouse moves the right hand.
// Automated tests can set window.__sim.players[i] directly: { cx, cy, sw, lh: {x, y}, rh: {x, y}, up, duck }, in 0..1 frame units.

const W = 1280, H = 720;

export async function createSimTracker({ players = 1 } = {}) {
  const video = document.createElement('canvas');
  video.width = W;
  video.height = H;
  const g = video.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, '#556677');
  grad.addColorStop(1, '#223344');
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);

  const person = (cx) => ({ cx, cy: 0.42, sw: 0.1, lh: null, rh: null, up: false, duck: false, jumpUntil: 0 });
  const sim = { count: players, players: [person(0.3), person(0.7)], paused: false };
  if (players === 1) sim.players[0].cx = 0.5;
  window.__sim = sim;

  window.addEventListener('keydown', (e) => {
    const p = sim.players[0];
    if (e.key === 'ArrowLeft') p.cx -= 0.04;
    if (e.key === 'ArrowRight') p.cx += 0.04;
    if (e.key === 'ArrowUp') p.jumpUntil = performance.now() + 450;
    if (e.key === 'ArrowDown') p.duck = true;
    if (e.key === 'h' || e.key === 'H') p.up = !p.up;
  });
  window.addEventListener('keyup', (e) => { if (e.key === 'ArrowDown') sim.players[0].duck = false; });
  window.addEventListener('pointermove', (e) => {
    sim.players[0].rh = { x: e.clientX / window.innerWidth, y: e.clientY / window.innerHeight };
  });

  let lastFrame = 0;
  return {
    video,
    delegate: 'SIM',
    async setPlayers(n) { sim.count = n; },
    detect(now) {
      if (sim.paused || now - lastFrame < 33) return null; // about 30 tracking frames per second, like a real camera
      lastFrame = now;
      const out = [];
      for (let i = 0; i < sim.count; i++) {
        const p = sim.players[i];
        if (p && !p.hidden) out.push({ player: i, lm: pose(p, now) });
      }
      return out;
    },
  };
}

// Builds 33 MediaPipe-style landmarks (mirrored frame, 0..1) from a few body parameters.
function pose(p, now) {
  const sw = p.sw * W; // shoulder width in pixels
  let cy = p.cy * H;
  if (now < p.jumpUntil) cy -= sw * 0.6;
  if (p.duck) cy += sw * 0.9;
  const cx = p.cx * W;
  const pts = Array.from({ length: 33 }, () => ({ x: cx, y: cy, visibility: 0.95 }));
  const set = (i, x, y) => { pts[i] = { x, y, visibility: 0.95 }; };
  set(0, cx, cy - sw * 0.75);
  set(11, cx - sw / 2, cy);
  set(12, cx + sw / 2, cy);
  const lh = p.lh ? { x: p.lh.x * W, y: p.lh.y * H } : { x: cx - sw * 0.7, y: p.up ? cy - sw * 1.6 : cy + sw * 1.2 };
  const rh = p.rh ? { x: p.rh.x * W, y: p.rh.y * H } : { x: cx + sw * 0.7, y: p.up ? cy - sw * 1.6 : cy + sw * 1.2 };
  set(13, (cx - sw / 2 + lh.x) / 2, (cy + lh.y) / 2 + sw * 0.1);
  set(14, (cx + sw / 2 + rh.x) / 2, (cy + rh.y) / 2 + sw * 0.1);
  set(15, lh.x, lh.y);
  set(16, rh.x, rh.y);
  set(19, lh.x, lh.y - sw * 0.15);
  set(20, rh.x, rh.y - sw * 0.15);
  set(23, cx - sw * 0.35, cy + sw * 1.5);
  set(24, cx + sw * 0.35, cy + sw * 1.5);
  set(25, cx - sw * 0.35, cy + sw * 2.4);
  set(26, cx + sw * 0.35, cy + sw * 2.4);
  set(27, cx - sw * 0.35, cy + sw * 3.2);
  set(28, cx + sw * 0.35, cy + sw * 3.2);
  return pts.map((q) => ({ x: q.x / W, y: q.y / H, visibility: q.visibility }));
}
