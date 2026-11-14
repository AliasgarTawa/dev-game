import './style.css';
import './roots-preview.css';
import { initAudio } from './audio.js';

const initialStyle = new URLSearchParams(location.search).get('style') === 'night' ? 'night' : 'day';
const audio = initAudio({ level: 'roots', environment: initialStyle });
const scene = document.querySelector('.roots-preview__scene');
const status = document.querySelector('#preview-status');
const enable = document.querySelector('#enable-audio');
const pause = document.querySelector('#pause-audio');
const engine = document.querySelector('#engine-toggle');
const accelerate = document.querySelector('#ride-accelerate');
const coast = document.querySelector('#ride-coast');
const brake = document.querySelector('#ride-brake');
const reverse = document.querySelector('#ride-reverse');
const buttons = { day: document.querySelector('#choose-day'), night: document.querySelector('#choose-night') };
const images = { day: document.querySelector('#day-view'), night: document.querySelector('#night-view') };
const caption = document.querySelector('#environment-caption');
const names = { day: 'Woodland Day', night: 'Glowing Night' };
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const loadedImages = new Set();
const supported = Boolean(window.AudioContext || window.webkitAudioContext);
const ride = { active: true, engineOn: false, speed: 0, throttle: 0, braking: false, pan: 0, boost: 0, roughness: 0.1 };
let style = initialStyle;
let visualReady = false;
let loading = false;
let enabling = false;
let reveal;
let lastFrame;
let lastHud = 0;

scene.style.setProperty('--night-blend', style === 'night' ? 1 : 0);
caption.textContent = names[style];

async function prepareImage(next) {
  if (loadedImages.has(next)) return;
  const image = new Image();
  let timeout;
  try {
    image.src = `${import.meta.env.BASE_URL}roots/${next}.webp`;
    await Promise.race([
      image.decode(),
      new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Image timed out')), 15000); }),
    ]);
    images[next].src = image.src;
    await images[next].decode();
    loadedImages.add(next);
  } finally {
    clearTimeout(timeout);
  }
}

function updateHud() {
  const state = audio.getState();
  enable.disabled = !supported || enabling || !visualReady || (state.activated && state.ready);
  enable.textContent = !supported ? 'Audio unavailable' : enabling ? 'Loading audio…' : state.activated ? (state.ready ? 'Audio ready' : 'Retry audio') : 'Enable audio';
  pause.disabled = !state.activated;
  pause.textContent = state.paused ? 'Resume' : 'Pause';
  pause.setAttribute('aria-pressed', String(state.paused));
  for (const [name, button] of Object.entries(buttons)) {
    button.disabled = loading || Boolean(reveal) || state.paused;
    button.setAttribute('aria-pressed', String(name === style));
  }
  for (const button of [engine, accelerate, coast, brake]) {
    button.disabled = !state.activated || !state.ready || state.paused;
  }
  accelerate.disabled ||= !ride.engineOn;
  engine.textContent = ride.engineOn ? 'Stop engine' : 'Start engine';
  engine.setAttribute('aria-pressed', String(ride.engineOn));
  document.querySelector('#ride-readout').textContent =
    `${ride.engineOn ? 'Engine on' : 'Engine off'} · ${Math.round(Math.abs(ride.speed) * 3.6)} km/h`;
}

async function choose(next) {
  if (loading || reveal || audio.getState().paused) return;
  if (next === style && visualReady) return;
  loading = true;
  status.textContent = `Loading ${names[next]}…`;
  updateHud();
  try {
    await Promise.all([prepareImage(next), audio.prepareRoots()]);
    if (!visualReady) {
      style = next;
      await audio.setLevel('roots', next);
      scene.style.setProperty('--night-blend', next === 'night' ? 1 : 0);
      caption.textContent = names[next];
      visualReady = true;
      status.textContent = 'Enable audio to listen. You can also change the atmosphere silently.';
    } else if (audio.beginEnvironmentTransition(next)) {
      reveal = { from: style, to: next, elapsed: 0, duration: reducedMotion.matches ? 0.15 : 1 };
      if (reducedMotion.matches) scene.style.setProperty('--night-blend', next === 'night' ? 1 : 0);
      status.textContent = `Changing to ${names[next]}…`;
    }
  } catch {
    audio.cancelEnvironmentTransition();
    status.textContent = `Could not load ${names[next]}. Your current atmosphere is kept. Select it again to retry.`;
  } finally {
    loading = false;
    updateHud();
  }
}

enable.addEventListener('click', async () => {
  enabling = true;
  updateHud();
  status.textContent = 'Loading music, forest ambience and bike sounds…';
  try {
    await audio.start();
    await audio.prepareRoots();
    if (!audio.getState().ready) throw new Error('Audio unavailable');
    status.textContent = 'Ready. Start the engine or change the atmosphere.';
  } catch {
    status.textContent = 'Some audio could not load. Retry audio or use the channel controls.';
  } finally {
    enabling = false;
    updateHud();
  }
});
pause.addEventListener('click', () => {
  audio.setPaused(!audio.getState().paused);
  updateHud();
});
document.querySelector('[data-action="settings"]').addEventListener('click', audio.openSettings);
for (const [name, button] of Object.entries(buttons)) button.addEventListener('click', () => void choose(name));
engine.addEventListener('click', () => {
  ride.engineOn = !ride.engineOn;
  if (!ride.engineOn) ride.throttle = 0;
  updateHud();
});
accelerate.addEventListener('click', () => { ride.throttle = 1; ride.braking = false; });
coast.addEventListener('click', () => { ride.throttle = 0; ride.braking = false; });
brake.addEventListener('click', () => { ride.throttle = 0; ride.braking = true; });

function frame(timestamp) {
  const dt = lastFrame === undefined ? 0 : Math.min((timestamp - lastFrame) / 1000, 0.05);
  lastFrame = timestamp;
  if (!audio.getState().paused && !document.hidden) {
    const direction = reverse.checked ? -1 : 1;
    const target = ride.engineOn && !ride.braking ? direction * ride.throttle * 12 : 0;
    const response = ride.braking ? 3 : ride.throttle ? 0.8 : 0.35;
    ride.speed += (target - ride.speed) * (1 - Math.exp(-response * dt));
    if (Math.abs(ride.speed) < 0.015) ride.speed = 0;
    if (reveal) {
      reveal.elapsed += dt;
      const progress = Math.min(1, reveal.elapsed / reveal.duration);
      audio.setEnvironmentProgress(progress);
      if (!reducedMotion.matches) {
        scene.style.setProperty('--night-blend', reveal.to === 'night' ? progress : 1 - progress);
      }
      if (progress === 1) {
        style = reveal.to;
        reveal = null;
        caption.textContent = names[style];
        status.textContent = `${names[style]} is ready.`;
      }
    }
    audio.updateRide(ride);
  }
  if (timestamp - lastHud >= 100) {
    updateHud();
    lastHud = timestamp;
  }
  requestAnimationFrame(frame);
}

void choose(style);
requestAnimationFrame(frame);
