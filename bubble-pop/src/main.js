import { createTracker } from './shared/tracking.js';

// MediaPipe pose landmark indices.
const NOSE = 0, L_SHOULDER = 11, R_SHOULDER = 12, L_WRIST = 15, R_WRIST = 16, L_INDEX = 19, R_INDEX = 20;
const HAND_POINTS = [L_WRIST, R_WRIST, L_INDEX, R_INDEX];
const SKELETON = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28]];

// Per age group: bubble size (relative to shoulder width), rise speed (screen heights per second), spawn gap (s).
const LEVELS = {
  little: { size: 0.55, speed: 0.10, gap: 1.1, label: 'Little kids' },
  kids: { size: 0.42, speed: 0.15, gap: 0.8, label: 'Kids' },
  big: { size: 0.32, speed: 0.22, gap: 0.55, label: 'Teens and adults' },
};
const ROUND_SECONDS = 60;
const COLORS = ['#ff6b9a', '#5ad1ff', '#7dff9b', '#ffd23f', '#c49bff', '#ff9f43'];
const PLAYER_COLORS = ['rgba(255, 210, 63, 0.9)', 'rgba(90, 209, 255, 0.9)'];
const SIDE_NAMES = ['Left player', 'Right player'];

const $ = (id) => document.getElementById(id);
const video = $('cam');
const canvas = $('stage');
const ctx = canvas.getContext('2d');

const settings = { level: 'kids', players: 1, debug: false };
let tracker = null;
let state = 'menu'; // menu | ready | play | over
let bubbles = [];
let sparks = [];
let poses = []; // [{ player, pts: [{x, y, v}] }] in canvas pixels
let scores = [0, 0];
let roundEnd = 0;
let nextSpawn = 0;
let readySince = 0;
let lastSeen = 0;
let fps = { frames: 0, since: performance.now(), value: 0, inferMs: 0 };
let audio = null;

// ---------- Menu ----------

function pick(groupId, attr, key, parse = (v) => v) {
  $(groupId).addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    for (const b of $(groupId).querySelectorAll('button')) b.classList.toggle('on', b === btn);
    settings[key] = parse(btn.dataset[attr]);
  });
}
pick('level', 'level', 'level');
pick('players', 'players', 'players', Number);
$('showDebug').addEventListener('change', (e) => { settings.debug = e.target.checked; });

$('start').addEventListener('click', start);
$('again').addEventListener('click', () => { show(null); toReady(); });
$('toMenu').addEventListener('click', toMenu);
$('retry').addEventListener('click', toMenu);
$('skip').addEventListener('click', () => { if (state === 'ready') toPlay(performance.now()); });

function show(panelId) {
  for (const id of ['menu', 'loading', 'over', 'error']) $(id).hidden = id !== panelId;
}

function hideGameUi() {
  $('hud').hidden = true;
  $('hint').hidden = true;
  $('debug').hidden = true;
  $('divider').hidden = true;
  $('skip').hidden = true;
}

function toMenu() {
  state = 'menu';
  hideGameUi();
  show('menu');
}

function fail(message) {
  state = 'menu';
  hideGameUi();
  $('errorText').textContent = message;
  show('error');
}

// ---------- Setup ----------

async function start() {
  initAudio();
  show('loading');
  try {
    if (!tracker) {
      $('loadingText').textContent = 'Starting the camera and body tracking...';
      tracker = await createTracker({ players: settings.players, video });
    } else {
      $('loadingText').textContent = 'Loading body tracking...';
      await tracker.setPlayers(settings.players);
    }
  } catch (err) {
    console.error(err);
    fail(explain(err));
    return;
  }
  requestWakeLock();
  show(null);
  $('debug').hidden = !settings.debug;
  $('divider').hidden = settings.players !== 2;
  toReady();
  requestAnimationFrame(loop);
}

function explain(err) {
  const name = err && err.name;
  if (name === 'NotAllowedError') return 'Camera permission was blocked. Allow the camera for this app in your settings, then try again.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No camera was found on this device.';
  if (name === 'NotReadableError') return 'The camera is being used by another app. Close it and try again.';
  if (!navigator.mediaDevices) return 'This browser cannot use the camera here. Open the game over https, or in Chrome or Safari.';
  return 'Body tracking could not start on this device. ' + (err && err.message ? err.message : '');
}

async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) await navigator.wakeLock.request('screen');
  } catch (_) { /* optional */ }
}

// ---------- Sound ----------

function initAudio() {
  if (audio) return;
  try { audio = new (window.AudioContext || window.webkitAudioContext)(); } catch (_) { audio = null; }
}

function popSound() {
  if (!audio) return;
  const t = audio.currentTime;
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(500 + Math.random() * 400, t);
  osc.frequency.exponentialRampToValueAtTime(1400, t + 0.08);
  gain.gain.setValueAtTime(0.25, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
  osc.connect(gain).connect(audio.destination);
  osc.start(t);
  osc.stop(t + 0.16);
}

// ---------- Game states ----------

function toReady() {
  state = 'ready';
  bubbles = [];
  sparks = [];
  scores = [0, 0];
  readySince = 0;
  $('hud').hidden = true;
  $('skip').hidden = false;
  setHint(settings.players === 2 ? 'One player on each side of the line. Raise both hands!' : 'Raise both hands to start!');
}

function toPlay(now) {
  state = 'play';
  scores = [0, 0];
  roundEnd = now + ROUND_SECONDS * 1000;
  nextSpawn = now;
  $('score1').textContent = '0';
  $('score2').textContent = '0';
  $('score2').hidden = settings.players !== 2;
  $('hud').hidden = false;
  $('skip').hidden = true;
  setHint('');
}

function toOver() {
  state = 'over';
  $('hud').hidden = true;
  setHint('');
  const final = $('final');
  final.replaceChildren();
  const add = (label, value, cls) => {
    const span = document.createElement('span');
    if (cls) span.className = cls;
    const b = document.createElement('b');
    b.textContent = String(value);
    span.append(b, label);
    final.append(span);
  };
  if (settings.players === 2) {
    add(SIDE_NAMES[0], scores[0]);
    add(SIDE_NAMES[1], scores[1], 'p2');
  } else {
    add('bubbles popped', scores[0]);
  }
  show('over');
}

function setHint(text) {
  $('hint').hidden = !text;
  $('hint').textContent = text;
}

// ---------- Geometry ----------

// The video is drawn mirrored and cropped to cover the screen; landmarks go through the same mapping.
function coverRect() {
  const vw = video.videoWidth || 1280, vh = video.videoHeight || 720;
  const scale = Math.max(canvas.width / vw, canvas.height / vh);
  const w = vw * scale, h = vh * scale;
  return { x: (canvas.width - w) / 2, y: (canvas.height - h) / 2, w, h };
}

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(window.innerWidth * dpr);
  canvas.height = Math.round(window.innerHeight * dpr);
}
window.addEventListener('resize', resize);
resize();

function shoulderWidth(p) {
  return Math.hypot(p[L_SHOULDER].x - p[R_SHOULDER].x, p[L_SHOULDER].y - p[R_SHOULDER].y);
}

// Players' shoulder width in screen pixels, used to size bubbles so small children and tall adults both reach them.
function bodyScale() {
  const widths = poses.map((p) => shoulderWidth(p.pts)).filter((w) => w > 0);
  if (!widths.length) return canvas.width * (settings.players === 2 ? 0.08 : 0.15);
  return widths.reduce((a, b) => a + b, 0) / widths.length;
}

// ---------- Main loop ----------

function loop(now) {
  if (state === 'menu') return;
  requestAnimationFrame(loop);
  track(now);
  update(now);
  draw();
}

function track(now) {
  if (!tracker) return;
  const t0 = performance.now();
  const result = tracker.detect(now);
  if (!result) return;
  fps.inferMs = performance.now() - t0;
  fps.frames++;
  if (now - fps.since > 1000) {
    fps.value = Math.round((fps.frames * 1000) / (now - fps.since));
    fps.frames = 0;
    fps.since = now;
  }
  const rect = coverRect();
  poses = result.map(({ player, lm }) => ({
    player,
    pts: lm.map((p) => ({ x: rect.x + p.x * rect.w, y: rect.y + p.y * rect.h, v: p.visibility })),
  }));
  if (poses.length) lastSeen = now;
}

function handsUp(p) {
  return p[L_WRIST].y < p[NOSE].y && p[R_WRIST].y < p[NOSE].y && p[L_WRIST].v > 0.5 && p[R_WRIST].v > 0.5;
}

function update(now) {
  const dt = 1 / 60;

  if (state === 'ready') updateReady(now);

  if (state === 'play') {
    const level = LEVELS[settings.level];
    const remaining = Math.max(0, Math.ceil((roundEnd - now) / 1000));
    $('timer').textContent = String(remaining);
    if (remaining === 0) { toOver(); return; }

    if (now >= nextSpawn) {
      const r = Math.max(28, bodyScale() * level.size);
      bubbles.push({
        x: r + Math.random() * (canvas.width - 2 * r),
        y: canvas.height + r,
        r,
        vy: canvas.height * level.speed * (0.8 + Math.random() * 0.4),
        phase: Math.random() * Math.PI * 2,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
      });
      // Two players share the screen, so bubbles come twice as often.
      const gap = settings.players === 2 ? level.gap / 2 : level.gap;
      nextSpawn = now + gap * 1000 * (0.7 + Math.random() * 0.6);
    }

    const handR = bodyScale() * 0.12;
    for (const b of bubbles) {
      b.y -= b.vy * dt;
      b.phase += dt * 2;
      const bx = b.x + Math.sin(b.phase) * b.r * 0.3;
      if (b.popped) continue;
      for (const pose of poses) {
        const hit = HAND_POINTS.some((i) => pose.pts[i].v > 0.4 && Math.hypot(pose.pts[i].x - bx, pose.pts[i].y - b.y) < b.r + handR);
        if (!hit) continue;
        b.popped = true;
        scores[pose.player]++;
        $(pose.player === 0 ? 'score1' : 'score2').textContent = String(scores[pose.player]);
        popSound();
        for (let k = 0; k < 10; k++) {
          const a = (k / 10) * Math.PI * 2;
          sparks.push({ x: bx, y: b.y, vx: Math.cos(a) * b.r * 3, vy: Math.sin(a) * b.r * 3, life: 0.5, color: b.color });
        }
        break;
      }
    }
    bubbles = bubbles.filter((b) => !b.popped && b.y > -b.r);

    if (!poses.length && now - lastSeen > 1500) setHint('Step back until the camera can see you');
    else setHint('');
  }

  for (const s of sparks) { s.x += s.vx * dt; s.y += s.vy * dt; s.life -= dt; }
  sparks = sparks.filter((s) => s.life > 0);

  if (settings.debug) {
    $('debug').textContent = `tracking ${fps.value} fps  (${fps.inferMs.toFixed(0)} ms/frame)\n` +
      `processor ${tracker ? tracker.delegate : ''}  people ${poses.length}/${settings.players}\n` +
      `camera ${video.videoWidth}x${video.videoHeight}  level ${LEVELS[settings.level].label}`;
  }
}

// Start once every player is seen with both hands up for 3 seconds.
function updateReady(now) {
  const needed = settings.players;
  const seen = [false, false], up = [false, false];
  for (const p of poses) { seen[p.player] = true; if (handsUp(p.pts)) up[p.player] = true; }
  const allUp = up.slice(0, needed).every(Boolean);

  if (allUp) {
    if (!readySince) readySince = now;
    const left = 3 - Math.floor((now - readySince) / 1000);
    setHint(left > 0 ? `Get ready... ${left}` : 'Go!');
    if (now - readySince > 3000) toPlay(now);
    return;
  }
  readySince = 0;
  if (needed === 1) {
    setHint(seen[0] ? 'Raise both hands to start!' : 'Step back until the camera can see you');
    return;
  }
  const status = [0, 1].map((i) => `${SIDE_NAMES[i]}: ${up[i] ? 'ready' : seen[i] ? 'raise both hands' : 'step into your side'}`);
  setHint(status.join('   |   '));
}

function draw() {
  const rect = coverRect();
  ctx.save();
  ctx.translate(canvas.width, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(video, canvas.width - rect.x - rect.w, rect.y, rect.w, rect.h);
  ctx.restore();

  // Slight underwater tint so bubbles stand out against any room.
  ctx.fillStyle = 'rgba(11, 42, 74, 0.35)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const unit = bodyScale();
  for (const { player, pts: p } of poses) {
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = Math.max(3, unit * 0.04);
    ctx.lineCap = 'round';
    for (const [a, b] of SKELETON) {
      if (p[a].v < 0.4 || p[b].v < 0.4) continue;
      ctx.beginPath();
      ctx.moveTo(p[a].x, p[a].y);
      ctx.lineTo(p[b].x, p[b].y);
      ctx.stroke();
    }
    ctx.fillStyle = PLAYER_COLORS[player];
    for (const i of [L_INDEX, R_INDEX]) {
      if (p[i].v < 0.4) continue;
      ctx.beginPath();
      ctx.arc(p[i].x, p[i].y, unit * 0.12, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  for (const b of bubbles) {
    const bx = b.x + Math.sin(b.phase) * b.r * 0.3;
    const g = ctx.createRadialGradient(bx - b.r * 0.35, b.y - b.r * 0.35, b.r * 0.1, bx, b.y, b.r);
    g.addColorStop(0, 'rgba(255,255,255,0.9)');
    g.addColorStop(0.3, b.color + 'aa');
    g.addColorStop(1, b.color + '55');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(bx, b.y, b.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  for (const s of sparks) {
    ctx.globalAlpha = Math.max(0, s.life * 2);
    ctx.fillStyle = s.color;
    ctx.beginPath();
    ctx.arc(s.x, s.y, 8, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state !== 'menu') requestWakeLock();
});
