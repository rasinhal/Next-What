// Mole Smash: moles pop up all around you. Bop them with your hands before they hide. Gold moles are worth 3.
import { runGame } from './shared/shell.js';
import { PLAYER_COLORS } from './shared/players.js';
import { sfx } from './shared/sound.js';
import { Fx, HandPaths, distToSegment } from './shared/fx.js';

// up: seconds a mole stays up. gap: seconds between new moles. max: moles up at once. reach: hit size, in shoulder widths.
const LEVELS = {
  little: { up: 2.4, gap: 1.0, max: 2, reach: 0.75 },
  kids: { up: 1.6, gap: 0.75, max: 2, reach: 0.6 },
  big: { up: 1.05, gap: 0.5, max: 3, reach: 0.5 },
};
// Holes around the body, in shoulder widths from the middle of the shoulders: all within arm's reach.
const HOLES = [[-2.3, -1.5], [0, -2.3], [2.3, -1.5], [-2.7, 0.4], [2.7, 0.4], [-1.9, 2.1], [1.9, 2.1]];
const GOLD_CHANCE = 0.12;

class MoleSmash {
  constructor({ view, level, id, count }) {
    this.view = view;
    this.level = level;
    this.color = count === 2 ? PLAYER_COLORS[id] : '#ffd23f';
  }

  begin(player) {
    this.score = 0;
    this.hits = 0;
    this.misses = 0;
    this.holes = null;
    this.moles = [];
    this.next = 0.8;
    this.fx = new Fx();
    this.paths = new HandPaths();
    this.done = false;
    this.placeHoles(player);
  }

  placeHoles(p) {
    if (!p || !p.present) return;
    const v = this.view;
    const sw = p.sw;
    const r = sw * 0.55;
    this.holes = HOLES.map(([dx, dy]) => ({
      x: Math.max(v.x + r * 1.2, Math.min(v.x + v.w - r * 1.2, p.center.x + dx * sw)),
      // Keep holes on screen and below the score bar, where a mole's head is never hidden.
      y: Math.max(v.y + v.h * 0.14 + r * 2, Math.min(v.y + v.h - r * 1.2, p.center.y + dy * sw)),
      r,
      busy: false,
    }));
    this.sw = sw;
  }

  hud() {
    return `${this.score} pts`;
  }

  result() {
    const total = this.hits + this.misses;
    return { score: this.score, title: 'Smashing!', lines: [`${this.hits} moles bopped`, total ? `${Math.round((this.hits * 100) / total)}% caught` : ''] };
  }

  update(dt, now, p) {
    const L = this.level;
    this.fx.update(dt);
    if (!this.holes) this.placeHoles(p);
    const segs = this.paths.segments([p]);
    if (!this.holes) return;

    this.next -= dt;
    if (this.next <= 0 && this.moles.filter((m) => !m.hit).length < L.max) {
      const free = this.holes.filter((h) => !h.busy);
      if (free.length) {
        const hole = free[Math.floor(Math.random() * free.length)];
        hole.busy = true;
        this.moles.push({ hole, t: 0, life: L.up, gold: Math.random() < GOLD_CHANCE, hit: false, hitT: 0 });
      }
      this.next = L.gap * (0.7 + Math.random() * 0.6);
    }

    for (const m of this.moles) {
      if (m.hit) { m.hitT += dt; continue; }
      m.t += dt;
      const up = this.rise(m);
      if (up > 0.5) {
        const head = this.headPos(m);
        const reach = this.sw * L.reach * 0.5 + m.hole.r * 0.6;
        if (segs.some((s) => distToSegment(head.x, head.y, s.x1, s.y1, s.x2, s.y2) < reach)) this.bop(m, head);
      }
    }
    for (const m of this.moles) {
      if (!m.hit && m.t > m.life) { this.misses++; m.gone = true; }
      if (m.hit && m.hitT > 0.35) m.gone = true;
      if (m.gone) m.hole.busy = false;
    }
    this.moles = this.moles.filter((m) => !m.gone);
  }

  // 0..1: how far out of the hole the mole is (quick pop up, stay, quick duck down).
  rise(m) {
    const inT = 0.15, outT = 0.2;
    if (m.t < inT) return m.t / inT;
    if (m.t > m.life - outT) return Math.max(0, (m.life - m.t) / outT);
    return 1;
  }

  headPos(m) {
    const r = m.hole.r;
    return { x: m.hole.x, y: m.hole.y - r * 0.9 * this.rise(m) };
  }

  bop(m, at) {
    m.hit = true;
    const points = m.gold ? 3 : 1;
    this.score += points;
    this.hits++;
    const r = m.hole.r;
    this.fx.burst(at.x, at.y, m.gold ? '#ffd23f' : '#ffffff', { n: 14, speed: r * 6, size: r * 0.12 });
    this.fx.text(at.x, at.y - r, `+${points}`, m.gold ? '#ffd23f' : '#7dff9b', r * 1.1, 0.7);
    if (m.gold) sfx.coin(); else sfx.bat();
  }

  draw(ctx, now) {
    if (!this.holes) {
      const v = this.view;
      const font = Math.round(Math.min(v.w * 0.06, v.h * 0.055));
      ctx.font = `800 ${font}px ui-rounded, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillStyle = '#fff';
      ctx.fillText('Step into the picture!', v.x + v.w / 2, v.y + v.h * 0.2);
      return;
    }
    for (const h of this.holes) {
      ctx.fillStyle = 'rgba(60, 35, 15, 0.85)';
      ctx.beginPath(); ctx.ellipse(h.x, h.y, h.r, h.r * 0.38, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(120, 200, 90, 0.9)';
      ctx.lineWidth = h.r * 0.12;
      ctx.stroke();
    }
    for (const m of this.moles) this.drawMole(ctx, m, now);
    this.fx.draw(ctx);
  }

  drawMole(ctx, m, now) {
    const h = m.hole, r = h.r;
    const up = m.hit ? Math.max(0, 1 - m.hitT / 0.35) : this.rise(m);
    if (up <= 0) return;
    // Clip to above the hole's middle so the mole looks like it comes out of the ground.
    ctx.save();
    ctx.beginPath();
    ctx.rect(h.x - r * 1.5, h.y - r * 3, r * 3, r * 3);
    ctx.ellipse(h.x, h.y, r, r * 0.38, 0, 0, Math.PI);
    ctx.clip();
    const cy = h.y - r * 0.9 * up + r * 0.4;
    const squash = m.hit ? 0.7 : 1;
    ctx.fillStyle = m.gold ? '#f4c430' : '#8d5b3a';
    ctx.beginPath(); ctx.ellipse(h.x, cy, r * 0.72, r * 0.9 * squash, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = m.gold ? '#fff3b0' : '#d9a77c';
    ctx.beginPath(); ctx.ellipse(h.x, cy + r * 0.15, r * 0.4, r * 0.28, 0, 0, Math.PI * 2); ctx.fill();
    // Eyes: X when bopped.
    ctx.strokeStyle = '#222';
    ctx.fillStyle = '#222';
    ctx.lineWidth = r * 0.07;
    for (const side of [-1, 1]) {
      const ex = h.x + side * r * 0.25, ey = cy - r * 0.3;
      if (m.hit) {
        ctx.beginPath(); ctx.moveTo(ex - r * 0.08, ey - r * 0.08); ctx.lineTo(ex + r * 0.08, ey + r * 0.08);
        ctx.moveTo(ex + r * 0.08, ey - r * 0.08); ctx.lineTo(ex - r * 0.08, ey + r * 0.08); ctx.stroke();
      } else {
        ctx.beginPath(); ctx.arc(ex, ey, r * 0.08, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.fillStyle = '#ff7aa2';
    ctx.beginPath(); ctx.ellipse(h.x, cy + r * 0.02, r * 0.12, r * 0.09, 0, 0, Math.PI * 2); ctx.fill();
    if (m.gold) {
      ctx.fillStyle = '#fff';
      const tw = Math.sin(now / 120) * 0.5 + 0.5;
      ctx.globalAlpha = tw;
      ctx.beginPath(); ctx.arc(h.x + r * 0.5, cy - r * 0.7, r * 0.1, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.restore();
    // Timer ring so kids see a mole is about to hide.
    if (!m.hit) {
      const left = Math.max(0, 1 - m.t / m.life);
      ctx.strokeStyle = left < 0.3 ? '#ff6b6b' : 'rgba(255,255,255,0.8)';
      ctx.lineWidth = r * 0.08;
      ctx.beginPath(); ctx.arc(h.x, h.y - r * 0.5, r * 1.05, -Math.PI / 2, -Math.PI / 2 + left * Math.PI * 2); ctx.stroke();
    }
  }
}

runGame({
  title: 'Mole Smash',
  lead: 'Moles pop up all around you. Bop them with your hands before they hide!',
  howTo: ['Reach out and touch a mole to bop it', 'Gold moles are worth 3 points', 'The ring shows how long a mole stays up', '60 seconds'],
  tint: 'rgba(30, 70, 20, 0.35)',
  scene: false,
  split: true,
  seconds: 60,
  levels: LEVELS,
  create: (opts) => new MoleSmash(opts),
});
