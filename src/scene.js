import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

const BASE = import.meta.env.BASE_URL;
const MODEL_URLS = [`${BASE}models/desert-bike.glb`, `${BASE}models/rider.glb`];

// Camera calibration for assets/desert/opening/first-frame.png (1344 × 768):
// road vanishing point, focal length in photo pixels and eye height in metres.
const PHOTO = { width: 1344, height: 768, vanishU: 0.515, vanishV: 0.45, focal: 1000, eyeHeight: 1.6 };

const BIKE_LENGTH = 2.05;
const RIDER_HEIGHT = 0.95;
const HEADING = 0.2;
const SUN_OFFSET = new THREE.Vector3(5, 7, 3);

function photoRect(img) {
  const box = img.getBoundingClientRect();
  const [px, py] = getComputedStyle(img).objectPosition.split(' ').map((v) => parseFloat(v) / 100);
  const scale = Math.max(box.width / PHOTO.width, box.height / PHOTO.height);
  return {
    scale,
    left: box.left + (box.width - PHOTO.width * scale) * px,
    top: box.top + (box.height - PHOTO.height * scale) * py,
  };
}

// Screen point where the bike's tyres meet the road: beside the menu on wide
// screens, between the title and the buttons on stacked layouts.
function groundAnchor() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const actions = document.querySelector('.actions').getBoundingClientRect();
  if (window.matchMedia('(max-width: 720px), (max-aspect-ratio: 11/10)').matches) {
    return { x: w * 0.5, y: Math.min(actions.top - 16, h * 0.8) };
  }
  let menuRight = actions.right;
  const walker = document.createTreeWalker(document.querySelector('.brand'), NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  while (walker.nextNode()) {
    range.selectNodeContents(walker.currentNode);
    menuRight = Math.max(menuRight, range.getBoundingClientRect().right);
  }
  return { x: Math.max(menuRight + (w - menuRight) * 0.58, w * 0.6), y: h * 0.86 };
}

function createContactShadow() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(40, 18, 6, 0.75)');
  g.addColorStop(0.55, 'rgba(40, 18, 6, 0.3)');
  g.addColorStop(1, 'rgba(40, 18, 6, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(0.9, BIKE_LENGTH * 1.25),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true, depthWrite: false }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.004;
  return mesh;
}

// Normalises a Meshy-style GLB: uniform scale to a target size along one axis.
function fitModel(model, axis, size) {
  const box = new THREE.Box3().setFromObject(model);
  model.scale.setScalar(size / box.getSize(new THREE.Vector3())[axis]);
  model.traverse((node) => {
    if (node.isMesh) node.castShadow = true;
  });
  return model;
}

function mountRider(bike, rider) {
  bike.rotation.y = -Math.PI / 2;
  fitModel(bike, 'z', BIKE_LENGTH);
  bike.updateMatrixWorld(true);
  bike.position.y = -new THREE.Box3().setFromObject(bike).min.y;
  bike.updateMatrixWorld(true);

  // Find the seat by casting down onto the bike just behind its centre.
  const seatZ = BIKE_LENGTH * 0.06;
  const hit = new THREE.Raycaster(new THREE.Vector3(0, 5, seatZ), new THREE.Vector3(0, -1, 0)).intersectObject(bike, true)[0];
  const seatY = hit ? hit.point.y : BIKE_LENGTH * 0.4;

  rider.rotation.y = Math.PI;
  fitModel(rider, 'y', RIDER_HEIGHT);
  rider.updateMatrixWorld(true);
  const riderBox = new THREE.Box3().setFromObject(rider);
  rider.position.set(0, seatY - riderBox.min.y - 0.04, seatZ + 0.05);
}

export function createScene(canvas, { onRide = () => {}, onStatus = () => {} } = {}) {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const backdrop = document.querySelector('.backdrop');

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.35;
  pmrem.dispose();

  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 400);
  camera.position.set(0, PHOTO.eyeHeight, 0);

  // Warm, high sun from the right to match the photo, plus bounce from the red sand.
  scene.add(new THREE.HemisphereLight('#cfe0f2', '#c4774a', 1.4));
  const sun = new THREE.DirectionalLight('#ffe9cc', 3.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -2.5, right: 2.5, top: 2.5, bottom: -2.5, near: 1, far: 30 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);

  const rig = new THREE.Group();
  rig.rotation.y = HEADING;
  rig.visible = false;
  const ride = new THREE.Group();
  rig.add(ride);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(14, 14), new THREE.ShadowMaterial({ opacity: 0.32 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  rig.add(ground, createContactShadow());
  scene.add(rig);

  let rider = null;
  let loadAttempt = 0;
  const home = new THREE.Vector3();
  const state = { speed: 1, boost: 0, throttle: 0, launchStart: -1, pan: 0 };
  let boostTimers = [];

  function layout() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, false);
    const rect = photoRect(backdrop);
    const focal = PHOTO.focal * rect.scale;
    const vanishX = rect.left + PHOTO.vanishU * PHOTO.width * rect.scale;
    const vanishY = rect.top + PHOTO.vanishV * PHOTO.height * rect.scale;

    // Match the photo's perspective: level camera, principal point on the road's vanishing point.
    camera.aspect = w / h;
    camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(h / 2 / focal));
    camera.setViewOffset(w, h, w / 2 - vanishX, h / 2 - vanishY, w, h);

    const anchor = groundAnchor();
    const depth = THREE.MathUtils.clamp((focal * PHOTO.eyeHeight) / Math.max(anchor.y - vanishY, 1), 3.5, 16);
    // Keep the whole bike on screen (about 0.9 m either side of its centre at this heading).
    const anchorX = Math.min(anchor.x, w - (focal * 0.9) / depth - 16);
    home.set(((anchorX - vanishX) * depth) / focal, 0, -depth);
    state.pan = THREE.MathUtils.clamp((anchorX - w / 2) / w, -0.4, 0.4);
    if (state.launchStart < 0) rig.position.copy(home);
    render();
  }

  function render() {
    sun.position.copy(rig.position).add(SUN_OFFSET);
    sun.target.position.copy(rig.position);
    renderer.render(scene, camera);
  }

  const timer = new THREE.Timer();
  timer.connect(document);
  const forward = new THREE.Vector3(-Math.sin(HEADING), 0, -Math.cos(HEADING));

  function frame(timestamp) {
    timer.update(timestamp);
    const dt = Math.min(timer.getDelta(), 0.05);
    const t = timer.getElapsed();

    if (state.launchStart >= 0 && !reducedMotion) {
      const lt = Math.min(t - state.launchStart, 2.6);
      rig.position.copy(home).addScaledVector(forward, 0.5 * 16 * lt * lt);
      ride.rotation.x = Math.sin(Math.min(lt / 0.9, 1) * Math.PI) * 0.09;
    } else if (!reducedMotion) {
      ride.position.y = Math.sin(t * 19) * 0.0025;
      ride.rotation.z = Math.sin(t * 1.3) * 0.008;
      ride.rotation.x = 0;
      if (rider) {
        rider.rotation.z = Math.sin(t * 1.1 + 0.6) * 0.03;
        rider.scale.y = rider.userData.baseScale * (1 + Math.sin(t * 2.2) * 0.012);
      }
    }

    const target = state.launchStart >= 0 ? 2.8 : 1;
    state.speed = THREE.MathUtils.damp(state.speed, target, state.launchStart >= 0 ? 1.4 : 2.5, dt);
    state.boost = THREE.MathUtils.clamp((state.speed - 1) / 1.8, 0, 1);
    onRide({
      active: true,
      speed: state.speed,
      boost: state.boost,
      throttle: state.throttle,
      roughness: state.launchStart >= 0 ? 0.35 : 0.05,
      pan: state.pan,
    });
    render();
  }

  async function loadModels() {
    if (rig.visible) return;
    const attempt = ++loadAttempt;
    const current = () => attempt === loadAttempt;
    onStatus({ state: 'loading', progress: 0 });
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    const progress = MODEL_URLS.map(() => 0);
    try {
      const [bikeGltf, riderGltf] = await Promise.all(
        MODEL_URLS.map((url, i) =>
          loader.loadAsync(url, (e) => {
            if (!e.total || !current()) return;
            progress[i] = e.loaded / e.total;
            onStatus({ state: 'loading', progress: progress.reduce((a, b) => a + b) / progress.length });
          }),
        ),
      );
      if (!current()) return;
      const bike = bikeGltf.scene;
      rider = riderGltf.scene;
      mountRider(bike, rider);
      rider.userData.baseScale = rider.scale.y;
      ride.add(bike, rider);
      await renderer.compileAsync(scene, camera);
      rig.visible = true;
      layout();
      onStatus({ state: 'ready' });
    } catch (error) {
      if (!current()) return;
      loadAttempt++;
      console.error('Opening models failed to load:', error);
      onStatus({ state: 'error' });
    }
  }

  window.addEventListener('resize', layout);
  const observer = new ResizeObserver(layout);
  observer.observe(document.querySelector('.brand'));
  observer.observe(document.querySelector('.actions'));
  layout();
  loadModels();
  renderer.setAnimationLoop(frame);

  return {
    retry: loadModels,
    boost(duration = 2600) {
      if (!rig.visible || state.launchStart >= 0) return;
      boostTimers.forEach(clearTimeout);
      state.launchStart = timer.getElapsed();
      state.throttle = 1;
      const fadeAt = reducedMotion ? duration : duration * 0.8;
      boostTimers = [
        setTimeout(() => canvas.classList.add('is-hidden'), fadeAt),
        setTimeout(() => {
          state.launchStart = -1;
          state.throttle = 0;
          ride.rotation.set(0, 0, 0);
          rig.position.copy(home);
          canvas.classList.remove('is-hidden');
        }, fadeAt + 900),
      ];
    },
  };
}
