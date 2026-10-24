// Shared game flow for the motion games: menu, camera start, "raise a hand" ready check, countdown, play loop, results.
// Each game only supplies its rules and drawing through runGame(def).
import { Players, SKELETON, PLAYER_COLORS, coverRect, handUp } from './players.js';
import { initAudio, sfx } from './sound.js';

const LEVEL_CHOICES = [
  ['little', 'Little kids', '3 to 6'],
  ['kids', 'Kids', '7 to 12'],
  ['big', 'Teens and adults', '13+'],
];
const COUNTDOWN_MS = 3000;
const LONELY_HINT_MS = 5000;

const $ = (id) => document.getElementById(id);

/**
 * def: {
 *   title, lead, howTo: [strings], tint (camera overlay colour), scene (game paints its own background),
 *   split (one game per player, side by side) or shared (one game for everyone), seconds (round length or null),
 *   levels: { little, kids, big }, create({ view, level, id, count }) -> game
 * }
 * A game has begin(players), update(dt, now, players), draw(ctx, now), hud(), done, result().
 * For split games `players` is that game's own player; for shared games it is the list of all players.
 */
export function runGame(def) {
  document.title = def.title;
  document.body.insertAdjacentHTML('beforeend', template(def));

  const canvas = $('stage');
  const ctx = canvas.getContext('2d');
  const params = new URLSearchParams(location.search);
  const settings = { level: 'kids', players: 1, debug: params.has('debug') };
  $('showDebug').checked = settings.debug;
  const players = new Players();

  let tracker = null;
  let state = 'menu'; // menu | ready | countdown | play | over
  let games = [];
  let views = [];
  let countdownEnd = 0;
  let roundEnd = 0;
  let readySince = 0;
  let lonelySince = 0;
  let lastFrame = 0;
  let lastTick = 0;
  let wakeLock = null;
  const fps = { frames: 0, since: 0, value: 0, inferMs: 0 };

  // Lets automated tests (with ?sim) look inside the running game.
  if (params.has('sim')) window.__game = { get state() { return state; }, get games() { return games; }, players, canvas };

  // ---------- Menu ----------

  pick('level', (v) => { settings.level = v; });
  pick('players', (v) => { settings.players = Number(v); });
  $('showDebug').addEventListener('change', (e) => { settings.debug = e.target.checked; });
  $('start').addEventListener('click', start);
  $('again').addEventListener('click', () => { show(null); toReady(); });
  $('toMenu').addEventListener('click', toMenu);
  $('retry').addEventListener('click', toMenu);
  $('quit').addEventListener('click', toMenu);
  $('startNow').addEventListener('click', () => { if (state === 'ready') toCountdown(performance.now()); });
  window.addEventListener('keydown', (e) => {
    if (state === 'ready' && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); toCountdown(performance.now()); }
    if (e.key === 'Escape' && state !== 'menu') toMenu();
  });

  function pick(groupId, onPick) {
    $(groupId).addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      for (const b of $(groupId).querySelectorAll('button')) b.classList.toggle('on', b === btn);
      onPick(btn.dataset.value);
    });
  }

  function show(panelId) {
    for (const id of ['menu', 'loading', 'over', 'error']) $(id).hidden = id !== panelId;
  }

  function setHint(text) {
    $('hint').hidden = !text;
    if ($('hint').textContent !== text) $('hint').textContent = text;
  }

  function toMenu() {
    state = 'menu';
    $('hud').hidden = true;
    $('startNow').hidden = true;
    $('quit').hidden = true;
    $('debug').hidden = true;
    setHint('');
    show('menu');
  }

  function fail(message) {
    toMenu();
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
        if (params.has('sim')) {
          const { createSimTracker } = await import('./sim.js');
          tracker = await createSimTracker({ players: settings.players });
        } else {
          const { createTracker } = await import('./tracking.js');
          tracker = await createTracker({ players: settings.players });
        }
      } else {
        await tracker.setPlayers(settings.players);
      }
    } catch (err) {
      console.error(err);
      fail(explain(err));
      return;
    }
    requestWakeLock();
    show(null);
    $('quit').hidden = false;
    $('debug').hidden = !settings.debug;
    toReady();
    lastFrame = performance.now();
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
      if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
    } catch (_) { /* optional */ }
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state !== 'menu') requestWakeLock();
  });

  // ---------- Layout ----------

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(window.innerWidth * dpr);
    canvas.height = Math.round(window.innerHeight * dpr);
    layoutViews();
  }

  // Views are updated in place so games always read the current size.
  function layoutViews() {
    const n = def.split ? settings.players : 1;
    while (views.length < n) views.push({});
    views.length = n;
    const w = canvas.width / n;
    views.forEach((v, i) => Object.assign(v, { x: i * w, y: 0, w, h: canvas.height }));
  }
  window.addEventListener('resize', resize);
  resize();

  // ---------- States ----------

  function toReady() {
    state = 'ready';
    games = [];
    readySince = 0;
    lonelySince = 0;
    players.reset(settings.players);
    layoutViews();
    $('hud').hidden = true;
    $('startNow').hidden = false;
    setHint(readyText(0));
  }

  function readyText(up) {
    if (settings.players === 2) return `Both players: raise a hand to start! (${up}/2 ready)`;
    return 'Raise a hand above your head to start!';
  }

  function toCountdown(now) {
    state = 'countdown';
    countdownEnd = now + COUNTDOWN_MS;
    lastTick = 0;
    $('startNow').hidden = true;
  }

  function toPlay(now) {
    state = 'play';
    sfx.go();
    const level = def.levels[settings.level];
    if (def.split) {
      games = views.map((view, id) => def.create({ view, level, id, count: settings.players }));
      games.forEach((g, id) => g.begin(players.list[id], now));
    } else {
      games = [def.create({ view: views[0], level, id: 0, count: settings.players })];
      games[0].begin(players.list, now);
    }
    roundEnd = def.seconds ? now + def.seconds * 1000 : 0;
    $('hud').hidden = false;
    setHint('');
  }

  function toOver() {
    state = 'over';
    $('hud').hidden = true;
    setHint('');
    sfx.cheer();
    const results = games.map((g) => g.result());
    let title = def.split ? results[0].title || 'Well played!' : results[0].title;
    let html = '';
    if (def.split && results.length === 2) {
      const [a, b] = results;
      title = a.score === b.score ? "It's a tie!" : `Player ${a.score > b.score ? 1 : 2} wins!`;
      html = results.map((r, i) => `<div class="side" style="--pc:${PLAYER_COLORS[i]}"><b>Player ${i + 1}</b>` +
        `<span class="big-num">${r.score}</span>${r.lines.map((l) => `<small>${l}</small>`).join('')}</div>`).join('');
      html = `<div class="sides">${html}</div>`;
    } else {
      const r = results[0];
      html = `<span class="big-num">${r.score}</span>${r.lines.map((l) => `<small>${l}</small>`).join('')}`;
    }
    $('overTitle').textContent = title;
    $('overBody').innerHTML = html;
    show('over');
  }

  // ---------- Loop ----------

  function loop(now) {
    if (state === 'menu') return;
    requestAnimationFrame(loop);
    const dt = Math.min(0.05, (now - lastFrame) / 1000);
    lastFrame = now;

    const t0 = performance.now();
    const detections = tracker.detect(now);
    if (detections) {
      fps.inferMs = performance.now() - t0;
      fps.frames++;
      players.update(detections, coverRect(tracker.video, canvas), now);
    }
    players.expire(now);
    if (now - fps.since > 1000) {
      fps.value = Math.round((fps.frames * 1000) / (now - fps.since || 1));
      fps.frames = 0;
      fps.since = now;
    }

    if (state === 'ready') updateReady(now);
    if (state === 'countdown') {
      const left = Math.ceil((countdownEnd - now) / 1000);
      if (left !== lastTick && left > 0) { lastTick = left; sfx.tick(); }
      setHint(left > 0 ? `Get ready... ${left}` : 'Go!');
      if (now >= countdownEnd) toPlay(now);
    }
    if (state === 'play') updatePlay(dt, now);
    draw(now);

    if (settings.debug) {
      $('debug').textContent = `tracking ${fps.value} fps  (${fps.inferMs.toFixed(0)} ms/frame)\n` +
        `processor ${tracker.delegate || '?'}  players seen ${players.present.length}/${settings.players}\n` +
        `camera ${tracker.video.videoWidth || '-'}x${tracker.video.videoHeight || '-'}`;
    }
  }

  function updateReady(now) {
    const needed = settings.players;
    const seen = players.present.length;
    const up = players.list.filter(handUp).length;
    if (!seen) {
      readySince = 0;
      setHint('Step back until the camera can see you');
      return;
    }
    if (up >= needed) {
      if (!readySince) readySince = now;
      if (now - readySince > 400) toCountdown(now);
      return;
    }
    readySince = 0;
    if (needed === 2 && seen < 2) {
      if (!lonelySince) lonelySince = now;
      if (now - lonelySince > LONELY_HINT_MS) {
        setHint('Only one player found. Stand side by side, one on each half of the screen, a bit further back. Or tap "Start now".');
        return;
      }
    } else {
      lonelySince = 0;
    }
    setHint(readyText(up));
  }

  function updatePlay(dt, now) {
    if (def.split) games.forEach((g, i) => g.update(dt, now, players.list[i]));
    else games[0].update(dt, now, players.list);

    const huds = def.split ? games.map((g) => g.hud()) : games[0].hud();
    const remaining = roundEnd ? Math.max(0, Math.ceil((roundEnd - now) / 1000)) : null;
    renderHud(huds, remaining);

    if (!players.present.length) setHint('Step back until the camera can see you');
    else setHint('');

    if ((roundEnd && now >= roundEnd) || games.every((g) => g.done)) toOver();
  }

  function renderHud(items, remaining) {
    const cells = [];
    if (def.split) {
      items.forEach((text, i) => cells.push(`<div class="pill" style="color:${settings.players === 2 ? PLAYER_COLORS[i] : 'var(--accent)'}">${text}</div>`));
      if (remaining !== null) cells.splice(1, 0, `<div class="pill">${remaining}</div>`);
    } else {
      items.forEach((text) => cells.push(`<div class="pill">${text}</div>`));
      if (remaining !== null) cells.push(`<div class="pill">${remaining}</div>`);
    }
    const html = cells.join('');
    if ($('hudItems').innerHTML !== html) $('hudItems').innerHTML = html;
  }

  // ---------- Drawing ----------

  function draw(now) {
    const playing = state === 'play' && games.length;
    if (playing && def.scene) {
      for (const g of games) clipTo(g.view, () => g.draw(ctx, now));
      drawPip();
    } else {
      drawCamera(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = def.tint || 'rgba(0,0,0,0.3)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      if (playing) for (const g of games) clipTo(g.view, () => g.draw(ctx, now));
      drawSkeletons(1, 0, 0, playing);
      if (!playing) drawReadyMarks();
    }
    // Two players are tracked on separate halves of the camera picture, so always show the split.
    if (settings.players === 2 && state !== 'menu') {
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.fillRect(canvas.width / 2 - 2, 0, 4, canvas.height);
    }
  }

  function clipTo(v, fn) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(v.x, v.y, v.w, v.h);
    ctx.clip();
    fn();
    ctx.restore();
  }

  function drawCamera(x, y, w, h) {
    const video = tracker.video;
    // Same cover mapping as the landmarks, scaled into the target box, and mirrored.
    const r = coverRect(video, canvas);
    const sx = w / canvas.width, sy = h / canvas.height;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.translate(x + w, y);
    ctx.scale(-sx, sy);
    try { ctx.drawImage(video, canvas.width - r.x - r.w, r.y, r.w, r.h); } catch (_) { /* video not ready */ }
    ctx.restore();
  }

  // Small camera picture so players can see themselves while a game paints its own scene.
  function drawPip() {
    const w = Math.min(canvas.width * 0.24, canvas.height * 0.4), h = (w * canvas.height) / canvas.width;
    const m = canvas.height * 0.02;
    // Two players: between the two halves. One player: bottom right, clear of the game's centre.
    const x = views.length === 2 ? (canvas.width - w) / 2 : canvas.width - w - m, y = canvas.height - h - m;
    drawCamera(x, y, w, h);
    ctx.save();
    ctx.translate(x, y);
    drawSkeletons(w / canvas.width, 0, 0, false);
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 3;
    ctx.strokeRect(x, y, w, h);
  }

  function drawSkeletons(scale, ox, oy, faint) {
    for (const p of players.list) {
      if (!p.present) continue;
      ctx.strokeStyle = settings.players === 2 ? PLAYER_COLORS[p.id] : 'rgba(255,255,255,0.9)';
      ctx.globalAlpha = faint ? 0.45 : 0.85;
      ctx.lineWidth = Math.max(2, p.sw * 0.05 * scale);
      ctx.lineCap = 'round';
      for (const [a, b] of SKELETON) {
        if (p.lm[a].v < 0.4 || p.lm[b].v < 0.4) continue;
        ctx.beginPath();
        ctx.moveTo(ox + p.lm[a].x * scale, oy + p.lm[a].y * scale);
        ctx.lineTo(ox + p.lm[b].x * scale, oy + p.lm[b].y * scale);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
  }

  // During the ready check, label each player and show a tick once their hand is up.
  function drawReadyMarks() {
    const font = Math.round(canvas.height * 0.045);
    ctx.font = `800 ${font}px ui-rounded, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    for (const p of players.list) {
      if (!p.present) continue;
      const label = (settings.players === 2 ? `P${p.id + 1} ` : '') + (handUp(p) ? '✔' : '✋');
      const y = p.nose.y - p.sw * 1.1;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      const tw = ctx.measureText(label).width + font;
      ctx.fillRect(p.center.x - tw / 2, y - font, tw, font * 1.4);
      ctx.fillStyle = settings.players === 2 ? PLAYER_COLORS[p.id] : '#ffd23f';
      ctx.fillText(label, p.center.x, y);
    }
  }
}

function template(def) {
  const levels = LEVEL_CHOICES.map(([v, name, ages]) =>
    `<button type="button" data-value="${v}"${v === 'kids' ? ' class="on"' : ''}>${name}<small>${ages}</small></button>`).join('');
  const how = def.howTo.map((h) => `<li>${h}</li>`).join('');
  return `
  <canvas id="stage"></canvas>
  <div id="hud" hidden><div id="hudItems"></div></div>
  <button type="button" id="quit" class="quit" aria-label="Back to menu" hidden>✕</button>
  <button type="button" id="startNow" class="start-now" hidden>Start now</button>
  <div id="debug" hidden></div>
  <div id="hint" hidden></div>

  <section id="menu" class="panel">
    <a class="back" href="./index.html">← All games</a>
    <h1>${def.title}</h1>
    <p class="lead">${def.lead}</p>
    <ul class="how">${how}</ul>
    <fieldset>
      <legend>Who is playing?</legend>
      <div class="choices" id="level">${levels}</div>
    </fieldset>
    <fieldset>
      <legend>Players</legend>
      <div class="choices" id="players">
        <button type="button" data-value="1" class="on">1 player</button>
        <button type="button" data-value="2">2 players</button>
      </div>
    </fieldset>
    <label class="check"><input type="checkbox" id="showDebug"> Show tracking info (speed test)</label>
    <button type="button" id="start" class="big">Start</button>
    <p class="fine">Video stays on this device. Nothing is recorded or uploaded.</p>
  </section>

  <section id="loading" class="panel" hidden><h2 id="loadingText">Starting the camera...</h2></section>

  <section id="over" class="panel" hidden>
    <h2 id="overTitle">Well played!</h2>
    <div id="overBody" class="result"></div>
    <div class="row">
      <button type="button" id="again" class="big">Play again</button>
      <button type="button" id="toMenu">Menu</button>
    </div>
  </section>

  <section id="error" class="panel" hidden>
    <h2>Something went wrong</h2>
    <p id="errorText"></p>
    <button type="button" id="retry">Back to menu</button>
  </section>`;
}
