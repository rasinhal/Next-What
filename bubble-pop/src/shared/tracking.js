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

const WASM_PATH = './wasm';
const MODEL_PATH = './models/pose_landmarker_lite.task';
const OPTIONS = { runningMode: 'VIDEO', numPoses: 1, minPoseDetectionConfidence: 0.5, minTrackingConfidence: 0.5 };

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
    video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
  });
  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;
  await video.play();
  return stream;
}

export async function createTracker({ players = 1, video = document.createElement('video') } = {}) {
  await startCamera(video);

  const full = await createLandmarker();
  const halves = [];
  let numPlayers = 1;
  let lastVideoTime = -1;

  // One offscreen canvas per half; reused every frame.
  const crops = [0, 1].map(() => {
    const canvas = document.createElement('canvas');
    return { canvas, ctx: canvas.getContext('2d') };
  });

  async function setPlayers(n) {
    numPlayers = n === 2 ? 2 : 1;
    while (numPlayers === 2 && halves.length < 2) halves.push(await createLandmarker());
  }
  await setPlayers(players);

  // Whole frame, mirrored.
  function detectFull(now) {
    const result = full.lm.detectForVideo(video, now);
    return (result.landmarks || []).slice(0, 1).map((pose) => ({
      player: 0,
      lm: pose.map((p) => ({ x: 1 - p.x, y: p.y, z: p.z, visibility: p.visibility ?? 1 })),
    }));
  }

  // Player 0 is on the screen's left, which is the right half of the unmirrored camera image.
  function detectSplit(now) {
    const vw = video.videoWidth, vh = video.videoHeight, hw = Math.floor(vw / 2);
    const out = [];
    for (let player = 0; player < 2; player++) {
      const { canvas, ctx } = crops[player];
      if (canvas.width !== hw || canvas.height !== vh) { canvas.width = hw; canvas.height = vh; }
      const sx = player === 0 ? vw - hw : 0;
      ctx.drawImage(video, sx, 0, hw, vh, 0, 0, hw, vh);
      const result = halves[player].lm.detectForVideo(canvas, now);
      const pose = (result.landmarks || [])[0];
      if (!pose) continue;
      const offset = sx / vw, scale = hw / vw;
      out.push({
        player,
        lm: pose.map((p) => ({ x: 1 - (offset + p.x * scale), y: p.y, z: p.z, visibility: p.visibility ?? 1 })),
      });
    }
    return out;
  }

  function detect(now) {
    if (video.readyState < 2 || !video.videoWidth || video.currentTime === lastVideoTime) return null;
    lastVideoTime = video.currentTime;
    return numPlayers === 2 ? detectSplit(now) : detectFull(now);
  }

  return {
    video,
    get delegate() { return full.delegate; },
    get players() { return numPlayers; },
    setPlayers,
    detect,
  };
}
