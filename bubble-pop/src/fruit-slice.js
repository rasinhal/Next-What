// Fruit Slice: fruit is thrown up into the air; swipe your hands through it fast to slice it. Don't hit the bombs.
// Two players share one screen; each slices on their own half and keeps their own score.
import { runGame } from './shared/shell.js';
import { PLAYER_COLORS } from './shared/players.js';
import { sfx } from './shared/sound.js';
import { Fx, HandPaths, distToSegment } from './shared/fx.js';

// gap: seconds between throws. swipe: hand speed (shoulder widths per second) that slices. size: fruit radius (screen heights).
const LEVELS = {
  little: { gap: 1.1, wave: 1, gravity: 0.9, swipe: 1.2, size: 0.085, bombs: 0 },
  kids: { gap: 0.85, wave: 2, gravity: 1.1, swipe: 2, size: 0.07, bombs: 0.08 },
  big: { gap: 0.65, wave: 3, gravity: 1.3, swipe: 2.8, size: 0.06, bombs: 0.15 },
};
const FRUITS = [
  { name: 'melon', skin: '#2e9e44', flesh: '#ff4d5e', juice: '#ff4d5e' },
  { name: 'orange', skin: '#ff9f1c', flesh: '#ffc46b', juice: '#ffb347' },
  { name: 'apple', skin: '#e63946', flesh: '#fff1d0', juice: '#ffe08a' },
  { name: 'lemon', skin: '#ffe14d', flesh: '#fff6b0', juice: '#fff176' },
  { name: 'grape', skin: '#8e44ad', flesh: '#d7b4f0', juice: '#c39bd3' },
];
const COMBO_WINDOW = 0.3;

class FruitSlice {
  constructor({ view, level, count }) {
    this.view = view;
    this.level = level;
    this.count = count;
  }

  begin() {
    this.items = [];
    this.halves = [];
    this.scores = [0, 0];
    this.bombsHit = [0, 0];
    this.best = [0, 0];
    this.combo = [{ n: 0, t: 0 }, { n: 0, t: 0 }];
    this.trails = new Map();
    this.paths = new HandPaths();
    this.fx = new Fx();
    this.nextThrow = 0.6;
    this.t = 0;
    this.done = false;
  }

  hud() {
    if (this.count === 1) return [`${this.scores[0]} sliced`];
    return [`P1 ${this.scores[0]}`, `${this.scores[1]} P2`];
  }

  result() {
    const [a, b] = this.scores;
    if (this.count === 1) {
      const lines = [`Best combo: ${this.best[0]}`];
      if (this.bombsHit[0]) lines.push(`${this.bombsHit[0]} bomb${this.bombsHit[0] > 1 ? 's' : ''} hit`);
      return { score: a, title: 'Great slicing!', lines };
    }
    return {
      score: `${a} : ${b}`,
      title: a === b ? "It's a tie!" : `Player ${a > b ? 1 : 2} wins!`,
      lines: [`Best combos: ${this.best[0]} and ${this.best[1]}`],
    };
  }

  // Throws rise from below the screen and peak somewhere in the top half. With two players,
  // throws alternate halves so each player gets the same amount of fruit.
  throwWave() {
    const v = this.view, L = this.level;
    const g = v.h * L.gravity;
    const n = 1 + Math.floor(Math.random() * L.wave);
    for (let i = 0; i < n; i++) {
      const half = this.count === 2 ? (this.items.length + i + Math.floor(this.t)) % 2 : -1;
      const lo = half === 1 ? 0.55 : 0.12, hi = half === 0 ? 0.45 : 0.88;
      const x = v.x + v.w * (lo + Math.random() * (hi - lo));
      const peak = v.y + v.h * (0.15 + Math.random() * 0.3);
      const y = v.y + v.h + v.h * L.size;
      const vy = -Math.sqrt(2 * g * (y - peak));
      const mid = v.x + (half === 0 ? v.w * 0.25 : half === 1 ? v.w * 0.75 : v.w / 2);
      const vx = ((mid - x) / 2.2) * Math.random();
      const bomb = Math.random() < L.bombs;
      this.items.push({
        x, y, vx, vy, r: v.h * L.size * (bomb ? 0.9 : 0.9 + Math.random() * 0.3),
        rot: Math.random() * 6, vr: (Math.random() - 0.5) * 4,
        kind: bomb ? null : FRUITS[Math.floor(Math.random() * FRUITS.length)], bomb,
      });
    }
    sfx.jump();
  }

  update(dt, now, players) {
    const v = this.view, L = this.level;
    const g = v.h * L.gravity;
    this.t += dt;
    this.fx.update(dt);

    this.nextThrow -= dt;
    if (this.nextThrow <= 0) {
      this.throwWave();
      this.nextThrow = L.gap * (0.7 + Math.random() * 0.6);
    }

    for (const it of this.items) {
      it.vy += g * dt;
      it.x += it.vx * dt;
      it.y += it.vy * dt;
      it.rot += it.vr * dt;
    }
    for (const h of this.halves) {
      h.vy += g * dt;
      h.x += h.vx * dt;
      h.y += h.vy * dt;
      h.rot += h.vr * dt;
    }

    const segs = this.paths.segments(players);
    this.updateTrails(segs, now);
    for (const s of segs) {
      if (s.speed < L.swipe) continue;
      const reach = s.sw * 0.25;
      for (const it of this.items) {
        if (it.cut) continue;
        if (distToSegment(it.x, it.y, s.x1, s.y1, s.x2, s.y2) > it.r + reach) continue;
        it.cut = true;
        this.slice(it, s, now);
      }
    }
    this.items = this.items.filter((it) => !it.cut && it.y < v.y + v.h + it.r * 3);
    this.halves = this.halves.filter((h) => h.y < v.y + v.h + h.r * 3);
    for (const c of this.combo) if (this.t - c.t > COMBO_WINDOW) c.n = 0;
  }

  slice(it, s, now) {
    const who = s.owner;
    if (it.bomb) {
      this.scores[who] = Math.max(0, this.scores[who] - 3);
      this.bombsHit[who]++;
      this.fx.burst(it.x, it.y, '#ffb703', { n: 30, speed: this.view.h * 0.9, size: this.view.h * 0.012 });
      this.fx.burst(it.x, it.y, '#444', { n: 16, speed: this.view.h * 0.5, size: this.view.h * 0.016 });
      this.fx.text(it.x, it.y, '-3', '#ff6b6b', this.view.h * 0.07);
      this.fx.bump(this.view.h * 0.04);
      sfx.crash();
      return;
    }
    const c = this.combo[who];
    c.n = this.t - c.t <= COMBO_WINDOW ? c.n + 1 : 1;
    c.t = this.t;
    const points = c.n >= 3 ? 2 : 1;
    this.scores[who] += points;
    this.best[who] = Math.max(this.best[who], c.n);
    // Two halves fly apart across the cut direction.
    const dx = s.x2 - s.x1, dy = s.y2 - s.y1;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;
    const push = this.view.h * 0.35;
    const angle = Math.atan2(dy, dx);
    for (const side of [-1, 1]) {
      this.halves.push({ x: it.x, y: it.y, r: it.r, kind: it.kind, vx: it.vx + nx * push * side, vy: it.vy * 0.3 + ny * push * side, rot: angle, vr: side * 3, side });
    }
    this.fx.burst(it.x, it.y, it.kind.juice, { n: 14, speed: this.view.h * 0.6, size: this.view.h * 0.01 });
    if (c.n >= 3) {
      this.fx.text(it.x, it.y - it.r, `Combo x${c.n}!`, '#ffd23f', this.view.h * 0.06);
      sfx.cheer();
    }
    sfx.bat();
  }

  // Short glowing trail behind each fast-moving hand, drawn from the last few positions.
  updateTrails(segs, now) {
    for (const s of segs) {
      let tr = this.trails.get(s.key);
      if (!tr) { tr = []; this.trails.set(s.key, tr); }
      tr.push({ x: s.x2, y: s.y2, t: now, fast: s.speed >= this.level.swipe, owner: s.owner });
    }
    for (const tr of this.trails.values()) while (tr.length && now - tr[0].t > 180) tr.shift();
  }

  draw(ctx) {
    this.fx.applyShake(ctx);
    for (const h of this.halves) this.drawHalf(ctx, h);
    for (const it of this.items) (it.bomb ? this.drawBomb : this.drawFruit).call(this, ctx, it);
    for (const tr of this.trails.values()) {
      if (tr.length < 2) continue;
      const color = this.count === 2 ? PLAYER_COLORS[tr[0].owner] : '#ffffff';
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (let i = 1; i < tr.length; i++) {
        if (!tr[i].fast) continue;
        const k = i / tr.length;
        ctx.strokeStyle = color;
        ctx.globalAlpha = 0.3 + k * 0.6;
        ctx.lineWidth = this.view.h * 0.02 * k + 2;
        ctx.beginPath();
        ctx.moveTo(tr[i - 1].x, tr[i - 1].y);
        ctx.lineTo(tr[i].x, tr[i].y);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    this.fx.draw(ctx);
    ctx.restore();
  }

  drawFruit(ctx, it) {
    const k = it.kind;
    ctx.save();
    ctx.translate(it.x, it.y);
    ctx.rotate(it.rot);
    ctx.fillStyle = k.skin;
    ctx.beginPath();
    if (k.name === 'lemon') ctx.ellipse(0, 0, it.r * 1.15, it.r * 0.85, 0, 0, Math.PI * 2);
    else ctx.arc(0, 0, it.r, 0, Math.PI * 2);
    ctx.fill();
    if (k.name === 'melon') {
      ctx.strokeStyle = '#1b6b2c';
      ctx.lineWidth = it.r * 0.12;
      for (const a of [-0.5, 0, 0.5]) {
        ctx.beginPath();
        ctx.ellipse(0, 0, it.r * Math.abs(Math.sin(a + 1.2)) * 0.9, it.r * 0.95, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    if (k.name === 'grape') {
      ctx.fillStyle = '#a569bd';
      for (const [gx, gy] of [[-0.4, -0.3], [0.35, -0.25], [0, 0.35], [-0.3, 0.3], [0.35, 0.3]]) {
        ctx.beginPath(); ctx.arc(gx * it.r, gy * it.r, it.r * 0.35, 0, Math.PI * 2); ctx.fill();
      }
    }
    if (k.name === 'apple' || k.name === 'orange') {
      ctx.fillStyle = '#3a7d2c';
      ctx.beginPath(); ctx.ellipse(it.r * 0.25, -it.r * 1.0, it.r * 0.25, it.r * 0.12, -0.5, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath(); ctx.arc(-it.r * 0.35, -it.r * 0.35, it.r * 0.25, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  drawHalf(ctx, h) {
    ctx.save();
    ctx.translate(h.x, h.y);
    ctx.rotate(h.rot);
    const start = h.side > 0 ? 0 : Math.PI;
    ctx.fillStyle = h.kind.skin;
    ctx.beginPath(); ctx.arc(0, 0, h.r, start, start + Math.PI); ctx.closePath(); ctx.fill();
    ctx.fillStyle = h.kind.flesh;
    ctx.beginPath(); ctx.arc(0, 0, h.r * 0.82, start, start + Math.PI); ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  drawBomb(ctx, it) {
    ctx.save();
    ctx.translate(it.x, it.y);
    ctx.fillStyle = '#222';
    ctx.beginPath(); ctx.arc(0, 0, it.r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#ff3b3b';
    ctx.lineWidth = it.r * 0.12;
    ctx.beginPath(); ctx.arc(0, 0, it.r * 0.92, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = '#a0522d';
    ctx.lineWidth = it.r * 0.1;
    ctx.beginPath(); ctx.moveTo(0, -it.r); ctx.quadraticCurveTo(it.r * 0.3, -it.r * 1.4, it.r * 0.5, -it.r * 1.3); ctx.stroke();
    // Flickering spark on the fuse.
    ctx.fillStyle = Math.random() < 0.5 ? '#ffd23f' : '#ff7b00';
    ctx.beginPath(); ctx.arc(it.r * 0.5, -it.r * 1.3, it.r * (0.15 + Math.random() * 0.1), 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = `900 ${Math.round(it.r * 0.9)}px ui-rounded, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('✕', 0, it.r * 0.05);
    ctx.textBaseline = 'alphabetic';
    ctx.restore();
  }
}

runGame({
  title: 'Fruit Slice',
  lead: 'Fruit flies up into the air. Swipe your hands through it fast to slice it!',
  howTo: ['Swipe fast through the fruit', 'Slice 3 quickly for a combo', 'Watch out for bombs: they cost 3 points', 'Use both hands'],
  tint: 'rgba(40, 20, 10, 0.35)',
  scene: false,
  split: false,
  seconds: 60,
  levels: LEVELS,
  create: (opts) => new FruitSlice(opts),
});
