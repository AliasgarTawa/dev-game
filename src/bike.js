import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);
const WHEEL_RADIUS = 0.385;

const v = (x, y, z) => new THREE.Vector3(x, y, z);

function orientBetween(mesh, from, to) {
  const dir = new THREE.Vector3().subVectors(to, from);
  mesh.position.copy(from).addScaledVector(dir, 0.5);
  mesh.quaternion.setFromUnitVectors(UP, dir.normalize());
  return mesh;
}

function rod(from, to, radius, material) {
  const length = from.distanceTo(to);
  return orientBetween(new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 8), material), from, to);
}

function limb(from, to, radius, material) {
  const length = Math.max(from.distanceTo(to) - radius * 2, 0.01);
  return orientBetween(new THREE.Mesh(new THREE.CapsuleGeometry(radius, length, 4, 8), material), from, to);
}

function box(size, position, material, rotationX = 0) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
  mesh.position.copy(position);
  mesh.rotation.x = rotationX;
  return mesh;
}

function createWheel(materials) {
  const wheel = new THREE.Group();
  const tyre = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.085, 10, 28), materials.rubber);
  tyre.rotation.y = Math.PI / 2;
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.05, 20, 1, true), materials.metal);
  rim.rotation.z = Math.PI / 2;
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.16, 10), materials.dark);
  hub.rotation.z = Math.PI / 2;
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.015, 16), materials.metal);
  disc.rotation.z = Math.PI / 2;
  disc.position.x = 0.07;
  wheel.add(tyre, rim, hub, disc);

  for (let i = 0; i < 4; i++) {
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.46, 0.02), materials.metal);
    spoke.rotation.x = (i / 4) * Math.PI;
    wheel.add(spoke);
  }
  return wheel;
}

function createRider(materials) {
  const rider = new THREE.Group();
  const { suit, accent, white, visor, dark } = materials;

  const hips = v(0, 1.12, 0.24);
  const shoulders = v(0, 1.56, -0.06);
  rider.add(limb(hips, shoulders, 0.17, suit));
  rider.add(box([0.36, 0.08, 0.3], v(0, 1.42, 0.02), accent, -0.9));

  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.165, 16, 12), white);
  helmet.position.set(0, 1.79, -0.2);
  rider.add(helmet);
  rider.add(box([0.24, 0.09, 0.08], v(0, 1.78, -0.34), visor));
  rider.add(box([0.26, 0.03, 0.2], v(0, 1.93, -0.3), accent, 0.25));
  rider.add(box([0.12, 0.1, 0.12], v(0, 1.66, -0.33), accent));

  for (const side of [-1, 1]) {
    const shoulder = v(0.19 * side, 1.53, -0.06);
    const elbow = v(0.3 * side, 1.32, -0.24);
    const hand = v(0.33 * side, 1.18, -0.42);
    rider.add(limb(shoulder, elbow, 0.07, suit), limb(elbow, hand, 0.06, suit));
    const glove = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 6), dark);
    glove.position.copy(hand);
    rider.add(glove);

    const hip = v(0.13 * side, 1.1, 0.22);
    const knee = v(0.22 * side, 1.02, -0.2);
    const ankle = v(0.2 * side, 0.6, 0.02);
    rider.add(limb(hip, knee, 0.09, suit), limb(knee, ankle, 0.075, white));
    rider.add(box([0.11, 0.12, 0.24], v(0.2 * side, 0.54, -0.02), dark));
  }

  return rider;
}

export function createBike() {
  const materials = {
    orange: new THREE.MeshStandardMaterial({ color: '#ff6a1a', roughness: 0.45, metalness: 0.1 }),
    white: new THREE.MeshStandardMaterial({ color: '#f4efe6', roughness: 0.5 }),
    dark: new THREE.MeshStandardMaterial({ color: '#1c1c1f', roughness: 0.7 }),
    rubber: new THREE.MeshStandardMaterial({ color: '#151515', roughness: 0.95, flatShading: true }),
    metal: new THREE.MeshStandardMaterial({ color: '#b7bcc2', roughness: 0.3, metalness: 0.85 }),
    gold: new THREE.MeshStandardMaterial({ color: '#d4a237', roughness: 0.3, metalness: 0.8 }),
    suit: new THREE.MeshStandardMaterial({ color: '#23304f', roughness: 0.8 }),
    accent: new THREE.MeshStandardMaterial({ color: '#ff6a1a', roughness: 0.6 }),
    visor: new THREE.MeshStandardMaterial({ color: '#0d0d12', roughness: 0.1, metalness: 0.6 }),
    taillight: new THREE.MeshStandardMaterial({ color: '#ff2a1a', emissive: '#ff2a1a', emissiveIntensity: 2 }),
  };
  const { orange, white, dark, metal, gold } = materials;

  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);

  const frontWheel = createWheel(materials);
  frontWheel.position.set(0, WHEEL_RADIUS, -0.72);
  const rearWheel = createWheel(materials);
  rearWheel.position.set(0, WHEEL_RADIUS, 0.7);
  group.add(frontWheel, rearWheel);

  for (const side of [-1, 1]) {
    body.add(rod(v(0.1 * side, WHEEL_RADIUS, 0.7), v(0.1 * side, 0.56, 0.1), 0.035, metal));
    body.add(rod(v(0.09 * side, 1.02, -0.5), v(0.09 * side, WHEEL_RADIUS, -0.72), 0.032, gold));
    body.add(box([0.02, 0.22, 0.3], v(0.15 * side, 0.86, 0.44), white, -0.2));
    body.add(box([0.06, 0.22, 0.34], v(0.2 * side, 0.9, -0.3), orange, 0.25));
  }

  body.add(rod(v(0, 1.04, -0.47), v(0, 0.72, 0.12), 0.045, dark));
  body.add(rod(v(0, 1.0, -0.47), v(0, 0.42, -0.22), 0.04, dark));
  body.add(box([0.28, 0.32, 0.42], v(0, 0.55, -0.06), dark));
  body.add(box([0.32, 0.2, 0.5], v(0, 0.98, -0.18), orange, 0.15));
  body.add(box([0.26, 0.09, 0.64], v(0, 1.01, 0.3), dark, -0.08));
  body.add(box([0.2, 0.04, 0.62], v(0, 1.0, 0.8), orange, -0.35));
  body.add(box([0.3, 0.25, 0.03], v(0, 1.06, -0.57), white, 0.35));
  body.add(box([0.18, 0.03, 0.5], v(0, 0.86, -0.82), orange, 0.2));
  body.add(box([0.06, 0.04, 0.03], v(0, 1.11, 1.08), materials.taillight, -0.35));
  body.add(rod(v(-0.38, 1.18, -0.42), v(0.38, 1.18, -0.42), 0.02, dark));
  body.add(rod(v(0.17, 0.48, -0.02), v(0.19, 0.88, 0.72), 0.045, metal));
  body.add(rod(v(0.19, 0.86, 0.68), v(0.2, 0.96, 0.98), 0.075, metal));

  const rider = createRider(materials);
  body.add(rider);

  group.traverse((m) => {
    if (m.isMesh) m.castShadow = true;
  });

  return {
    group,
    update(dt, speed, t) {
      const spin = (speed * dt) / WHEEL_RADIUS;
      frontWheel.rotation.x -= spin;
      rearWheel.rotation.x -= spin;
      body.position.y = Math.sin(t * 22) * 0.012 + Math.sin(t * 3.1) * 0.015;
      rider.position.y = Math.sin(t * 5.3) * 0.012;
      rider.rotation.x = Math.sin(t * 1.7) * 0.03;
    },
  };
}
