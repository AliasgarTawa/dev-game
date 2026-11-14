import './style.css';
import { initMenu } from './menu.js';
import { initAudio } from './audio.js';

const canvas = document.querySelector('#scene');
const audio = initAudio();
let scene = null;

try {
  const { createScene } = await import('./scene.js');
  scene = createScene(canvas, { onRide: audio.updateRide });
} catch (error) {
  console.error('3D scene failed to start:', error);
  document.body.classList.add('no-webgl');
}

initMenu({
  onStart: () => scene?.boost(),
  onInteract: audio.start,
  onHover: () => audio.cue('hover'),
  onReturn: () => audio.cue('back'),
  onSettings: audio.openSettings,
});
requestAnimationFrame(() => requestAnimationFrame(() => document.body.classList.add('is-ready')));
