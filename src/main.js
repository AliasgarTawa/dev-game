import './style.css';
import { initMenu } from './menu.js';
import { initAudio } from './audio.js';

const canvas = document.querySelector('#scene');
const status = document.querySelector('.model-status');
const statusText = status.querySelector('.model-status__text');
const progressText = status.querySelector('.model-status__progress');
const retryButton = status.querySelector('.model-status__retry');
const audio = initAudio();
let scene = null;

function showStatus({ state, progress = 0 }) {
  status.dataset.state = state;
  retryButton.hidden = state !== 'error';
  progressText.textContent = state === 'loading' && progress > 0 ? `${Math.round(progress * 100)}%` : '';
  if (state === 'loading') statusText.textContent = 'Rolling the bike out…';
  else if (state === 'error') statusText.textContent = 'The bike and rider could not load.';
  else if (state === 'unsupported') statusText.textContent = '3D view is unavailable in this browser.';
  else statusText.textContent = 'Bike and rider ready.';
  document.body.classList.toggle('is-3d-ready', state === 'ready');
}

try {
  const { createScene } = await import('./scene.js');
  scene = createScene(canvas, { onRide: audio.updateRide, onStatus: showStatus });
  retryButton.addEventListener('click', () => scene.retry());
} catch (error) {
  console.error('3D scene failed to start:', error);
  document.body.classList.add('no-webgl');
  showStatus({ state: 'unsupported' });
}

initMenu({
  onStart: () => scene?.boost(),
  onInteract: audio.start,
  onHover: () => audio.cue('hover'),
  onReturn: () => audio.cue('back'),
  onSettings: audio.openSettings,
});
requestAnimationFrame(() => requestAnimationFrame(() => document.body.classList.add('is-ready')));
