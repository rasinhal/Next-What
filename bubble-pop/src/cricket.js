// Cricket: you are the batter. Swing your hands like a bat as the ball reaches you. Faster swings score more runs.
import { runGame } from './shared/shell.js';
import { PLAYER_COLORS } from './shared/players.js';
import { sfx } from './shared/sound.js';
import { Fx } from './shared/fx.js';

// flight: seconds from release to reaching the batter. reach: extra hit distance, in shoulder widths.
// swing: minimum hand speed (shoulder widths per second) for a shot; slower contact is a block.
// runs: hand speeds needed for 2, 4 and 6 runs. stumps: chance a ball is on target to bowl you.
const LEVELS = {
  little: { flight: 2.4, reach: 0.9, swing: 1.5, runs: [3, 5, 7], stumps: 0.3, balls: 12, wickets: 3 },
  kids: { flight: 1.8, reach: 0.65, swing: 2.2, runs: [4, 6.5, 9], stumps: 0.45, balls: 12, wickets: 3 },
  big: { flight: 1.25, reach: 0.45, swing: 3, runs: [5, 8, 11], stumps: 0.55, balls: 12, wickets: 3 },
};
const WAIT_TIME = 1.6; // pause between balls
const RESULT_TIME = 1.6;

class Batting {
  constructor({ view, level, id, count }) {
    this.view = view;
    this.level = level;
    this.color = count === 2 ? PLAYER_COLORS[id] : '#ffd23f';
  }

  begin() {
    this.runs = 0;
    this.balls = 0;
    this.wickets = 0;
    this.fours = 0;
    this.sixes = 0;
    this.phase = 'wait';
    this.timer = WAIT_TIME;
    this.ball = null;
    this.message = null;
    this.fx = new Fx();
    this.done = false;
  }

  hud() {
    const left = this.level.balls - this.balls;
    return `${this.runs}/${this.wickets} · ${left} ball${left === 1 ? '' : 's'}`;
  }

  result() {
    const lines = [`${this.wickets} out, ${this.balls} balls`];
    if (this.fours || this.sixes) lines.push(`${this.fours} fours, ${this.sixes} sixes`);
    return { score: this.runs, title: 'Innings over!', lines };
  }

  // Where the ball is bowled from, and where the batter's bat should meet it.
  bowlerPoint() {
    const v = this.view;
    return { x: v.x + v.w / 2, y: v.y + v.h * 0.38 };
  }

  update(dt, now, p) {
    this.fx.update(dt);
    const L = this.level;
    this.p = p.present ? p : null;
    if (this.message) {
      this.message.life -= dt;
      if (this.message.life <= 0) this.message = null;
    }
    if (this.done) return;

    if (this.phase === 'wait') {
      this.timer -= dt;
      if (this.timer <= 0) this.bowl();
      return;
    }

    const b = this.ball;
    if (this.phase === 'bowl') {
      b.t += dt / L.flight;
      this.placeBall(b);
      if (b.t > 0.75 && this.p) this.tryHit(b, this.p);
      if (this.phase === 'bowl' && b.t > 1.2) this.missed(b);
      return;
    }

    // Result phase: hit balls fly off, missed balls roll on.
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.vy += this.view.h * 1.2 * dt;
    b.r *= b.shrink ? 1 - dt * 0.9 : 1;
    this.timer -= dt;
    if (this.timer <= 0) this.nextBall();
  }

  bowl() {
    const v = this.view;
    const from = this.bowlerPoint();
    // Aim at the batter's current position: across the hips, a little left or right.
    const sw = this.p ? this.p.sw : v.w * 0.08;
    const bodyX = this.p ? this.p.center.x : v.x + v.w / 2;
    const bodyY = this.p ? this.p.center.y + sw * 1.1 : v.y + v.h * 0.7;
    const onStumps = Math.random() < this.level.stumps;
    const side = onStumps ? (Math.random() - 0.5) * 0.4 : (Math.random() < 0.5 ? -1 : 1) * (0.7 + Math.random() * 0.4);
    const to = { x: bodyX + side * sw, y: bodyY };
    const feetY = this.p ? this.p.center.y + sw * 3 : v.y + v.h * 0.95;
    this.ball = { from, to, t: 0, onStumps, sw, stumpsX: bodyX, feetY, x: from.x, y: from.y, r: 0, bounced: false };
    this.phase = 'bowl';
  }

  // Path: falls to bounce on the pitch at 70%, then rises to the hitting point. Grows as it comes closer.
  placeBall(b) {
    const t = b.t;
    const bounceY = b.from.y + (b.feetY - b.from.y) * 0.85;
    b.x = b.from.x + (b.to.x - b.from.x) * t;
    if (t < 0.7) {
      const k = t / 0.7;
      b.y = b.from.y + (bounceY - b.from.y) * k * k;
    } else {
      const k = (t - 0.7) / 0.3;
      // Past the hitting point it keeps coming on toward the camera.
      b.y = bounceY + (b.to.y - bounceY) * (k <= 1 ? Math.sin((k * Math.PI) / 2) : 1 + (k - 1) * 0.5);
      if (!b.bounced) { b.bounced = true; sfx.bounce(); }
    }
    b.r = b.sw * (0.06 + 0.16 * Math.min(t, 1.2));
  }

  // The bat runs from the hands out along the forearm. Contact plus a quick swing makes a shot.
  tryHit(b, p) {
    const L = this.level;
    for (const h of bats(p)) {
      const dist = distToSegment(b.x, b.y, h.x1, h.y1, h.x2, h.y2);
      if (dist > b.r + p.sw * (0.1 + L.reach)) continue;
      const speed = h.speed;
      if (speed < L.swing) {
        this.finish(0, 'Blocked!', '#a9c3e0');
        b.vx = (b.x - p.center.x) * 0.5;
        b.vy = -this.view.h * 0.2;
        b.shrink = false;
        sfx.bounce();
        return;
      }
      const runs = speed >= L.runs[2] ? 6 : speed >= L.runs[1] ? 4 : speed >= L.runs[0] ? 2 : 1;
      if (runs === 4) this.fours++;
      if (runs === 6) this.sixes++;
      this.runs += runs;
      const label = runs === 6 ? 'SIX!' : runs === 4 ? 'FOUR!' : `${runs} run${runs > 1 ? 's' : ''}`;
      this.finish(runs, label, runs >= 4 ? '#ffd23f' : '#7dff9b');
      // Fly off in the swing's direction, always upward and away.
      const dir = Math.hypot(h.vx, h.vy) || 1;
      const power = this.view.h * (0.8 + runs * 0.25);
      b.vx = (h.vx / dir) * power;
      b.vy = -Math.abs(power * 1.1);
      b.shrink = true;
      sfx.bat();
      this.fx.burst(b.x, b.y, '#ffffff', { n: 10 + runs * 3, speed: p.sw * (3 + runs), size: p.sw * 0.05 });
      if (runs >= 4) this.fx.bump(p.sw * 0.12 * (runs / 4));
      if (runs >= 4) sfx.cheer();
      return;
    }
  }

  missed(b) {
    if (b.onStumps) {
      this.wickets++;
      this.finish(0, 'Bowled!', '#ff6b6b');
      b.stumpsHit = true;
      sfx.out();
      this.fx.burst(b.stumpsX, b.feetY - b.sw * 1.2, '#f2e3c4', { n: 12, speed: b.sw * 3, size: b.sw * 0.05 });
      this.fx.bump(b.sw * 0.1);
    } else {
      this.finish(0, 'Missed', '#a9c3e0');
    }
    b.vx = (b.to.x - b.from.x) * 0.6;
    b.vy = this.view.h * 0.3;
    b.shrink = false;
  }

  finish(runs, text, color) {
    this.balls++;
    this.phase = 'result';
    this.timer = RESULT_TIME;
    this.message = { text, color, life: RESULT_TIME };
  }

  nextBall() {
    if (this.balls >= this.level.balls || this.wickets >= this.level.wickets) {
      this.done = true;
      this.ball = null;
      return;
    }
    this.phase = 'wait';
    this.timer = WAIT_TIME;
  }

  // ---------- Drawing ----------

  draw(ctx, now) {
    this.fx.applyShake(ctx);
    this.drawScene(ctx, now);
    this.fx.draw(ctx);
    ctx.restore();
  }

  drawScene(ctx, now) {
    const v = this.view;
    const from = this.bowlerPoint();
    const sw = this.p ? this.p.sw : v.w * 0.08;
    const footX = this.p ? this.p.center.x : v.x + v.w / 2;
    const feetY = this.p ? this.p.center.y + sw * 3 : v.y + v.h * 0.95;

    // Pitch strip from the bowler down to the batter's feet.
    ctx.fillStyle = 'rgba(214, 190, 130, 0.45)';
    ctx.beginPath();
    ctx.moveTo(from.x - v.w * 0.04, from.y + v.h * 0.03);
    ctx.lineTo(from.x + v.w * 0.04, from.y + v.h * 0.03);
    ctx.lineTo(footX + sw * 1.4, feetY);
    ctx.lineTo(footX - sw * 1.4, feetY);
    ctx.closePath();
    ctx.fill();

    this.drawBowler(ctx, from, v, now);
    this.drawStumps(ctx, footX, feetY, sw);

    if (this.p) {
      for (const bat of bats(this.p)) {
        ctx.strokeStyle = '#e8c27a';
        ctx.lineCap = 'round';
        ctx.lineWidth = this.p.sw * 0.16;
        ctx.beginPath(); ctx.moveTo(bat.x1, bat.y1); ctx.lineTo(bat.x2, bat.y2); ctx.stroke();
        ctx.strokeStyle = '#333';
        ctx.lineWidth = this.p.sw * 0.1;
        ctx.beginPath(); ctx.moveTo(bat.x1, bat.y1); ctx.lineTo(bat.x1 + (bat.x2 - bat.x1) * 0.2, bat.y1 + (bat.y2 - bat.y1) * 0.2); ctx.stroke();
      }
    }

    const b = this.ball;
    if (b && this.phase !== 'wait' && b.r > 0.5) {
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.beginPath(); ctx.ellipse(b.x, Math.max(b.y + b.r, (b.from.y + (b.feetY - b.from.y) * b.t)), b.r, b.r * 0.35, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#d9262c';
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = Math.max(1, b.r * 0.15);
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r * 0.7, -0.6, 0.6); ctx.stroke();
    }

    const font = Math.round(Math.min(v.w * 0.11, v.h * 0.1));
    ctx.textAlign = 'center';
    ctx.font = `900 ${font}px ui-rounded, system-ui, sans-serif`;
    ctx.lineWidth = font * 0.12;
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    if (this.message) {
      ctx.globalAlpha = Math.min(1, this.message.life * 2);
      ctx.fillStyle = this.message.color;
      ctx.strokeText(this.message.text, v.x + v.w / 2, v.y + v.h * 0.2);
      ctx.fillText(this.message.text, v.x + v.w / 2, v.y + v.h * 0.2);
      ctx.globalAlpha = 1;
    } else if (this.phase === 'wait' && !this.done) {
      ctx.font = `800 ${Math.round(font * 0.6)}px ui-rounded, system-ui, sans-serif`;
      ctx.fillStyle = '#fff';
      const text = this.p ? 'Get your bat ready!' : 'Step into the picture!';
      ctx.strokeText(text, v.x + v.w / 2, v.y + v.h * 0.2);
      ctx.fillText(text, v.x + v.w / 2, v.y + v.h * 0.2);
    }
    if (this.done) {
      const text = this.wickets >= this.level.wickets ? 'All out!' : 'Innings over';
      ctx.fillStyle = '#fff';
      ctx.strokeText(text, v.x + v.w / 2, v.y + v.h * 0.2);
      ctx.fillText(text, v.x + v.w / 2, v.y + v.h * 0.2);
    }
  }

  drawBowler(ctx, at, v, now) {
    const s = Math.min(v.w, v.h) * 0.09;
    // Run-up bob just before release.
    const bob = this.phase === 'wait' && this.timer < 0.8 ? Math.abs(Math.sin(now / 90)) * s * 0.15 : 0;
    const x = at.x, y = at.y - bob;
    ctx.fillStyle = '#f4f8ff';
    ctx.beginPath(); ctx.arc(x, y - s * 1.05, s * 0.22, 0, Math.PI * 2); ctx.fill();
    ctx.fillRect(x - s * 0.22, y - s * 0.8, s * 0.44, s * 0.6);
    ctx.strokeStyle = '#f4f8ff';
    ctx.lineWidth = s * 0.12;
    ctx.lineCap = 'round';
    const armUp = this.phase === 'wait' && this.timer < 0.3;
    ctx.beginPath();
    ctx.moveTo(x + s * 0.2, y - s * 0.75);
    ctx.lineTo(x + s * (armUp ? 0.25 : 0.4), y - s * (armUp ? 1.4 : 0.3));
    ctx.moveTo(x - s * 0.1, y - s * 0.2); ctx.lineTo(x - s * 0.2, y + s * 0.15);
    ctx.moveTo(x + s * 0.1, y - s * 0.2); ctx.lineTo(x + s * 0.2, y + s * 0.15);
    ctx.stroke();
  }

  drawStumps(ctx, x, feetY, sw) {
    const h = sw * 1.4, gap = sw * 0.16;
    const fallen = this.ball && this.ball.stumpsHit && this.phase === 'result';
    ctx.strokeStyle = '#f2e3c4';
    ctx.lineWidth = sw * 0.07;
    ctx.lineCap = 'round';
    for (let i = -1; i <= 1; i++) {
      const tilt = fallen ? i * 0.5 + 0.2 : 0;
      ctx.beginPath();
      ctx.moveTo(x + i * gap, feetY);
      ctx.lineTo(x + i * gap + Math.sin(tilt) * h, feetY - Math.cos(tilt) * h);
      ctx.stroke();
    }
    if (!fallen) {
      ctx.beginPath(); ctx.moveTo(x - gap, feetY - h); ctx.lineTo(x + gap, feetY - h); ctx.stroke();
    }
  }
}

// The bat continues the forearm's direction out from the hands. Hands held together share one bat;
// hands apart each get one, so a one-handed swing still counts.
function bats(p) {
  const hands = p.hands.filter((h) => h.v >= 0.3);
  if (hands.length === 2 && Math.hypot(hands[0].x - hands[1].x, hands[0].y - hands[1].y) < p.sw * 0.8) {
    const [a, b] = hands;
    const fast = a.speed >= b.speed ? a : b;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const elbow = { x: (a.elbow.x + b.elbow.x) / 2, y: (a.elbow.y + b.elbow.y) / 2 };
    return [batFrom(mid, elbow, p.sw, fast)];
  }
  return hands.map((h) => batFrom(h, h.elbow, p.sw, h));
}

function batFrom(hand, elbow, sw, motion) {
  let dx = hand.x - elbow.x, dy = hand.y - elbow.y;
  const len = Math.hypot(dx, dy) || 1;
  dx /= len; dy /= len;
  return { x1: hand.x, y1: hand.y, x2: hand.x + dx * sw * 1.4, y2: hand.y + dy * sw * 1.4, speed: motion.speed, vx: motion.vx, vy: motion.vy };
}

function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

runGame({
  title: 'Cricket',
  lead: 'You are the batter. Stand side-on or face the camera, hands together like holding a bat.',
  howTo: ['Swing your hands when the ball reaches you', 'A fast swing hits a FOUR or a SIX', 'Miss a straight ball and you are out', '12 balls, 3 wickets'],
  tint: 'rgba(20, 90, 40, 0.35)',
  scene: false,
  split: true,
  seconds: null,
  levels: LEVELS,
  create: (opts) => new Batting(opts),
});
