// Review-capture helper. In the page console:
//   const s = await import('/dev-game/tools/shots.js'); await s.states('after/desktop-1200x800');
// Saves exact canvas pixels (splat + rider pass) through tools/shot_receiver.py on 127.0.0.1:17098.
// Uses the page's window.__tick(n, dt) hook, which steps the game loop synchronously and returns the canvas,
// so captures also work while the browser pane is hidden (hidden pages get no animation frames).
const key = (type, k) => dispatchEvent(new KeyboardEvent(type, {key: k}));
export const isReady = () => !!(window.riderReady && window.bikeReady && window.__tick &&
  /ready/.test(document.getElementById('status')?.textContent || ''));
export async function post(name, dataUrl) {
  const res = await fetch('http://127.0.0.1:17098/', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({name, dataUrl})});
  return await res.text();
}
const wait = ms => new Promise(r => setTimeout(r, ms));
// Step in small batches and give Spark's sort worker time between them, then settle before the capture.
export async function grab(name, steps = 2) {
  for (let left = steps; left > 0; left -= 10) { window.__tick(Math.min(10, left)); await wait(120); }
  for (let i = 0; i < 4; i++) { window.__tick(1, 0.001); await wait(250); }
  return post(name, window.__tick(1, 0.001));
}
export async function states(prefix) {
  if (!isReady()) return 'not ready';
  const out = [];
  window.ride(0); out.push(await grab(prefix + '-stationary', 3));
  window.__play(); out.push(await grab(prefix + '-riding', 90));          // 3 s of the automatic ride
  document.getElementById('play').click();                                 // pause
  key('keydown', 'w'); key('keydown', 'd'); out.push(await grab(prefix + '-steering-right', 27));
  key('keyup', 'd'); key('keydown', 'a'); out.push(await grab(prefix + '-steering-left', 48));
  key('keyup', 'a'); key('keyup', 'w'); window.__tick(30);
  window.ride(0); window.__tick(2);
  return out;
}
