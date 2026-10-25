import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';

// Shared camera + body tracking for every game.
//
// One player: one landmarker on the whole frame.
// Two players: the frame is split into left and right halves and each half gets its own
// landmarker looking for one person. Asking a single landmarker for two people on the full
// frame often finds only one (especially two children standing close together), and the
// split also gives each player a fixed side, so player 0 is always on the left of the screen.
//
// detect() returns landmarks normalized to the full camera frame and already mirrored,
// so x = 0 is the left edge of the screen as the players see it.
//
// Smoothness: frames are shrunk before tracking (less work per frame), every landmark goes
// through a One Euro filter (removes jitter when still, follows quickly when moving), and
// latest(now) predicts where each body is between camera frames so games can move hands
// at the screen's full frame rate instead of the camera's.

const WASM_PATH = './wasm';
const MODEL_PATH = './models/pose_landmarker_lite.task';
const OPTIONS = { runningMode: 'VIDEO', numPoses: 1, minPoseDetectionConfidence: 0.5, minTrackingConfidence: 0.5 };

// Height of the image handed to the tracker. The pose model itself works at 256 px, so this
// keeps enough detail for a small child at the back of a room while costing far less than 720p.
const TRACK_HEIGHT = 480;
// In two-player mode, if tracking both halves takes longer than this, track one half per
// camera frame instead so the game keeps a steady frame rate.
const SLOW_FRAME_MS = 28;
// latest() predicts at most this far past the last camera frame.
const MAX_PREDICT_MS = 80;
// One Euro filter settings for positions normalized to the frame (0..1).
const FILTER = { minCutoff: 1.5, beta: 4, dCutoff: 1 };

let filesetPromise = null;

async function createLandmarker() {
  filesetPromise ??= FilesetResolver.forVisionTasks(WASM_PATH);
  const fileset = await filesetPromise;
  try {
    const lm = await PoseLandmarker.createFromOptions(fileset, { ...OPTIONS, baseOptions: { modelAssetPath: MODEL_PATH, delegate: 'GPU' } });
    return { lm, delegate: 'GPU' };
  } catch (gpuErr) {
    console.warn('GPU delegate failed, using CPU', gpuErr);
    const lm = await PoseLandmarker.createFromOptions(fileset, { ...OPTIONS, baseOptions: { modelAssetPath: MODEL_PATH, delegate: 'CPU' } });
    return { lm, delegate: 'CPU' };
  }
}

async function startCamera(video) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error('no-media-devices');
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
  });
  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;
  await video.play();
  return stream;
}

// One Euro filter (Casiez, Roussel and Vogel, CHI 2012) for one value.
function lowpass(alpha, value, prev) {
  return prev === undefined ? value : prev + alpha * (value - prev);
}
function alphaFor(cutoff, dt) {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
}
class OneEuro {
  filter(value, dt) {
    if (this.x === undefined || !(dt > 0)) {
      this.x = value;
      this.dx = 0;
      return value;
    }
    const rawDx = (value - this.x) / dt;
    this.dx = lowpass(alphaFor(FILTER.dCutoff, dt), rawDx, this.dx);
    const cutoff = FILTER.minCutoff + FILTER.beta * Math.abs(this.dx);
    this.x = lowpass(alphaFor(cutoff, dt), value, this.x);
    return this.x;
  }
}

// Filtered landmarks for one player, plus their velocity for prediction.
class Body {
  constructor() {
    this.fx = [];
    this.fy = [];
    this.t = 0;
    this.lm = null;
  }

  reset() {
    this.fx = [];
    this.fy = [];
    this.lm = null;
  }

  update(raw, now) {
    // A long gap means the player left and came back: start fresh instead of gliding across the screen.
    const dt = (now - this.t) / 1000;
    if (!this.lm || dt > 0.5) this.reset();
    this.t = now;
    this.lm = raw.map((p, i) => {
      const fx = (this.fx[i] ??= new OneEuro()), fy = (this.fy[i] ??= new OneEuro());
      return { x: fx.filter(p.x, dt), y: fy.filter(p.y, dt), z: p.z, visibility: p.visibility };
    });
    return this.lm;
  }

  predict(now) {
    if (!this.lm) return null;
    const ahead = Math.min(MAX_PREDICT_MS, Math.max(0, now - this.t)) / 1000;
    return this.lm.map((p, i) => ({
      x: p.x + (this.fx[i]?.dx || 0) * ahead,
      y: p.y + (this.fy[i]?.dx || 0) * ahead,
      z: p.z,
      visibility: p.visibility,
    }));
  }
}

export async function createTracker({ players = 1, video = document.createElement('video') } = {}) {
  await startCamera(video);

  const full = await createLandmarker();
  const halves = [];
  const bodies = [new Body(), new Body()];
  let numPlayers = 1;
  let lastVideoTime = -1;
  let slow = false;
  let nextHalf = 0;

  // Reused canvases: the shrunk whole frame, and one per half.
  const makeCanvas = () => {
    const canvas = document.createElement('canvas');
    return { canvas, ctx: canvas.getContext('2d') };
  };
  const whole = makeCanvas();
  const crops = [makeCanvas(), makeCanvas()];

  async function setPlayers(n) {
    numPlayers = n === 2 ? 2 : 1;
    while (numPlayers === 2 && halves.length < 2) halves.push(await createLandmarker());
    for (const b of bodies) b.reset();
    slow = false;
  }
  await setPlayers(players);

  function shrink(target, sx, sw) {
    const vh = video.videoHeight;
    const scale = Math.min(1, TRACK_HEIGHT / vh);
    const w = Math.round(sw * scale), h = Math.round(vh * scale);
    if (target.canvas.width !== w || target.canvas.height !== h) { target.canvas.width = w; target.canvas.height = h; }
    target.ctx.drawImage(video, sx, 0, sw, vh, 0, 0, w, h);
    return target.canvas;
  }

  // Whole frame, mirrored.
  function detectFull(now) {
    const result = full.lm.detectForVideo(shrink(whole, 0, video.videoWidth), now);
    const pose = (result.landmarks || [])[0];
    if (!pose) return [];
    const raw = pose.map((p) => ({ x: 1 - p.x, y: p.y, z: p.z, visibility: p.visibility ?? 1 }));
    return [{ player: 0, lm: bodies[0].update(raw, now) }];
  }

  // Player 0 is on the screen's left, which is the right half of the unmirrored camera image.
  function detectHalf(player, now) {
    const vw = video.videoWidth, hw = Math.floor(vw / 2);
    const sx = player === 0 ? vw - hw : 0;
    const result = halves[player].lm.detectForVideo(shrink(crops[player], sx, hw), now);
    const pose = (result.landmarks || [])[0];
    if (!pose) return null;
    const offset = sx / vw, scale = hw / vw;
    const raw = pose.map((p) => ({ x: 1 - (offset + p.x * scale), y: p.y, z: p.z, visibility: p.visibility ?? 1 }));
    return { player, lm: bodies[player].update(raw, now) };
  }

  function detectSplit(now) {
    const order = slow ? [nextHalf] : [0, 1];
    nextHalf = 1 - nextHalf;
    const t0 = performance.now();
    const out = order.map((player) => detectHalf(player, now)).filter(Boolean);
    const ms = performance.now() - t0;
    // Switch to one half per frame when both together are too slow; switch back with some margin.
    if (!slow && ms > SLOW_FRAME_MS) slow = true;
    else if (slow && ms * 2 < SLOW_FRAME_MS * 0.6) slow = false;
    return out;
  }

  // Runs tracking when the camera has a new frame. Returns this frame's detections, or null
  // when there was no new camera frame. In two-player mode on a slow device only one player
  // may be in a given result; the other keeps their last position.
  function detect(now) {
    if (video.readyState < 2 || !video.videoWidth || video.currentTime === lastVideoTime) return null;
    lastVideoTime = video.currentTime;
    return numPlayers === 2 ? detectSplit(now) : detectFull(now);
  }

  // Every player seen in the last half second, at their predicted position for `now`.
  // Call once per animation frame (after detect) to draw and hit-test smoothly.
  function latest(now) {
    const out = [];
    for (let player = 0; player < numPlayers; player++) {
      const b = bodies[player];
      if (!b.lm || now - b.t > 500) continue;
      out.push({ player, lm: b.predict(now) });
    }
    return out;
  }

  return {
    video,
    get delegate() { return full.delegate; },
    get players() { return numPlayers; },
    setPlayers,
    detect,
    latest,
  };
}
