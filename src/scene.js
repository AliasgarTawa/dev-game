import * as THREE from 'three';
import { createBike } from './bike.js';

const TAU = Math.PI * 2;
const CHUNK_LENGTH = 200;
const CHUNK_WIDTH = 360;
const ROAD_HALF_WIDTH = 5;
const K = TAU / CHUNK_LENGTH;

const SAND_LOW = new THREE.Color('#c97a3f');
const SAND_HIGH = new THREE.Color('#f4c27c');
const ROAD = new THREE.Color('#b9763f');
const HORIZON = new THREE.Color('#f7a15e');
const SUN_DIR = new THREE.Vector3(0.28, 0.1, -1).normalize();

const smoothstep = (a, b, x) => {
  const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const damp = (current, target, lambda, dt) => THREE.MathUtils.damp(current, target, lambda, dt);

function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2(x, z) {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

const roadHeight = (z) => Math.sin(z * K * 3) * 0.8 + Math.sin(z * K * 7 + 1.3) * 0.25;

function duneHeight(x, z) {
  const ax = Math.abs(x);
  const scale = 0.5 + Math.min(ax / 70, 1) * 1.5;
  const dunes =
    Math.sin(x * 0.045 + Math.sin(z * K * 2) * 1.6) * 5 +
    Math.sin(x * 0.021 - z * K) * 7 +
    Math.sin(x * 0.12 + z * K * 6) * 1.6 +
    Math.sin(x * 0.37 + z * K * 15) * 0.25;
  const h = (dunes * 0.6 + 7) * scale;
  return THREE.MathUtils.lerp(roadHeight(z), h, smoothstep(ROAD_HALF_WIDTH, ROAD_HALF_WIDTH + 22, ax));
}

function createTerrainGeometry() {
  const geo = new THREE.PlaneGeometry(CHUNK_WIDTH, CHUNK_LENGTH, 180, 100);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const color = new THREE.Color();

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const y = duneHeight(x, z);
    pos.setY(i, y);

    const wrappedZ = ((z % CHUNK_LENGTH) + CHUNK_LENGTH) % CHUNK_LENGTH;
    const grain = (hash2(x, wrappedZ) - 0.5) * 0.12;
    color.copy(SAND_LOW).lerp(SAND_HIGH, THREE.MathUtils.clamp(y / 20 + 0.45 + grain, 0, 1));
    color.lerp(ROAD, 1 - smoothstep(ROAD_HALF_WIDTH - 1, ROAD_HALF_WIDTH + 4, Math.abs(x)));
    color.toArray(colors, i * 3);
  }

  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return geo;
}

function createCactus(material) {
  const group = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.42, 4.2, 7), material);
  trunk.position.y = 2.1;
  group.add(trunk);

  const arm = (side, height, length) => {
    const elbow = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.9, 6), material);
    elbow.rotation.z = (Math.PI / 2) * side;
    elbow.position.set(0.55 * side, height, 0);
    const up = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.25, length, 6), material);
    up.position.set(0.95 * side, height + length / 2 - 0.1, 0);
    group.add(elbow, up);
  };
  arm(1, 2.0, 1.6);
  arm(-1, 2.6, 1.2);

  group.traverse((m) => {
    m.castShadow = true;
  });
  return group;
}

function createChunkTemplate(terrainMaterial) {
  const chunk = new THREE.Group();
  const terrain = new THREE.Mesh(createTerrainGeometry(), terrainMaterial);
  terrain.receiveShadow = true;
  chunk.add(terrain);

  const rand = mulberry32(7);
  const cactusMat = new THREE.MeshStandardMaterial({ color: '#5f7a3a', roughness: 0.85, flatShading: true });
  const rockMat = new THREE.MeshStandardMaterial({ color: '#9a5a33', roughness: 1, flatShading: true });
  const rockGeo = new THREE.DodecahedronGeometry(1, 0);
  const cactusTemplate = createCactus(cactusMat);

  const placeOffRoad = (minX, maxX) => {
    const side = rand() < 0.5 ? -1 : 1;
    const x = side * (minX + rand() * (maxX - minX));
    const z = (rand() - 0.5) * (CHUNK_LENGTH - 6);
    return new THREE.Vector3(x, duneHeight(x, z), z);
  };

  for (let i = 0; i < 26; i++) {
    const cactus = cactusTemplate.clone();
    cactus.position.copy(placeOffRoad(9, 90)).y -= 0.2;
    cactus.rotation.y = rand() * TAU;
    cactus.scale.setScalar(0.7 + rand() * 0.6);
    chunk.add(cactus);
  }

  for (let i = 0; i < 55; i++) {
    const rock = new THREE.Mesh(rockGeo, rockMat);
    rock.position.copy(placeOffRoad(7.5, 110));
    rock.rotation.set(rand() * TAU, rand() * TAU, rand() * TAU);
    rock.scale.set(0.4 + rand() * 1.4, 0.3 + rand() * 0.8, 0.4 + rand() * 1.4);
    rock.castShadow = true;
    rock.receiveShadow = true;
    chunk.add(rock);
  }

  return chunk;
}

function createMesas() {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: '#a4532f', roughness: 1, flatShading: true });
  const rand = mulberry32(42);
  for (let i = 0; i < 14; i++) {
    const angle = THREE.MathUtils.lerp(-1.25, 1.25, i / 13) + (rand() - 0.5) * 0.15;
    const dist = 300 + rand() * 120;
    const height = 18 + rand() * 38;
    const radius = 14 + rand() * 30;
    const mesa = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.75, radius, height, 7, 1), mat);
    mesa.position.set(Math.sin(angle) * dist, height / 2 - 2, -Math.cos(angle) * dist);
    mesa.rotation.y = rand() * TAU;
    mesa.scale.x = 1 + rand() * 1.2;
    group.add(mesa);
  }
  return group;
}

function createSky() {
  return new THREE.Mesh(
    new THREE.SphereGeometry(900, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uTop: { value: new THREE.Color('#2b1640') },
        uMid: { value: new THREE.Color('#d9583a') },
        uHorizon: { value: HORIZON },
        uSunDir: { value: SUN_DIR },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uTop;
        uniform vec3 uMid;
        uniform vec3 uHorizon;
        uniform vec3 uSunDir;
        varying vec3 vDir;
        void main() {
          vec3 dir = normalize(vDir);
          float h = clamp(dir.y, -0.2, 1.0);
          vec3 col = mix(uHorizon, uMid, smoothstep(0.02, 0.2, h));
          col = mix(col, uTop, smoothstep(0.2, 0.75, h));
          float s = max(dot(dir, uSunDir), 0.0);
          col += vec3(1.0, 0.62, 0.32) * pow(s, 18.0) * 0.55;
          col += vec3(1.0, 0.85, 0.6) * pow(s, 220.0) * 1.2;
          col = mix(col, vec3(1.0, 0.94, 0.8) * 2.2, smoothstep(0.9988, 0.9993, s));
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    }),
  );
}

function createSoftDotTexture() {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.45)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createDust(count) {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 4);
  const velocities = new Float32Array(count * 3);
  const life = new Float32Array(count);
  const maxLife = new Float32Array(count).fill(1);
  const dustColor = new THREE.Color('#e9b27a');
  for (let i = 0; i < count; i++) dustColor.toArray(colors, i * 4);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 4));
  const points = new THREE.Points(
    geo,
    new THREE.PointsMaterial({
      size: 1.6,
      map: createSoftDotTexture(),
      vertexColors: true,
      transparent: true,
      depthWrite: false,
    }),
  );
  points.frustumCulled = false;

  let cursor = 0;
  let spawnBudget = 0;

  function update(dt, emitter, worldSpeed, rate) {
    spawnBudget += rate * dt;
    while (spawnBudget >= 1) {
      spawnBudget -= 1;
      const i = cursor;
      cursor = (cursor + 1) % count;
      positions[i * 3] = emitter.x + (Math.random() - 0.5) * 0.4;
      positions[i * 3 + 1] = emitter.y + Math.random() * 0.2;
      positions[i * 3 + 2] = emitter.z + Math.random() * 0.3;
      velocities[i * 3] = (Math.random() - 0.5) * 3;
      velocities[i * 3 + 1] = 0.6 + Math.random() * 1.8;
      velocities[i * 3 + 2] = worldSpeed * (0.55 + Math.random() * 0.35);
      maxLife[i] = life[i] = 0.9 + Math.random() * 1.1;
    }

    for (let i = 0; i < count; i++) {
      if (life[i] <= 0) {
        colors[i * 4 + 3] = 0;
        continue;
      }
      life[i] -= dt;
      velocities[i * 3] *= 0.98;
      velocities[i * 3 + 1] -= 0.4 * dt;
      positions[i * 3] += velocities[i * 3] * dt;
      positions[i * 3 + 1] += velocities[i * 3 + 1] * dt;
      positions[i * 3 + 2] += velocities[i * 3 + 2] * dt;
      const t = Math.max(life[i], 0) / maxLife[i];
      colors[i * 4 + 3] = Math.min(1, (1 - t) * 6) * t * 0.55;
    }
    geo.attributes.position.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
  }

  return { points, update };
}

export function createScene(canvas, { onRide = () => {} } = {}) {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(HORIZON, 45, 420);
  scene.add(createSky(), createMesas());

  const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 2000);

  scene.add(new THREE.HemisphereLight('#ffd3a3', '#b0612e', 1.1));
  const sun = new THREE.DirectionalLight('#ffb36b', 2.8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6, near: 1, far: 120 });
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.02;
  const fill = new THREE.DirectionalLight('#9fb0ff', 0.45);
  fill.position.set(-6, 5, 10);
  scene.add(sun, sun.target, fill);

  const terrainMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95 });
  const template = createChunkTemplate(terrainMaterial);
  const world = new THREE.Group();
  for (const offset of [1, 0, -1, -2]) {
    const chunk = offset === 0 ? template : template.clone();
    chunk.position.z = offset * CHUNK_LENGTH;
    world.add(chunk);
  }
  scene.add(world);

  const bike = createBike();
  scene.add(bike.group);

  const dust = createDust(reducedMotion ? 80 : 260);
  scene.add(dust.points);

  const pointer = new THREE.Vector2();
  const smoothPointer = new THREE.Vector2();
  if (!reducedMotion) {
    window.addEventListener('pointermove', (e) => {
      pointer.set((e.clientX / window.innerWidth) * 2 - 1, (e.clientY / window.innerHeight) * 2 - 1);
    });
  }

  const framing = { offset: new THREE.Vector3(), look: new THREE.Vector3(), fov: 50 };
  function updateFraming() {
    const wide = camera.aspect > 1.1;
    framing.offset.set(wide ? -3.2 : -1.0, wide ? 1.9 : 3.2, wide ? 5.6 : 8.5);
    framing.look.set(wide ? 0.35 : 0.2, wide ? 0.9 : -3.4, -10);
    framing.fov = wide ? 50 : 58;
  }

  function resize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    updateFraming();
  }
  window.addEventListener('resize', resize);
  resize();

  const baseSpeed = reducedMotion ? 16 : 34;
  const state = { speed: baseSpeed, targetSpeed: baseSpeed, distance: 0, boost: 0, boostTarget: 0 };
  let boostTimer;

  const bikePos = new THREE.Vector3();
  const lookTarget = new THREE.Vector3();
  const desiredCam = new THREE.Vector3();
  const desiredLook = new THREE.Vector3();
  const rearWheel = new THREE.Vector3();
  const timer = new THREE.Timer();
  timer.connect(document);
  let prevX = 0;
  let firstFrame = true;

  const weave = (t) => (reducedMotion ? 0 : Math.sin(t * 0.45) * 1.6 + Math.sin(t * 0.17 + 1) * 0.8);

  function frame(timestamp) {
    timer.update(timestamp);
    const dt = Math.min(timer.getDelta(), 0.05);
    const t = timer.getElapsed();

    state.speed = damp(state.speed, state.targetSpeed, 1.6, dt);
    state.boost = damp(state.boost, state.boostTarget, 2.2, dt);
    state.distance += state.speed * dt;
    world.position.z = state.distance % CHUNK_LENGTH;

    const localZ = -world.position.z;
    const x = weave(t);
    const vx = dt > 0 ? (x - prevX) / dt : 0;
    prevX = x;
    const y = roadHeight(localZ);
    const pitch = Math.atan((roadHeight(localZ - 0.72) - roadHeight(localZ + 0.7)) / 1.42);

    bikePos.set(x, y, 0);
    bike.group.position.copy(bikePos);
    bike.group.rotation.set(pitch, -Math.atan2(vx, state.speed) * 2.5, THREE.MathUtils.clamp(-vx * 0.18, -0.35, 0.35), 'YXZ');
    bike.update(dt, state.speed, t);

    rearWheel.set(x, y + 0.1, 0.95);
    dust.update(dt, rearWheel, state.speed, (reducedMotion ? 25 : 70) + state.boost * 120);

    sun.position.copy(bikePos).addScaledVector(SUN_DIR, 60);
    sun.target.position.copy(bikePos);

    smoothPointer.lerp(pointer, 1 - Math.exp(-3 * dt));
    const drift = reducedMotion ? 0 : Math.sin(t * 0.12) * 0.6;
    desiredCam.set(
      x + framing.offset.x + smoothPointer.x * 0.8 + drift,
      y + framing.offset.y - smoothPointer.y * 0.4,
      framing.offset.z - state.boost * 2.2,
    );
    desiredLook.set(x + framing.look.x, y + framing.look.y, framing.look.z);
    if (firstFrame) {
      camera.position.copy(desiredCam);
      lookTarget.copy(desiredLook);
      firstFrame = false;
    } else {
      camera.position.lerp(desiredCam, 1 - Math.exp(-3 * dt));
      lookTarget.lerp(desiredLook, 1 - Math.exp(-4 * dt));
    }
    camera.position.y += Math.sin(t * 38) * 0.012 * (state.speed / baseSpeed);
    camera.lookAt(lookTarget);

    const fov = framing.fov + state.boost * 16;
    if (Math.abs(camera.fov - fov) > 0.01) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }

    onRide({
      active: true,
      speed: state.speed / baseSpeed,
      boost: state.boost,
      throttle: state.boostTarget,
      roughness: Math.min(1, Math.abs(pitch) * 2),
      pan: THREE.MathUtils.clamp((bikePos.x - camera.position.x) / 12, -0.4, 0.4),
    });
    renderer.render(scene, camera);
  }

  renderer.setAnimationLoop(frame);

  return {
    boost(duration = 2600) {
      state.targetSpeed = baseSpeed * 2.8;
      state.boostTarget = 1;
      clearTimeout(boostTimer);
      boostTimer = setTimeout(() => {
        state.targetSpeed = baseSpeed;
        state.boostTarget = 0;
      }, duration);
    },
  };
}
