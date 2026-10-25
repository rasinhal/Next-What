// Goalkeeper: shots fly at your goal. Stop them with your hands (or your body). Move to cover the corners.
import { runGame } from './shared/shell.js';
import { PLAYER_COLORS } from './shared/players.js';
import { sfx } from './shared/sound.js';
import { Fx, HandPaths, distToSegment } from './shared/fx.js';

// flight: seconds from kick to the goal line. spread: how far to the side shots go, in goal half-widths.
// reach: extra save distance around hands, in shoulder widths. curve: sideways swerve for older players.
const LEVELS = {
  little: { flight: 2.2, spread: 0.55, reach: 0.55, curve: 0, shots: 10 },
  kids: { flight: 1.6, spread: 0.8, reach: 0.4, curve: 0.15, shots: 10 },
  big: { flight: 1.1, spread: 0.95, reach: 0.3, curve: 0.3, shots: 10 },
};
const WAIT = 1.3;
const RESULT = 1.3;

class Goalkeeper {
  constructor({ view, level, id, count }) {
    this.view = view;
    this.level = level;
    this.color = count === 2 ? PLAYER_COLORS[id] : '#ffd23f';
  }

  begin(player) {
    this.saves = 0;
    this.goals = 0;
    this.shot = 0;
    this.streak = 0;
    this.bestStreak = 0;
    this.phase = 'wait';
    this.timer = WAIT;
    this.ball = null;
    this.goal = null;
    this.fx = new Fx();
    this.paths = new HandPaths();
    this.netShake = 0;
    this.done = false;
    this.placeGoal(player);
  }

  // The goal is set around where the keeper stands at the start, sized to their body.
  placeGoal(p) {
    const v = this.view;
    if (p && p.present) {
      const sw = p.sw;
      this.goal = { cx: p.center.x, top: p.center.y - sw * 1.9, bottom: p.center.y + sw * 3.2, half: Math.min(sw * 3.2, v.w * 0.46), sw };
    }
  }

  hud() {
    return `${this.saves} saved · ${this.level.shots - this.shot} left`;
  }

  result() {
    return { score: this.saves, title: this.saves >= this.level.shots * 0.7 ? 'Super keeper!' : 'Good keeping!', lines: [`${this.saves} of ${this.shot} shots saved`, `Best streak: ${this.bestStreak}`] };
  }

  update(dt, now, p) {
    this.fx.update(dt);
    this.netShake = Math.max(0, this.netShake - dt * 3);
    if (!this.goal) this.placeGoal(p);
    this.p = p.present ? p : null;
    const segs = this.paths.segments([p]);
    if (this.done || !this.goal) return;

    if (this.phase === 'wait') {
      this.timer -= dt;
      if (this.timer <= 0) this.kick();
      return;
    }
    const b = this.ball;
    if (this.phase === 'fly') {
      b.t += dt / this.level.flight;
      this.placeBall(b);
      if (b.t > 0.8 && this.p && this.touches(b, segs)) this.saved(b, segs);
      else if (b.t >= 1.05) this.scored(b);
      return;
    }
    // Result: the ball bounces away (saved) or sits in the net (goal).
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.vy += this.view.h * 1.5 * dt;
    this.timer -= dt;
    if (this.timer <= 0) {
      if (this.shot >= this.level.shots) { this.done = true; this.ball = null; return; }
      this.phase = 'wait';
      this.timer = WAIT;
    }
  }

  kick() {
    const g = this.goal, L = this.level;
    const v = this.view;
    const from = { x: v.x + v.w / 2, y: v.y + v.h * 0.3 };
    // Aim inside the goal: anywhere across (limited by level) and between knee and crossbar height.
    const to = {
      x: g.cx + (Math.random() * 2 - 1) * g.half * L.spread * 0.9,
      y: g.top + (g.bottom - g.top) * (0.1 + Math.random() * 0.65),
    };
    const curve = (Math.random() * 2 - 1) * L.curve * g.half;
    this.ball = { from, to, curve, t: 0, x: from.x, y: from.y, r: 0, sw: g.sw };
    this.phase = 'fly';
    sfx.bat();
  }

  placeBall(b) {
    const t = Math.min(b.t, 1.1);
    const arc = Math.sin(Math.PI * Math.min(t, 1)) * b.sw * 1.2; // slight lob
    b.x = b.from.x + (b.to.x - b.from.x) * t + Math.sin(Math.PI * Math.min(t, 1)) * b.curve;
    b.y = b.from.y + (b.to.y - b.from.y) * t - arc;
    b.r = b.sw * (0.08 + 0.3 * t);
  }

  touches(b, segs) {
    const reach = b.r + b.sw * this.level.reach * 0.6;
    for (const s of segs) if (distToSegment(b.x, b.y, s.x1, s.y1, s.x2, s.y2) < reach) return true;
    // The body counts too: standing in the way is a save.
    const p = this.p;
    return Math.hypot(b.x - p.center.x, b.y - (p.center.y + p.sw * 0.6)) < b.r + p.sw * 0.7;
  }

  saved(b, segs) {
    this.shot++;
    this.saves++;
    this.streak++;
    this.bestStreak = Math.max(this.bestStreak, this.streak);
    this.phase = 'result';
    this.timer = RESULT;
    const away = b.x < (this.p ? this.p.center.x : b.x) ? -1 : 1;
    b.vx = away * this.view.w * 0.6;
    b.vy = -this.view.h * 0.9;
    const h = this.view.h;
    this.fx.burst(b.x, b.y, '#ffffff', { n: 16, speed: h * 0.6, size: h * 0.01 });
    this.fx.burst(b.x, b.y, this.color, { n: 10, speed: h * 0.4, size: h * 0.012 });
    const text = this.streak >= 3 ? `${this.streak} in a row!` : ['SAVED!', 'GREAT SAVE!', 'BLOCKED!'][Math.floor(Math.random() * 3)];
    this.fx.text(this.view.x + this.view.w / 2, this.view.y + h * 0.26, text, '#7dff9b', Math.min(this.view.w * 0.1, h * 0.09), 1.2);
    sfx.paddle();
    if (this.streak >= 3) sfx.cheer();
  }

  scored(b) {
    this.shot++;
    this.goals++;
    this.streak = 0;
    this.phase = 'result';
    this.timer = RESULT;
    b.vx = 0;
    b.vy = 0;
    this.netShake = 1;
    const h = this.view.h;
    this.fx.text(this.view.x + this.view.w / 2, this.view.y + h * 0.26, 'GOAL!', '#ff6b6b', Math.min(this.view.w * 0.1, h * 0.09), 1.2);
    this.fx.bump(h * 0.02);
    sfx.out();
  }

  draw(ctx, now) {
    const v = this.view;
    this.fx.applyShake(ctx);
    if (this.goal) this.drawGoal(ctx, now);
    this.drawStriker(ctx);

    const b = this.ball;
    if (b && this.phase !== 'wait') {
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.beginPath();
      ctx.ellipse(b.x, (this.goal ? this.goal.bottom : v.y + v.h) * Math.min(1, b.t) + (v.y + v.h * 0.33) * (1 - Math.min(1, b.t)), b.r, b.r * 0.3, 0, 0, Math.PI * 2);
      ctx.fill();
      drawBall(ctx, b.x, b.y, b.r, now);
    }

    if (this.phase === 'wait' && !this.done) {
      const font = Math.round(Math.min(v.w * 0.06, v.h * 0.055));
      ctx.font = `800 ${font}px ui-rounded, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.lineWidth = font * 0.12;
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.fillStyle = '#fff';
      const text = !this.p ? 'Step into your goal!' : this.timer < 0.5 ? 'Here it comes!' : `Shot ${this.shot + 1}`;
      ctx.strokeText(text, v.x + v.w / 2, v.y + v.h * 0.2);
      ctx.fillText(text, v.x + v.w / 2, v.y + v.h * 0.2);
    }
    this.fx.draw(ctx);
    ctx.restore();
  }

  drawGoal(ctx, now) {
    const g = this.goal;
    const l = g.cx - g.half, r = g.cx + g.half;
    const wob = this.netShake > 0 ? Math.sin(now / 30) * this.netShake * g.sw * 0.1 : 0;
    // Net
    ctx.strokeStyle = 'rgba(255,255,255,0.28)';
    ctx.lineWidth = 1.5;
    const step = g.sw * 0.4;
    for (let x = l; x <= r; x += step) {
      ctx.beginPath(); ctx.moveTo(x, g.top); ctx.lineTo(x + wob, g.bottom); ctx.stroke();
    }
    for (let y = g.top; y <= g.bottom; y += step) {
      ctx.beginPath(); ctx.moveTo(l, y + wob); ctx.lineTo(r, y + wob); ctx.stroke();
    }
    // Posts and crossbar
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = g.sw * 0.14;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(l, g.bottom); ctx.lineTo(l, g.top); ctx.lineTo(r, g.top); ctx.lineTo(r, g.bottom); ctx.stroke();
    // Grass line
    ctx.fillStyle = 'rgba(80, 180, 90, 0.35)';
    ctx.fillRect(this.view.x, g.bottom, this.view.w, this.view.y + this.view.h - g.bottom);
  }

  drawStriker(ctx) {
    const v = this.view;
    const s = Math.min(v.w, v.h) * 0.08;
    const x = v.x + v.w / 2, y = v.y + v.h * 0.33;
    const kicking = this.phase === 'fly' && this.ball && this.ball.t < 0.15;
    ctx.fillStyle = this.color === '#ffd23f' ? '#e53935' : '#7e57c2';
    ctx.fillRect(x - s * 0.22, y - s * 0.95, s * 0.44, s * 0.55);
    ctx.fillStyle = '#ffd9b3';
    ctx.beginPath(); ctx.arc(x, y - s * 1.15, s * 0.2, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#334';
    ctx.lineWidth = s * 0.12;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x - s * 0.1, y - s * 0.4); ctx.lineTo(x - s * 0.15, y);
    ctx.moveTo(x + s * 0.1, y - s * 0.4); ctx.lineTo(x + s * (kicking ? 0.45 : 0.15), y - (kicking ? s * 0.15 : 0));
    ctx.stroke();
  }
}

// Classic black-and-white football.
function drawBall(ctx, x, y, r, now) {
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#222';
  const spin = now / 150;
  for (let i = 0; i < 5; i++) {
    const a = spin + (i * Math.PI * 2) / 5;
    ctx.beginPath(); ctx.arc(x + Math.cos(a) * r * 0.62, y + Math.sin(a) * r * 0.62, r * 0.2, 0, Math.PI * 2); ctx.fill();
  }
  ctx.beginPath(); ctx.arc(x, y, r * 0.26, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.4)';
  ctx.lineWidth = Math.max(1, r * 0.06);
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
}

runGame({
  title: 'Goalkeeper',
  lead: 'You are in goal. Stop the shots with your hands, or get your body in the way!',
  howTo: ['Stand in the middle of your goal', 'Reach or step to block each shot', 'Save 3 in a row for a streak', '10 shots'],
  tint: 'rgba(10, 60, 30, 0.35)',
  scene: false,
  split: true,
  seconds: null,
  levels: LEVELS,
  create: (opts) => new Goalkeeper(opts),
});
