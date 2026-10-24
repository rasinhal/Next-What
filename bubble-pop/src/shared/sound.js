// Tiny synthesized sound effects, so no audio files need to be bundled.

let audio = null;

// Must be called from a tap or click: browsers only allow sound after a user gesture.
export function initAudio() {
  if (audio) return;
  try { audio = new (window.AudioContext || window.webkitAudioContext)(); } catch (_) { audio = null; }
}

function tone(freq, dur, { type = 'sine', vol = 0.2, to = null, delay = 0 } = {}) {
  if (!audio) return;
  const t = audio.currentTime + delay;
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (to) osc.frequency.exponentialRampToValueAtTime(to, t + dur);
  gain.gain.setValueAtTime(vol, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
  osc.connect(gain).connect(audio.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

function noise(dur, vol = 0.2) {
  if (!audio) return;
  const len = Math.floor(audio.sampleRate * dur);
  const buf = audio.createBuffer(1, len, audio.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = audio.createBufferSource();
  const gain = audio.createGain();
  gain.gain.value = vol;
  src.buffer = buf;
  src.connect(gain).connect(audio.destination);
  src.start();
}

export const sfx = {
  tick: () => tone(660, 0.08, { type: 'square', vol: 0.08 }),
  go: () => tone(990, 0.25, { type: 'square', vol: 0.1 }),
  coin: () => { tone(988, 0.07, { type: 'square', vol: 0.08 }); tone(1319, 0.12, { type: 'square', vol: 0.08, delay: 0.07 }); },
  jump: () => tone(300, 0.2, { type: 'triangle', vol: 0.15, to: 700 }),
  crash: () => { noise(0.3, 0.25); tone(160, 0.3, { type: 'sawtooth', vol: 0.1, to: 60 }); },
  bat: () => { noise(0.06, 0.4); tone(220, 0.1, { type: 'triangle', vol: 0.2 }); },
  bounce: () => tone(420, 0.05, { type: 'sine', vol: 0.2 }),
  paddle: () => { tone(700, 0.05, { type: 'triangle', vol: 0.25 }); noise(0.03, 0.15); },
  cheer: () => { for (let i = 0; i < 4; i++) tone(523 * (1 + i * 0.25), 0.18, { type: 'square', vol: 0.06, delay: i * 0.09 }); },
  out: () => { tone(330, 0.25, { type: 'sawtooth', vol: 0.1 }); tone(220, 0.4, { type: 'sawtooth', vol: 0.1, delay: 0.22 }); },
  point: () => tone(880, 0.15, { type: 'sine', vol: 0.15 }),
};
