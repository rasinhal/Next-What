// Table tennis, seen from the side. Your hand is the paddle: move it to meet the ball after it bounces on your side.
// One player plays the computer; two players play each other, one on each half of the screen.
import { runGame } from './shared/shell.js';
import { PLAYER_COLORS } from './shared/players.js';
import { sfx } from './shared/sound.js';

// paddle: paddle radius (screen heights). flight: seconds a return takes to land. cpu: computer speed and aim error.
const LEVELS = {
  little: { paddle: 0.11, flight: 1.5, smash: 5, cpuSpeed: 0.8, cpuError: 0.12, points: 5 },
  kids: { paddle: 0.085, flight: 1.15, smash: 5.5, cpuSpeed: 1.2, cpuError: 0.075, points: 7 },
  big: { paddle: 0.065, flight: 0.9, smash: 6, cpuSpeed: 1.8, cpuError: 0.045, points: 11 },
};
const SERVE_WAIT = 1.3;
const POINT_WAIT = 1.4;
const CPU_PADDLE = 0.07;

class TableTennis {
  constructor({ view, level, count }) {
    this.view = view;
    this.level = level;
    this.vsCpu = count === 1;
  }

  begin() {
    this.scores = [0, 0];
    this.server = 0;
    this.served = 0;
    this.paddles = [0, 1].map((side) => ({ side, x: 0, y: 0, ready: false, speed: 0 }));
    this.cpuAim = 0;
    this.message = null;
    this.done = false;
    this.startServe();
  }

  // ---------- Table geometry (recomputed each frame so it follows screen size) ----------

  geom() {
    const v = this.view;
    const H = v.h, W = v.w;
    return {
      W, H,
      tableY: v.y + H * 0.7,
      left: v.x + W * 0.2,
      right: v.x + W * 0.8,
      netX: v.x + W / 2,
      netTop: v.y + H * 0.7 - H * 0.075,
      zone: [v.x + W * 0.12, v.x + W * 0.88], // paddle home x for each side
      zoneHalf: W * 0.06,
      ballR: H * 0.02,
      gravity: H * 2.2,
    };
  }

  names() {
    return this.vsCpu ? ['You', 'Computer'] : ['Player 1', 'Player 2'];
  }

  hud() {
    const [a, b] = this.names();
    return [`${a} ${this.scores[0]}`, `${this.scores[1]} ${b}`];
  }

  result() {
    const [a, b] = this.scores;
    const names = this.names();
    let title;
    if (this.vsCpu) title = a > b ? 'You win!' : 'The computer wins this time!';
    else title = a === b ? "It's a tie!" : `${names[a > b ? 0 : 1]} wins!`;
    return { score: `${a} : ${b}`, title, lines: [`${names[0]} ${a}, ${names[1]} ${b}`] };
  }

  // ---------- Rally ----------

  startServe() {
    this.phase = 'serve';
    this.timer = SERVE_WAIT;
    this.ball = null;
    this.bounces = 0;
    this.lastHitter = -1;
  }

  serve() {
    const g = this.geom();
    const s = this.server;
    const x = g.zone[s] + (s === 0 ? g.zoneHalf : -g.zoneHalf);
    this.ball = { x, y: g.tableY - g.H * 0.25, vx: 0, vy: 0 };
    this.launch(s, 1.1);
    this.phase = 'rally';
  }

  // Sends the ball from its current position to land on the other side, clearing the net.
  launch(hitter, flightScale) {
    const g = this.geom();
    const b = this.ball;
    const target = hitter === 0
      ? g.netX + (g.right - g.netX) * (0.3 + Math.random() * 0.5)
      : g.netX - (g.netX - g.left) * (0.3 + Math.random() * 0.5);
    let t = this.level.flight * flightScale;
    for (let tries = 0; tries < 8; tries++) {
      const vx = (target - b.x) / t;
      const vy = (g.tableY - g.ballR - b.y - 0.5 * g.gravity * t * t) / t;
      const tn = (g.netX - b.x) / vx;
      const yNet = b.y + vy * tn + 0.5 * g.gravity * tn * tn;
      b.vx = vx;
      b.vy = vy;
      if (tn < 0 || yNet < g.netTop - g.ballR * 3) break;
      t *= 1.15; // too flat to clear the net: lob it higher
    }
    this.lastHitter = hitter;
    this.bounces = 0;
    this.cpuAim = (Math.random() * 2 - 1) * this.level.cpuError * g.H;
  }

  update(dt, now, players) {
    const g = this.geom();
    if (this.message) {
      this.message.life -= dt;
      if (this.message.life <= 0) this.message = null;
    }
    this.movePaddles(dt, players, g);
    if (this.done) return;

    if (this.phase === 'serve') {
      this.timer -= dt;
      if (this.timer <= 0) this.serve();
      return;
    }
    if (this.phase === 'point') {
      this.timer -= dt;
      if (this.timer <= 0) {
        if (this.scores.some((s) => s >= this.level.points)) { this.done = true; return; }
        this.startServe();
      }
      return;
    }

    // Small steps so a fast ball cannot skip through a paddle or the table.
    const steps = 3;
    for (let i = 0; i < steps && this.phase === 'rally'; i++) this.step(dt / steps, g);
  }

  step(dt, g) {
    const b = this.ball;
    b.vy += g.gravity * dt;
    b.x += b.vx * dt;
    b.y += b.vy * dt;

    // Bounce on the table.
    if (b.vy > 0 && b.y + g.ballR >= g.tableY && b.x > g.left && b.x < g.right) {
      b.y = g.tableY - g.ballR;
      b.vy = -b.vy * 0.85;
      sfx.bounce();
      const sideOfBall = b.x < g.netX ? 0 : 1;
      if (sideOfBall === this.lastHitter) { this.pointTo(1 - this.lastHitter, 'Bounced on own side'); return; }
      this.bounces++;
      if (this.bounces >= 2) { this.pointTo(this.lastHitter, 'Two bounces!'); return; }
    }

    // A paddle hit sends it back. The ball must be travelling toward that paddle's side.
    for (const pd of this.paddles) {
      if (!pd.ready || pd.side === this.lastHitter) continue;
      const toward = pd.side === 0 ? b.vx < 0 : b.vx > 0;
      if (!toward) continue;
      const r = (pd.side === 1 && this.vsCpu ? CPU_PADDLE : this.level.paddle) * g.H;
      if (Math.hypot(b.x - pd.x, b.y - pd.y) < r + g.ballR) {
        const smash = pd.speed > this.level.smash;
        // A ball that has not bounced yet (volley) is fine too: kids should not lose points for being eager.
        this.launch(pd.side, smash ? 0.7 : 1);
        sfx.paddle();
        if (smash) this.message = { text: 'Smash!', life: 0.8, color: '#ffd23f' };
        return;
      }
    }

    // Out of play.
    if (b.y > g.H + this.view.y || b.x < this.view.x - g.ballR * 4 || b.x > this.view.x + g.W + g.ballR * 4) {
      const receiver = 1 - this.lastHitter;
      // If it bounced on the receiver's side, the receiver missed it; otherwise the shot was out.
      this.pointTo(this.bounces ? this.lastHitter : receiver, this.bounces ? 'Missed it!' : 'Out!');
    }
  }

  pointTo(winner, reason) {
    this.scores[winner]++;
    this.phase = 'point';
    this.timer = POINT_WAIT;
    sfx.point();
    const name = this.names()[winner];
    this.message = { text: `Point ${name === 'You' ? 'to you' : name}!`, sub: reason, life: POINT_WAIT, color: winner === 0 ? PLAYER_COLORS[0] : PLAYER_COLORS[1] };
    this.served++;
    if (this.served % 2 === 0) this.server = 1 - this.server;
  }

  movePaddles(dt, players, g) {
    for (const pd of this.paddles) {
      const zx = g.zone[pd.side];
      let tx, ty;
      if (pd.side === 1 && this.vsCpu) {
        tx = zx;
        ty = this.cpuTarget(g);
        const maxMove = this.level.cpuSpeed * g.H * dt;
        pd.x = tx;
        pd.y = pd.ready ? pd.y + Math.max(-maxMove, Math.min(maxMove, ty - pd.y)) : ty;
        pd.ready = true;
        continue;
      }
      const p = players[pd.side];
      const hand = p && p.present ? this.pickHand(p) : null;
      if (!hand) { pd.ready = false; continue; }
      // Height follows the hand directly; reaching toward the table moves the paddle in a little.
      const reach = (hand.x - p.center.x) * 0.6;
      tx = zx + Math.max(-g.zoneHalf, Math.min(g.zoneHalf, reach));
      ty = Math.max(this.view.y + g.H * 0.08, Math.min(this.view.y + g.H * 0.97, hand.y));
      if (!pd.ready) { pd.x = tx; pd.y = ty; }
      const k = Math.min(1, dt * 25);
      pd.x += (tx - pd.x) * k;
      pd.y += (ty - pd.y) * k;
      pd.speed = hand.speed;
      pd.ready = true;
    }
  }

  // Either hand can play. Use the one nearest the ball's height so kids do not have to think about it.
  pickHand(p) {
    const hands = p.hands.filter((h) => h.v > 0.3);
    if (!hands.length) return null;
    const by = this.ball ? this.ball.y : this.geom().tableY - this.view.h * 0.2;
    return hands.reduce((a, b) => (Math.abs(a.y - by) <= Math.abs(b.y - by) ? a : b));
  }

  // The computer predicts where the ball will cross its paddle line, plus some aim error.
  cpuTarget(g) {
    const rest = g.tableY - g.H * 0.22;
    const b = this.ball;
    if (!b || this.phase !== 'rally' || b.vx <= 0) return rest;
    let { x, y, vx, vy } = b;
    const zx = g.zone[1];
    for (let i = 0; i < 400 && x < zx; i++) {
      const dt = 1 / 120;
      vy += g.gravity * dt;
      x += vx * dt;
      y += vy * dt;
      if (vy > 0 && y + g.ballR >= g.tableY && x > g.left && x < g.right) vy = -vy * 0.85;
    }
    return y + this.cpuAim;
  }

  // ---------- Drawing ----------

  draw(ctx) {
    const g = this.geom();
    const v = this.view;
    const thick = g.H * 0.025;

    // Legs, top and edge of the table.
    ctx.fillStyle = 'rgba(30,30,30,0.85)';
    for (const x of [g.left + g.W * 0.04, g.right - g.W * 0.05]) ctx.fillRect(x, g.tableY + thick, g.W * 0.012, v.y + g.H - g.tableY);
    ctx.fillStyle = 'rgba(16, 92, 160, 0.92)';
    ctx.fillRect(g.left, g.tableY - thick * 0.4, g.right - g.left, thick);
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.fillRect(g.left, g.tableY - thick * 0.4, g.right - g.left, thick * 0.18);
    // Net
    ctx.fillStyle = 'rgba(240,240,240,0.9)';
    ctx.fillRect(g.netX - g.W * 0.003, g.netTop, g.W * 0.006, g.tableY - g.netTop);
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillRect(g.netX - g.W * 0.012, g.netTop, g.W * 0.024, (g.tableY - g.netTop) * 0.9);

    for (const pd of this.paddles) {
      if (!pd.ready) continue;
      const r = (pd.side === 1 && this.vsCpu ? CPU_PADDLE : this.level.paddle) * g.H;
      const color = pd.side === 0 ? '#e53935' : '#1e88e5';
      ctx.strokeStyle = '#8d5a2b';
      ctx.lineWidth = r * 0.3;
      ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(pd.x, pd.y + r * 0.8); ctx.lineTo(pd.x, pd.y + r * 1.6); ctx.stroke();
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(pd.x, pd.y, r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.8)';
      ctx.lineWidth = Math.max(2, r * 0.08);
      ctx.stroke();
    }

    const b = this.ball || (this.phase === 'serve' ? this.serveBallPreview(g) : null);
    if (b) {
      if (b.x > g.left && b.x < g.right && b.y < g.tableY) {
        const k = Math.max(0.2, 1 - (g.tableY - b.y) / g.H);
        ctx.fillStyle = `rgba(0,0,0,${0.35 * k})`;
        ctx.beginPath(); ctx.ellipse(b.x, g.tableY - thick * 0.4, g.ballR * 1.2 * k, g.ballR * 0.35, 0, 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = '#ffb74d';
      ctx.beginPath(); ctx.arc(b.x, b.y, g.ballR, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.beginPath(); ctx.arc(b.x - g.ballR * 0.3, b.y - g.ballR * 0.3, g.ballR * 0.35, 0, Math.PI * 2); ctx.fill();
    }

    const font = Math.round(Math.min(g.W * 0.06, g.H * 0.08));
    ctx.textAlign = 'center';
    ctx.lineWidth = font * 0.12;
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    let text = '', sub = '', color = '#fff';
    if (this.message) {
      ({ text, sub = '', color } = this.message);
    } else if (this.phase === 'serve') {
      const n = this.names()[this.server];
      text = n === 'You' ? 'Your serve' : `${n} serves`;
    }
    if (text) {
      ctx.font = `900 ${font}px ui-rounded, system-ui, sans-serif`;
      ctx.fillStyle = color;
      ctx.strokeText(text, g.netX, v.y + g.H * 0.2);
      ctx.fillText(text, g.netX, v.y + g.H * 0.2);
    }
    if (sub) {
      ctx.font = `700 ${Math.round(font * 0.5)}px ui-rounded, system-ui, sans-serif`;
      ctx.fillStyle = '#fff';
      ctx.strokeText(sub, g.netX, v.y + g.H * 0.27);
      ctx.fillText(sub, g.netX, v.y + g.H * 0.27);
    }
    if (!this.paddles[0].ready || (!this.vsCpu && !this.paddles[1].ready)) {
      ctx.font = `700 ${Math.round(font * 0.45)}px ui-rounded, system-ui, sans-serif`;
      ctx.fillStyle = '#fff';
      for (const pd of this.paddles) {
        if (pd.ready) continue;
        ctx.strokeText('Show your hand!', g.zone[pd.side] + (pd.side ? -1 : 1) * g.W * 0.04, v.y + g.H * 0.45);
        ctx.fillText('Show your hand!', g.zone[pd.side] + (pd.side ? -1 : 1) * g.W * 0.04, v.y + g.H * 0.45);
      }
    }
  }

  serveBallPreview(g) {
    const s = this.server;
    return { x: g.zone[s] + (s === 0 ? g.zoneHalf : -g.zoneHalf), y: g.tableY - g.H * 0.25 - Math.abs(Math.sin(this.timer * 5)) * g.H * 0.05 };
  }
}

runGame({
  title: 'Table Tennis',
  lead: 'Your hand is the paddle. Play the computer, or a friend standing on the other half of the screen.',
  howTo: ['Move your hand up and down to meet the ball', 'Hit it after it bounces on your side', 'Swing fast for a smash', 'Either hand works'],
  tint: 'rgba(10, 30, 60, 0.4)',
  scene: false,
  split: false,
  seconds: null,
  levels: LEVELS,
  create: (opts) => new TableTennis(opts),
});
