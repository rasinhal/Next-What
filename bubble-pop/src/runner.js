// Runner: an endless three-lane run. Step left or right to change lanes, jump over hurdles, crouch under bars, grab coins.
import { runGame } from './shared/shell.js';
import { PLAYER_COLORS } from './shared/players.js';
import { sfx } from './shared/sound.js';

// speed: world units per second; gap: seconds between obstacle rows.
// lane, jump, duck: how far the body must move, in shoulder widths, to count.
const LEVELS = {
  little: { speed: 8, accel: 0.06, gap: 1.8, lane: 0.5, jump: 0.2, duck: 0.4, cues: true, double: 0, kinds: ['block', 'block', 'low', 'high'] },
  kids: { speed: 11, accel: 0.1, gap: 1.3, lane: 0.6, jump: 0.25, duck: 0.45, cues: true, double: 0.25, kinds: ['block', 'low', 'high'] },
  big: { speed: 15, accel: 0.16, gap: 0.95, lane: 0.7, jump: 0.28, duck: 0.5, cues: false, double: 0.5, kinds: ['block', 'low', 'high'] },
};
const FAR = 70; // obstacles appear this far ahead
const PLAYER_D = 2; // depth where the runner stands
const DEPTH_K = 6; // perspective strength
const JUMP_TIME = 0.8;
const STUMBLE_TIME = 1.0;

class Runner {
  constructor({ view, level, id, count }) {
    this.view = view;
    this.level = level;
    this.color = count === 2 ? PLAYER_COLORS[id] : '#ffd23f';
  }

  begin(player) {
    this.base = null;
    this.calibrate(player);
    this.t = 0;
    this.lane = 0;
    this.laneX = 0;
    this.jumpT = -1;
    this.ducking = false;
    this.stumble = 0;
    this.dist = 0;
    this.coins = 0;
    this.crashes = 0;
    this.obstacles = [];
    this.nextRow = 1;
    this.popups = [];
    this.done = false;
  }

  calibrate(p) {
    if (p && p.present) this.base = { x: p.center.x, y: p.center.y };
  }

  get score() {
    return Math.round(this.dist) + this.coins * 10;
  }

  hud() {
    return `${this.score} pts`;
  }

  result() {
    return { score: this.score, lines: [`${Math.round(this.dist)} m run`, `${this.coins} coins`, `${this.crashes} bumps`] };
  }

  control(dt, p) {
    if (!p.present) return;
    if (!this.base) this.calibrate(p);
    const L = this.level;
    const dx = (p.center.x - this.base.x) / p.sw;
    if (dx > L.lane) this.lane = 1;
    else if (dx < -L.lane) this.lane = -1;
    else if (Math.abs(dx) < L.lane * 0.6) this.lane = 0;

    const dy = (this.base.y - p.center.y) / p.sw; // positive when the body is higher than at the start
    if (dy > L.jump && this.jumpT < 0) { this.jumpT = 0; sfx.jump(); }
    this.ducking = dy < -L.duck;
    // Follow slow drift (stepping closer to or further from the camera) while standing normally.
    if (Math.abs(dy) < L.jump * 0.5 && this.jumpT < 0) this.base.y += (p.center.y - this.base.y) * Math.min(1, dt * 0.8);
  }

  update(dt, now, p) {
    const L = this.level;
    this.t += dt;
    this.control(dt, p);
    if (this.jumpT >= 0) {
      this.jumpT += dt;
      if (this.jumpT > JUMP_TIME) this.jumpT = -1;
    }
    this.laneX += (this.lane - this.laneX) * Math.min(1, dt * 12);
    this.stumble = Math.max(0, this.stumble - dt);
    const speed = (L.speed + L.accel * this.t) * (this.stumble > 0 ? 0.4 : 1);
    this.dist += speed * dt;

    for (const o of this.obstacles) {
      const before = o.d;
      o.d -= speed * dt;
      if (o.done || before < PLAYER_D || o.d >= PLAYER_D) continue;
      o.done = true;
      if (Math.abs(this.laneX - o.lane) > 0.5) continue;
      if (o.kind === 'coin') {
        o.taken = true;
        this.coins++;
        sfx.coin();
        continue;
      }
      const dodged = (o.kind === 'low' && this.jumpT >= 0) || (o.kind === 'high' && this.ducking);
      if (dodged) this.popups.push({ text: o.kind === 'low' ? 'Nice jump!' : 'Nice duck!', life: 0.8 });
      else if (this.stumble <= 0) {
        this.stumble = STUMBLE_TIME;
        this.crashes++;
        sfx.crash();
        this.popups.push({ text: 'Ouch!', life: 0.8 });
      }
    }
    this.obstacles = this.obstacles.filter((o) => o.d > -3 && !o.taken);
    for (const pop of this.popups) pop.life -= dt;
    this.popups = this.popups.filter((pop) => pop.life > 0);

    this.nextRow -= dt;
    if (this.nextRow <= 0) {
      this.spawnRow();
      this.nextRow = L.gap * (0.8 + Math.random() * 0.4);
    }
  }

  // One obstacle (sometimes two) per row, so at least one lane is always open; coins go in an open lane.
  spawnRow() {
    const L = this.level;
    const lanes = [-1, 0, 1].sort(() => Math.random() - 0.5);
    const count = Math.random() < L.double ? 2 : 1;
    for (let i = 0; i < count; i++) {
      const kind = i === 0 ? L.kinds[Math.floor(Math.random() * L.kinds.length)] : 'block';
      this.obstacles.push({ lane: lanes[i], d: FAR, kind });
    }
    if (Math.random() < 0.7) {
      for (let k = 0; k < 3; k++) this.obstacles.push({ lane: lanes[2], d: FAR + 3 + k * 3, kind: 'coin' });
    }
  }

  // ---------- Drawing ----------

  geom() {
    const v = this.view;
    const horizon = v.y + v.h * 0.32;
    const nearY = v.y + v.h * 1.02;
    const laneW = Math.min(v.w * 0.3, v.h * 0.45);
    return { v, horizon, nearY, laneW, cx: v.x + v.w / 2 };
  }

  proj(g, d, lane) {
    const f = 1 / (1 + Math.max(d, -0.9) / DEPTH_K);
    return { x: g.cx + lane * g.laneW * f, y: g.horizon + (g.nearY - g.horizon) * f, f };
  }

  draw(ctx, now) {
    const g = this.geom();
    const { v } = g;

    const sky = ctx.createLinearGradient(0, v.y, 0, g.horizon);
    sky.addColorStop(0, '#5ec8ff');
    sky.addColorStop(1, '#bfeaff');
    ctx.fillStyle = sky;
    ctx.fillRect(v.x, v.y, v.w, g.horizon - v.y);
    ctx.fillStyle = '#6cc46a';
    ctx.fillRect(v.x, g.horizon, v.w, v.y + v.h - g.horizon);

    // Road: a trapezoid from the horizon to the bottom, three lanes wide.
    const farL = this.proj(g, FAR, -1.5), farR = this.proj(g, FAR, 1.5);
    const nearL = this.proj(g, -0.5, -1.5), nearR = this.proj(g, -0.5, 1.5);
    ctx.fillStyle = '#7a6a5c';
    ctx.beginPath();
    ctx.moveTo(farL.x, farL.y); ctx.lineTo(farR.x, farR.y); ctx.lineTo(nearR.x, nearR.y); ctx.lineTo(nearL.x, nearL.y);
    ctx.closePath();
    ctx.fill();

    // Moving sleepers across the road give a sense of speed.
    ctx.fillStyle = 'rgba(60, 45, 35, 0.6)';
    for (let d = 4 - (this.dist % 4); d < FAR; d += 4) {
      const a = this.proj(g, d, -1.5), b = this.proj(g, d, 1.5), c = this.proj(g, d + 0.8, 1.5);
      ctx.fillRect(a.x, c.y, b.x - a.x, Math.max(1, a.y - c.y));
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    for (const lane of [-0.5, 0.5]) {
      ctx.lineWidth = Math.max(2, g.laneW * 0.03);
      const a = this.proj(g, FAR, lane), b = this.proj(g, -0.5, lane);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }

    // Trees along both sides.
    for (let d = 10 - (this.dist % 10); d < FAR; d += 10) {
      for (const side of [-2.3, 2.3]) {
        const p = this.proj(g, d, side);
        const s = g.laneW * p.f;
        ctx.fillStyle = '#7b4a26';
        ctx.fillRect(p.x - s * 0.08, p.y - s * 0.7, s * 0.16, s * 0.7);
        ctx.fillStyle = '#2f8f3a';
        ctx.beginPath(); ctx.arc(p.x, p.y - s * 0.85, s * 0.4, 0, Math.PI * 2); ctx.fill();
      }
    }

    const sorted = [...this.obstacles].sort((a, b) => b.d - a.d);
    for (const o of sorted) if (o.d >= PLAYER_D) this.drawObstacle(ctx, g, o, now);
    this.drawRunner(ctx, g, now);
    for (const o of sorted) if (o.d < PLAYER_D) this.drawObstacle(ctx, g, o, now);

    // Text: big cue for the next thing in your lane (younger levels), and short popups.
    const font = Math.round(Math.min(v.w * 0.09, v.h * 0.08));
    ctx.textAlign = 'center';
    ctx.font = `900 ${font}px ui-rounded, system-ui, sans-serif`;
    ctx.lineWidth = font * 0.12;
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    const cue = this.level.cues && this.cue();
    if (cue) {
      ctx.fillStyle = '#fff';
      ctx.strokeText(cue, g.cx, v.y + v.h * 0.2);
      ctx.fillText(cue, g.cx, v.y + v.h * 0.2);
    }
    for (const pop of this.popups) {
      ctx.globalAlpha = Math.min(1, pop.life * 2);
      ctx.fillStyle = pop.text === 'Ouch!' ? '#ff6b6b' : '#7dff9b';
      ctx.strokeText(pop.text, g.cx, v.y + v.h * 0.3);
      ctx.fillText(pop.text, g.cx, v.y + v.h * 0.3);
      ctx.globalAlpha = 1;
    }
  }

  cue() {
    let next = null;
    for (const o of this.obstacles) {
      if (o.kind === 'coin' || o.done || o.lane !== this.lane || o.d < PLAYER_D || o.d > PLAYER_D + 20) continue;
      if (!next || o.d < next.d) next = o;
    }
    if (!next) return '';
    return { low: 'JUMP!', high: 'DUCK!', block: 'MOVE!' }[next.kind];
  }

  drawObstacle(ctx, g, o, now) {
    const p = this.proj(g, o.d, o.lane);
    const s = g.laneW * p.f; // one lane width at this depth
    if (o.kind === 'coin') {
      const r = s * 0.16;
      const y = p.y - s * 0.3 - Math.sin(now / 200 + o.d) * s * 0.05;
      ctx.fillStyle = '#ffd23f';
      ctx.strokeStyle = '#b8860b';
      ctx.lineWidth = Math.max(1, r * 0.2);
      ctx.beginPath(); ctx.ellipse(p.x, y, r * Math.abs(Math.cos(now / 300)) + r * 0.2, r, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      return;
    }
    const w = s * 0.85;
    if (o.kind === 'block') {
      const h = s * 1.1;
      ctx.fillStyle = '#d64545';
      roundRect(ctx, p.x - w / 2, p.y - h, w, h, s * 0.08);
      ctx.fill();
      ctx.fillStyle = '#ffe6a0';
      ctx.fillRect(p.x - w * 0.38, p.y - h * 0.8, w * 0.76, h * 0.22);
      ctx.fillStyle = '#333';
      ctx.fillRect(p.x - w / 2, p.y - h * 0.12, w, h * 0.12);
    } else if (o.kind === 'low') {
      const h = s * 0.32;
      stripes(ctx, p.x - w / 2, p.y - h, w, h * 0.35, s);
      ctx.fillStyle = '#eee';
      ctx.fillRect(p.x - w / 2, p.y - h, s * 0.05, h);
      ctx.fillRect(p.x + w / 2 - s * 0.05, p.y - h, s * 0.05, h);
    } else {
      const h = s * 1.2;
      ctx.fillStyle = '#eee';
      ctx.fillRect(p.x - w / 2, p.y - h, s * 0.06, h);
      ctx.fillRect(p.x + w / 2 - s * 0.06, p.y - h, s * 0.06, h);
      stripes(ctx, p.x - w / 2, p.y - h, w, h * 0.42, s);
    }
  }

  drawRunner(ctx, g, now) {
    const p = this.proj(g, PLAYER_D, this.laneX);
    const s = g.laneW * p.f;
    const lift = this.jumpT >= 0 ? Math.sin((Math.PI * this.jumpT) / JUMP_TIME) * s * 0.7 : 0;
    const squash = this.ducking ? 0.55 : 1;
    if (this.stumble > 0 && Math.floor(now / 100) % 2) ctx.globalAlpha = 0.4;
    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath(); ctx.ellipse(p.x, p.y, s * 0.25, s * 0.07, 0, 0, Math.PI * 2); ctx.fill();
    const footY = p.y - lift;
    const bodyH = s * 0.55 * squash;
    // Legs swing while running.
    const swing = this.jumpT >= 0 ? 0 : Math.sin(now / 70) * s * 0.08;
    ctx.strokeStyle = '#334';
    ctx.lineWidth = s * 0.08;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(p.x - s * 0.07, footY - bodyH * 0.35); ctx.lineTo(p.x - s * 0.07 + swing, footY);
    ctx.moveTo(p.x + s * 0.07, footY - bodyH * 0.35); ctx.lineTo(p.x + s * 0.07 - swing, footY);
    ctx.stroke();
    ctx.fillStyle = this.color;
    roundRect(ctx, p.x - s * 0.17, footY - bodyH, s * 0.34, bodyH * 0.7, s * 0.08);
    ctx.fill();
    ctx.fillStyle = '#ffd9b3';
    ctx.beginPath(); ctx.arc(p.x, footY - bodyH - s * 0.11, s * 0.13, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = this.color;
    ctx.beginPath(); ctx.arc(p.x, footY - bodyH - s * 0.14, s * 0.13, Math.PI, 0); ctx.fill();
    ctx.globalAlpha = 1;
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function stripes(ctx, x, y, w, h, s) {
  ctx.fillStyle = '#ffd23f';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#222';
  const step = s * 0.16;
  for (let sx = x; sx < x + w; sx += step * 2) ctx.fillRect(sx, y, Math.min(step, x + w - sx), h);
}

runGame({
  title: 'Runner',
  lead: 'Run down the track and dodge everything in your way. Stand back so the camera sees your whole body.',
  howTo: ['Step left or right to change lanes', 'Jump over yellow hurdles', 'Crouch down under high bars', 'Grab the gold coins'],
  scene: true,
  split: true,
  seconds: 60,
  levels: LEVELS,
  create: (opts) => new Runner(opts),
});
