// Turns tracker detections into per-player body data in canvas pixels, with hand speeds for swings and hits.

export const NOSE = 0, L_SHOULDER = 11, R_SHOULDER = 12, L_ELBOW = 13, R_ELBOW = 14, L_WRIST = 15, R_WRIST = 16;
export const L_INDEX = 19, R_INDEX = 20, L_HIP = 23, R_HIP = 24;
export const SKELETON = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28]];
export const PLAYER_COLORS = ['#5ad1ff', '#ff9f43'];

// A hand is the wrist plus the index finger tip; [wrist, index, elbow].
const HANDS = [[L_WRIST, L_INDEX, L_ELBOW], [R_WRIST, R_INDEX, R_ELBOW]];
const LOST_AFTER_MS = 600;

// The video is drawn covering the screen; landmarks (already mirrored, 0..1) go through the same mapping.
export function coverRect(video, canvas) {
  const vw = video.videoWidth || 1280, vh = video.videoHeight || 720;
  const scale = Math.max(canvas.width / vw, canvas.height / vh);
  const w = vw * scale, h = vh * scale;
  return { x: (canvas.width - w) / 2, y: (canvas.height - h) / 2, w, h };
}

export class Players {
  constructor() {
    this.list = [];
  }

  reset(count) {
    this.list = Array.from({ length: count }, (_, id) => ({ id, present: false, seenAt: 0 }));
  }

  // detections: [{ player, lm: [{x, y, visibility}] }] from tracker.detect(); called only on new video frames.
  update(detections, rect, now) {
    for (const d of detections) {
      const p = this.list[d.player];
      if (!p) continue;
      const lm = d.lm.map((q) => ({ x: rect.x + q.x * rect.w, y: rect.y + q.y * rect.h, v: q.visibility ?? 1 }));
      const ls = lm[L_SHOULDER], rs = lm[R_SHOULDER];
      const sw = Math.max(8, Math.hypot(ls.x - rs.x, ls.y - rs.y));
      const center = { x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2 };
      const hip = { x: (lm[L_HIP].x + lm[R_HIP].x) / 2, y: (lm[L_HIP].y + lm[R_HIP].y) / 2 };
      const dt = p.present ? Math.max(0.008, (now - p.seenAt) / 1000) : 0;
      const hands = HANDS.map(([w, i, e], k) => {
        // Point a little past the wrist, between wrist and finger tip: steadier than either alone.
        const x = (lm[w].x * 2 + lm[i].x) / 3, y = (lm[w].y * 2 + lm[i].y) / 3;
        const prev = p.hands && p.hands[k];
        let vx = 0, vy = 0;
        if (prev && dt && dt < 0.25) {
          // Light smoothing so one noisy frame does not count as a swing.
          vx = prev.vx * 0.35 + ((x - prev.x) / dt) * 0.65;
          vy = prev.vy * 0.35 + ((y - prev.y) / dt) * 0.65;
        }
        return { x, y, vx, vy, speed: Math.hypot(vx, vy) / sw, v: Math.min(lm[w].v, 1), elbow: lm[e] };
      });
      Object.assign(p, { lm, sw, center, hip, nose: lm[NOSE], hands, seenAt: now, present: true });
    }
  }

  // Called every animation frame: a player not seen for a moment counts as gone.
  expire(now) {
    for (const p of this.list) if (p.present && now - p.seenAt > LOST_AFTER_MS) p.present = false;
  }

  get present() {
    return this.list.filter((p) => p.present);
  }
}

// Either hand clearly above the head. Easier for small children than both hands.
export function handUp(p) {
  if (!p.present) return false;
  return p.hands.some((h) => h.v > 0.4 && h.y < p.nose.y - p.sw * 0.15);
}
