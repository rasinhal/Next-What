// Particles, floating text and screen shake: the small effects that make a hit feel like a hit.

export class Fx {
  constructor() {
    this.parts = [];
    this.texts = [];
    this.shake = 0;
  }

  // n particles flying out from (x, y); size and speed in pixels.
  burst(x, y, color, { n = 12, speed = 300, size = 8, life = 0.6, gravity = 600 } = {}) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.4 + Math.random() * 0.8);
      this.parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, size: size * (0.5 + Math.random()), life, max: life, color, gravity });
    }
  }

  text(x, y, str, color = '#fff', size = 48, life = 0.9) {
    this.texts.push({ x, y, str, color, size, life, max: life });
  }

  bump(amount) {
    this.shake = Math.max(this.shake, amount);
  }

  update(dt) {
    for (const p of this.parts) {
      p.vy += p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
    }
    this.parts = this.parts.filter((p) => p.life > 0);
    for (const t of this.texts) { t.y -= t.size * 1.2 * dt; t.life -= dt; }
    this.texts = this.texts.filter((t) => t.life > 0);
    this.shake = Math.max(0, this.shake - dt * this.shake * 8 - dt * 2);
  }

  // Call before drawing the scene; restore() afterwards.
  applyShake(ctx) {
    ctx.save();
    if (this.shake > 0.5) ctx.translate((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake);
  }

  draw(ctx) {
    for (const p of this.parts) {
      ctx.globalAlpha = Math.max(0, p.life / p.max);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = 'center';
    for (const t of this.texts) {
      const k = t.life / t.max;
      ctx.globalAlpha = Math.min(1, k * 2);
      const pop = 1 + Math.max(0, k - 0.8) * 2; // quick pop-in
      ctx.font = `900 ${Math.round(t.size * pop)}px ui-rounded, system-ui, sans-serif`;
      ctx.lineWidth = t.size * 0.12;
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.strokeText(t.str, t.x, t.y);
      ctx.fillStyle = t.color;
      ctx.fillText(t.str, t.x, t.y);
    }
    ctx.globalAlpha = 1;
  }
}

// Shortest distance from point (px, py) to the segment (x1, y1)-(x2, y2).
export function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

// Remembers where each hand was last frame, so a fast hand that jumps past a target between
// tracking frames still counts as touching it (the path between the two points is tested).
export class HandPaths {
  constructor() {
    this.last = new Map();
  }

  // Returns [{ key, x1, y1, x2, y2, speed, owner, hand, sw }] for this frame; key is unique per hand.
  segments(players) {
    const out = [];
    for (const p of players) {
      if (!p || !p.present) continue;
      p.hands.forEach((h, k) => {
        if (h.v < 0.3) return;
        const key = p.id * 2 + k;
        const last = this.last.get(key);
        const prev = last && p.seenAt - last.t < 150 ? last : null; // a hand that vanished for a while starts fresh
        out.push({ key, x1: prev ? prev.x : h.x, y1: prev ? prev.y : h.y, x2: h.x, y2: h.y, speed: h.speed, owner: p.id, hand: h, sw: p.sw });
        this.last.set(key, { x: h.x, y: h.y, t: p.seenAt });
      });
    }
    return out;
  }
}
