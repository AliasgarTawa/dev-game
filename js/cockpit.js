import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {loadRootsBike} from './roots-bike.js';

// Foreground "cockpit" pass shared by index.html and rider-preview.html: the cleaned bike and the rigged mascot,
// both exported by tools/blender/*.py already in bike-mount space (metres, -Z forward, wheels on y = 0), so no runtime
// scaling, rotation or procedural limbs are needed. Rider and bike move together under `mount`, so the paws cannot leave
// the grips when steering; steering adds a lean of the whole machine and a head turn from the rider's skeleton.
export const BIKE_URL = '/dev-game/assets/models/desert-bike/desert-bike-game.glb';
export const RIDER_URL = '/dev-game/assets/models/mascot/rider-rigged.glb';

// Chase camera, bike-mount space. Raised and pulled back so the back of the head, both arms and paws, the bars and the
// front wheel stay in view while the road ahead remains visible above the rider's head.
export const CHASE = {pos: new THREE.Vector3(2.05, 1.75, 2.55), look: new THREE.Vector3(-0.3, 0.8, -0.55), hfov: 60, minVfov: 50};   // rear three-quarter: the whole bike first, rider on top

function skyEnvironment(renderer) {
  // A soft sky/sand gradient for image-based light, so the metallic PBR parts (engine, rims, levers) are not black.
  const s = new THREE.Scene();
  const g = new THREE.SphereGeometry(10, 32, 16), c = [], top = new THREE.Color(0xbfd6ea), hor = new THREE.Color(0xf3dcc0), low = new THREE.Color(0x8a5a3c);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const y = p.getY(i) / 10; const col = y > 0 ? hor.clone().lerp(top, y) : hor.clone().lerp(low, Math.min(1, -y * 2)); c.push(col.r, col.g, col.b); }
  g.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
  s.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({vertexColors: true, side: THREE.BackSide})));
  const pm = new THREE.PMREMGenerator(renderer); const env = pm.fromScene(s, 0.02).texture; pm.dispose();
  return env;
}

// variant 'roots': the woodland day/night bike (js/roots-bike.js, its own Meshy mesh; the rider's grips were fitted to the
// desert bike, so the paws sit only approximately on its bars). setLook(0..1) blends it day -> night and cools the sun.
export function createCockpit(renderer, {onStatus = () => {}, variant = 'desert', night = 0} = {}) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(56, 1, 0.05, 30);
  scene.environment = skyEnvironment(renderer); scene.environmentIntensity = 0.55;
  scene.add(new THREE.HemisphereLight(0xfff3dd, 0x6b5140, 1.5));
  const sun = new THREE.DirectionalLight(0xffedcd, 2.2); sun.position.set(-3, 5, -2); scene.add(sun);
  const rim = new THREE.DirectionalLight(0xffe2c0, 0.8); rim.position.set(2, 3, 4); scene.add(rim);   // lights the rider's back for the chase view
  const mount = new THREE.Group(); scene.add(mount);
  // soft contact shadow so the bike sits on the road instead of floating over the splat
  { const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d');
    const g = x.createRadialGradient(64, 64, 4, 64, 64, 64); g.addColorStop(0, 'rgba(40,22,10,0.55)'); g.addColorStop(1, 'rgba(40,22,10,0)');
    x.fillStyle = g; x.fillRect(0, 0, 128, 128);
    const sh = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 2.3), new THREE.MeshBasicMaterial({map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false}));
    sh.rotation.x = -Math.PI / 2; sh.position.y = 0.005; sh.renderOrder = -1; mount.add(sh); }
  const state = {bike: null, rider: null, bones: {}, rest: {}, steer: 0, t: 0};
  const loader = new GLTFLoader();
  const ready = Promise.all([
    (variant === 'roots'
      ? loadRootsBike(mount, night).then(c => { state.bike = c.bike; state.look = c; setLook(night); })
      : loader.loadAsync(BIKE_URL).then(g => { state.bike = g.scene; mount.add(g.scene); })
    ).then(() => { window.bikeReady = true; onStatus('bike'); }),
    loader.loadAsync(RIDER_URL).then(g => {
      state.rider = g.scene; mount.add(g.scene);
      g.scene.traverse(o => { if (o.isBone) { state.bones[o.name] = o; state.rest[o.name] = o.quaternion.clone(); } if (o.isMesh) o.frustumCulled = false; });
      window.riderReady = true; onStatus('rider');
    }),
  ]);
  const bikeReady = ready.then(() => true, () => false);
  const warm = new THREE.Color(0xffedcd), cool = new THREE.Color(0x9fb8ff);
  function setLook(v) { v = THREE.MathUtils.clamp(v, 0, 1); state.look?.setNight(v); sun.color.lerpColors(warm, cool, v); }
  const q = new THREE.Quaternion(), e = new THREE.Euler();
  function update(dt, steerInput, {riding = false, reducedMotion = false} = {}) {
    state.steer += (THREE.MathUtils.clamp(steerInput, -1, 1) - state.steer) * Math.min(1, dt * 6);
    state.t += dt;
    const st = state.steer;
    mount.rotation.set(0, -st * 0.05, -st * 0.11);              // lean into the turn (right = negative roll)
    const bob = riding && !reducedMotion ? Math.sin(state.t * 9) * 0.004 : 0;
    mount.position.y = bob;
    const head = state.bones.head;
    if (head) { e.set(0.05 * Math.abs(st), -st * 0.35, st * 0.12); head.quaternion.copy(state.rest.head).multiply(q.setFromEuler(e)); }
  }
  function render(aspect) {
    camera.aspect = aspect;
    // keep the horizontal field of view on wide screens, never narrower than minVfov vertically on tall phones
    const vfov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(CHASE.hfov / 2)) / aspect));
    camera.fov = Math.max(CHASE.minVfov, Math.min(vfov, 78));
    // tall screens: pull back a little rather than widening further
    const back = aspect < 1 ? (1 - aspect) * 1.1 : 0;
    camera.position.copy(CHASE.pos).add(new THREE.Vector3(0, back * 0.35, back));
    camera.lookAt(CHASE.look); camera.updateProjectionMatrix();
    const ac = renderer.autoClear; renderer.autoClear = false; renderer.clearDepth(); renderer.render(scene, camera); renderer.autoClear = ac;
  }
  return {scene, camera, mount, state, ready, bikeReady, setLook, update, render};
}
