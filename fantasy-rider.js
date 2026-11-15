import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';

// The bike of the three-worlds scene (fantasy.html), seen from the rider's eyes: handlebars, front fender and front wheel
// in a foreground pass over the splats. Of the mascot only the arms are drawn, with the paws on the grips.
//   desert world -> desert bike      day world -> woodland bike, day skin      night world -> woodland bike, glowing skin
// The GLBs in worlds-models/ are rigged by runs/desert-2026-11-14/worlds/rig_bike.py (headless Blender) from the dev-game
// models: nodes body -> front (fork, bars, fender; origin on the steering axis) -> wheel_f (origin at the axle), all in
// bike-mount space (metres, y up, -z forward, wheels on y = 0). rig.json holds each bike's steering axis and wheel radius.
// update() steers `front` about that axis and spins `wheel_f` with the ride speed.
// A world switch drives blend(from, to, p) with the rainfall reveal's own p: the bike changes top-down in the same
// per-column rain pattern and cyan flash as the scenery (desert <-> woodland dissolves one bike into the other;
// day <-> night sweeps the skin across the one woodland bike).
const A = './worlds-models/';
export const URLS = {desert: A + 'desert-rigged.glb', day: A + 'roots-day-rigged.glb', night: A + 'roots-night-rigged.glb', rider: A + 'rider-rigged.glb', rig: A + 'rig.json',
  winter: A + 'winter-rigged.glb', cyberpunk: A + 'cyberpunk-rigged.glb', countryside: A + 'countryside-rigged.glb', rigNew: A + 'rig-new.json'};
// Rider's-eye camera in bike-mount space. It sits a little behind and below a real rider's eyes and looks slightly down,
// so the bars and the front wheel stay in view under the road ahead (a "view model" camera, as first-person games use).
export const POV = {eye: new THREE.Vector3(0, 1.36, 0.42), pitchDown: 14, minFov: 55, maxFov: 80};
const STEER_MAX = THREE.MathUtils.degToRad(14);
// First-person arms. The forearm and paw sit on the grip exactly as the rider model was posed (so the paw meets the forearm
// as modelled) and turn with the bar. The upper arm runs from the elbow down and back, out of the bottom of the view:
// `dir` is its direction from shoulder to elbow (x mirrored per side) and `upper` its length scale, so its cut end stays hidden.
const ARM = {upper: 1.5, dir: {x: 0.15, y: 1, z: -0.4},
  // On a narrow handlebar (grips under 30 cm from the middle) the upper arms would rise through the middle of a tall, narrow
  // window as two wide tubes. There the elbows point outwards instead, so the arms leave by the bottom corners.
  narrow: {x: -0.45, z: -0.25, at: 0.22, wide: 0.30}};
const TOP = '1.2';           // m: the sweep runs from this height down to the road
const MAX_TEX = 2048;

// Which vehicle each world rides: the woodland bike has a day and a night skin; the three newer worlds have their own vehicle
// (a snowmobile, a neon street bike, a vintage bike), rigged by runs/new-worlds-2026-11-15/bikes/rig_new.py.
const BIKE = {desert: 'desert', day: 'roots', night: 'roots', winter: 'winter', cyberpunk: 'cyberpunk', ghibli: 'countryside'};
const NEW = ['winter', 'cyberpunk', 'countryside'];
const kindOf = id => BIKE[id] || 'roots', nightOf = id => id === 'night' ? 1 : 0;
const LIGHT = {            // hemisphere sky/ground + intensity, sun colour + intensity, rim colour + intensity, environment
  desert: {sky: 0xfff3dd, gnd: 0x6b5140, hemi: 1.5, sun: 0xffedcd, sunI: 2.2, rim: 0xffe2c0, rimI: 0.8, env: 0.55},
  day:    {sky: 0xe8f0d8, gnd: 0x3d4a33, hemi: 1.2, sun: 0xfff0d0, sunI: 1.6, rim: 0xe6f0c8, rimI: 0.7, env: 0.45},
  night:  {sky: 0x7fa8d8, gnd: 0x10202c, hemi: 0.6, sun: 0x9fb8ff, sunI: 0.9, rim: 0x66d0ff, rimI: 0.7, env: 0.22},
  winter: {sky: 0xeaf3ff, gnd: 0x9aa8b8, hemi: 1.5, sun: 0xf4f8ff, sunI: 1.5, rim: 0xdcecff, rimI: 0.8, env: 0.6},
  cyberpunk: {sky: 0xb48cff, gnd: 0x1a0a2c, hemi: 0.7, sun: 0xff66d8, sunI: 1.0, rim: 0x55e6ff, rimI: 1.0, env: 0.3},
  ghibli: {sky: 0xdff0ff, gnd: 0x5a7a3a, hemi: 1.4, sun: 0xfff2cc, sunI: 1.9, rim: 0xe8f6d0, rimI: 0.7, env: 0.5},
};

function shrink(tex, seen) {
  if (!tex || seen.has(tex)) return; seen.add(tex);
  const im = tex.image; if (!im || Math.max(im.width, im.height) <= MAX_TEX) return;
  const k = MAX_TEX / Math.max(im.width, im.height), c = document.createElement('canvas');
  c.width = Math.round(im.width * k); c.height = Math.round(im.height * k);
  c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
  im.close?.(); tex.image = c; tex.needsUpdate = true;      // flipY and colorSpace stay as the loader set them
}
const MAPS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap'];
function materialsOf(root) { const out = new Set(); root.traverse(o => { if (o.isMesh) { o.frustumCulled = false; out.add(o.material); } }); return [...out]; }

function skyEnvironment(renderer) {
  const s = new THREE.Scene(), g = new THREE.SphereGeometry(10, 32, 16), c = [], top = new THREE.Color(0xbfd6ea), hor = new THREE.Color(0xf3dcc0), low = new THREE.Color(0x8a5a3c);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const y = p.getY(i) / 10, col = y > 0 ? hor.clone().lerp(top, y) : hor.clone().lerp(low, Math.min(1, -y * 2)); c.push(col.r, col.g, col.b); }
  g.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
  s.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({vertexColors: true, side: THREE.BackSide})));
  const pm = new THREE.PMREMGenerator(renderer), env = pm.fromScene(s, 0.02).texture; pm.dispose();
  return env;
}

// The rainfall sweep on a mesh material. u.p: the reveal's progress; u.dir: +1 arriving, -1 leaving, 0 staying (no discard).
// With `night` the material also mixes in the other skin, from u.nA to u.nB across the same sweep.
function patch(mat, u, key, night) {
  mat.side = THREE.DoubleSide;      // the rig's cuts are open: show the inside of the part instead of a see-through hole
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, {dP: u.p, dDir: u.dir});
    if (night) Object.assign(sh.uniforms, {nA: u.nA, nB: u.nB, nMap: {value: night.map}, nNormal: {value: night.normalMap || mat.normalMap},
      nRough: {value: night.roughnessMap || mat.roughnessMap}, nMetal: {value: night.metalnessMap || mat.metalnessMap}});
    sh.vertexShader = 'varying vec3 dPos;\n' + sh.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\n dPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    let f = 'uniform float dP, dDir;\nvarying vec3 dPos;\n' + (night ? 'uniform float nA, nB;\nuniform sampler2D nMap, nNormal, nRough, nMetal;\n' : '') + sh.fragmentShader;
    f = f.replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
      float dH = clamp(dPos.y / ${TOP}, 0.0, 1.0);
      float dDelay = fract(sin(dot(floor(dPos.xz / 0.05), vec2(12.9898, 78.233))) * 43758.5453);
      float dJit = fract(sin(dot(floor(dPos.xy / 0.012), vec2(39.346, 11.135))) * 43758.5453);
      float dStart = 0.30 * dDelay + 0.40 * (1.0 - dH) + 0.05 * dJit;      // the reveal's own timing: high first, per-column delay
      float dR = smoothstep(dStart, dStart + 0.22, dP);
      if ((dDir > 0.0 ? dR : dDir < 0.0 ? 1.0 - dR : 1.0) < 0.5) discard;
      ${night ? 'float bikeNight = mix(nA, nB, dR);' : ''}`);
    if (night) {
      f = f.replace('#include <map_fragment>', THREE.ShaderChunk.map_fragment.replace('texture2D( map, vMapUv )', 'mix(texture2D(map, vMapUv), texture2D(nMap, vMapUv), bikeNight)'));
      for (const [chunk, source, target, uv] of [['roughnessmap_fragment', 'roughnessMap', 'nRough', 'vRoughnessMapUv'], ['metalnessmap_fragment', 'metalnessMap', 'nMetal', 'vMetalnessMapUv'], ['normal_fragment_maps', 'normalMap', 'nNormal', 'vNormalMapUv']])
        f = f.replace(`#include <${chunk}>`, THREE.ShaderChunk[chunk].replaceAll(`texture2D( ${source}, ${uv} )`, `mix(texture2D(${source}, ${uv}), texture2D(${target}, ${uv}), bikeNight)`));
    }
    // the cyan flash of the reveal while a fragment is mid-sweep; the night skin's cyan runes glow (no emissive map in the GLB)
    f = f.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      totalEmissiveRadiance += vec3(0.35, 0.75, 1.0) * (4.0 * dR * (1.0 - dR)) * 1.1;
      ${night ? `vec3 rune = texture2D(nMap, vMapUv).rgb;
      totalEmissiveRadiance += rune * smoothstep(0.12, 0.42, min(rune.g, rune.b) - rune.r) * bikeNight * 0.8;` : ''}`);
    sh.fragmentShader = f;
  };
  mat.customProgramCacheKey = () => 'worlds-rider-' + key;
}

export function createRider(renderer, {onStatus = () => {}, arms = true, after = null, worlds = ['desert', 'day', 'night']} = {}) {
  const kinds = new Set(worlds.map(kindOf)), need = {desert: kinds.has('desert'), roots: kinds.has('roots')};      // only the vehicles of worlds in the game are loaded
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(60, 1, 0.05, 30);
  scene.environment = skyEnvironment(renderer);
  const hemi = new THREE.HemisphereLight(0xffffff, 0x000000, 1); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 1); sun.position.set(-3, 5, -2); scene.add(sun);
  const rim = new THREE.DirectionalLight(0xffffff, 1); rim.position.set(2, 3, 4); scene.add(rim);      // from behind the rider: lights what the rider sees
  const mount = new THREE.Group(); scene.add(mount);

  const p = {value: 1}, U = {desert: {p, dir: {value: 1}}, roots: {p, dir: {value: 0}, nA: {value: 0}, nB: {value: 0}}};
  for (const k of NEW) U[k] = {p, dir: {value: 0}};
  // bikes: {root, front, wheel, axis, radius} per kind
  const state = {bikes: {}, arms: null, steer: 0, t: 0, from: worlds[0], to: worlds[0], p: 1, loaded: []};
  const gltf = new GLTFLoader(), seen = new Set(), pause = ms => new Promise(r => setTimeout(r, ms));
  // Loads start once `after` settles (the page passes "first world is in", so the downloads do not all hit the server at once),
  // and a failed download is retried: the local server refuses connections under a burst.
  const retry = async (fn, tries = 4) => { await after; for (let i = 0; ; i++) { try { return await fn(); } catch (e) { if (i >= tries - 1) throw e; await pause(600 * (i + 1)); } } };
  const loader = {loadAsync: url => retry(() => gltf.loadAsync(url))};
  const done = name => { state.loaded.push(name); apply(); onStatus(state.loaded); };
  const rigInfo = retry(() => fetch(URLS.rig).then(r => { if (!r.ok) throw new Error('rig.json ' + r.status); return r.json(); }));
  const rigNew = NEW.some(k => kinds.has(k)) ? retry(() => fetch(URLS.rigNew).then(r => { if (!r.ok) throw new Error('rig-new.json ' + r.status); return r.json(); })) : null;
  function addBike(kind, root, info) {
    const front = root.getObjectByName('front'), wheel = root.getObjectByName('wheel_f');
    if (!front) throw new Error(kind + ' bike is not rigged (front node missing)');      // a snowmobile has no front wheel
    state.bikes[kind] = {root, front, wheel, axis: new THREE.Vector3().fromArray(info.axis).normalize(), pivot: new THREE.Vector3().fromArray(info.pivot), radius: info.radius, grips: null};
    mount.add(root);
  }
  // The mascot's arms only (no body or head): the rigged rider's arm triangles, on its own skeleton, re-posed every frame
  // by solveArms() so the paws stay on the current bike's grips while the bars turn.
  function addArms(root) {
    root.updateMatrixWorld(true);
    let mesh = null; root.traverse(o => { if (o.isSkinnedMesh) mesh = o; });
    if (!mesh) throw new Error('rider has no skinned mesh');
    const bone = n => mesh.skeleton.bones.find(b => b.name === n), geo = mesh.geometry, si = geo.attributes.skinIndex, sw = geo.attributes.skinWeight;
    const armIdx = new Set(['upper_armL', 'forearmL', 'handL', 'upper_armR', 'forearmR', 'handR'].map(n => mesh.skeleton.bones.findIndex(b => b.name === n)));
    const isArm = new Uint8Array(si.count);
    for (let i = 0; i < si.count; i++) { let w = 0; for (let j = 0; j < 4; j++) if (armIdx.has(si.getComponent(i, j))) w += sw.getComponent(i, j); isArm[i] = w >= 0.85 ? 1 : 0; }
    const idx = geo.index.array, keep = [];
    for (let t = 0; t < idx.length; t += 3) if (isArm[idx[t]] && isArm[idx[t + 1]] && isArm[idx[t + 2]]) keep.push(idx[t], idx[t + 1], idx[t + 2]);
    geo.setIndex(keep); mesh.frustumCulled = false; mesh.material.side = THREE.DoubleSide;
    const wp = b => b.getWorldPosition(new THREE.Vector3()), wq = b => b.getWorldQuaternion(new THREE.Quaternion());
    const arms = ['L', 'R'].map(sd => {
      const up = bone('upper_arm' + sd), fo = bone('forearm' + sd), ha = bone('hand' + sd);
      if (!up || !fo || !ha || fo.parent !== up || ha.parent !== fo) throw new Error('rider arm bones are not upper_arm -> forearm -> hand');
      const S0 = wp(up), E0 = wp(fo), H0 = wp(ha), sx = Math.sign(S0.x) || 1;
      const a = {up, fo, H0, sx, l1: S0.distanceTo(E0) * ARM.upper, HE: H0.clone().sub(E0), dirU: E0.clone().sub(S0).normalize(), qU0: wq(up), qF0: wq(fo), qP: wq(up.parent),
        parentInv: up.parent.matrixWorld.clone().invert(), dir: new THREE.Vector3(sx * ARM.dir.x, ARM.dir.y, ARM.dir.z).normalize()};
      up.scale.setScalar(ARM.upper); fo.scale.setScalar(1 / ARM.upper);      // longer upper arm; forearm and paw keep their size
      return a;
    });
    state.arms = arms; mount.add(root);
  }
  // Grip centres of a bike in mount space: the middle of the rubber grips, which cover roughly the outer 25 cm of the handlebar.
  function measureGrips(front, minY = 0.9) {
    const out = {}, v = new THREE.Vector3(), sum = {L: new THREE.Vector3(), R: new THREE.Vector3()}, n = {L: 0, R: 0}, pts = [];
    const pos = front.geometry?.attributes.position; if (!pos) return null;
    // rest pose: the node's origin is its only offset
    let xmax = 0; for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i).add(front.position); if (v.y > minY) { pts.push(v.clone()); xmax = Math.max(xmax, Math.abs(v.x)); } }
    for (const q of pts) { const ax = Math.abs(q.x); if (ax > xmax - 0.20 && ax < xmax - 0.05) { const k = q.x > 0 ? 'L' : 'R'; sum[k].add(q); n[k]++; } }
    for (const k of ['L', 'R']) { if (!n[k]) return null; out[k] = sum[k].divideScalar(n[k]); }
    return out;
  }
  const ready = Promise.allSettled([
    !need.desert ? null : Promise.all([loader.loadAsync(URLS.desert), rigInfo]).then(([g, rig]) => {
      for (const m of materialsOf(g.scene)) { for (const k of MAPS) shrink(m[k], seen); patch(m, U.desert, 'desert', null); }
      addBike('desert', g.scene, rig.desert); done('desert bike');
    }),
    !need.roots ? null : Promise.all([loader.loadAsync(URLS.day), loader.loadAsync(URLS.night), rigInfo]).then(([day, night, rig]) => {
      const other = materialsOf(night.scene)[0];      // same shape and UVs as the day bike: only its skin is used
      if (!other?.map) throw new Error('night skin has no colour texture');
      for (const k of MAPS) shrink(other[k], seen);
      for (const m of materialsOf(day.scene)) { for (const k of MAPS) shrink(m[k], seen); patch(m, U.roots, 'roots', other); }
      addBike('roots', day.scene, rig['roots-day']);
      state.bikes.roots.grips = measureGrips(state.bikes.roots.front);      // the paws were fitted to the desert bike; this bike's grips sit elsewhere
      done('woodland bikes');
    }),
    ...NEW.filter(k => kinds.has(k)).map(k => Promise.all([loader.loadAsync(URLS[k]), rigNew]).then(([g, rig]) => {
      for (const m of materialsOf(g.scene)) { for (const q of MAPS) shrink(m[q], seen); patch(m, U[k], k, null); }
      // A windshield (the snowmobile's "glass" node) sits on the vanishing point: in a tall, narrow window it covered the way
      // ahead even when see-through. It is not drawn, and the body is cut off level just above the glass's lower edge, in front
      // of the bars only (the ragged opaque rim the glass sat in would otherwise stay). The bars and dash are behind that line.
      const glass = g.scene.getObjectByName('glass'), body = g.scene.getObjectByName('body');
      if (glass) { glass.visible = false;
        const bb = new THREE.Box3().setFromBufferAttribute(glass.geometry.attributes.position);
        if (body?.material && !Array.isArray(body.material) && !bb.isEmpty()) { const m = body.material;
          m.clippingPlanes = [new THREE.Plane(new THREE.Vector3(0, -1, 0), bb.min.y + 0.03), new THREE.Plane(new THREE.Vector3(0, 0, 1), -(bb.max.z + 0.08))];
          m.clipIntersection = true; renderer.localClippingEnabled = true; } }
      addBike(k, g.scene, rig[k]);
      state.bikes[k].grips = measureGrips(state.bikes[k].front, rig[k].bars_y - 0.03);
      done(k + ' vehicle');
    })),
    arms ? loader.loadAsync(URLS.rider).then(g => { addArms(g.scene); done('arms'); }) : null,
  ]).then(r => { for (const x of r) if (x.status === 'rejected') console.error('bike failed to load:', x.reason); return state.loaded; });

  const ca = new THREE.Color(), cb = new THREE.Color(), mixC = (target, a, b, k) => target.copy(ca.set(a)).lerp(cb.set(b), k);
  function apply() {
    const {from, to, p: q} = state, kf = kindOf(from), kt = kindOf(to), moving = q < 1 && from !== to;
    p.value = moving ? q : 1;
    const swap = moving && kf !== kt;      // two different vehicles: both drawn, one leaving and one arriving; otherwise only the current one
    for (const [k, b] of Object.entries(state.bikes)) {
      b.root.visible = swap ? (k === kf || k === kt) : k === kt;
      U[k].dir.value = swap ? (k === kt ? 1 : k === kf ? -1 : 0) : 0;
    }
    // the woodland bike's skin: sweeps across it on day <-> night, and is fixed while it arrives or leaves
    if (!swap) { U.roots.nA.value = moving ? nightOf(from) : nightOf(to); U.roots.nB.value = nightOf(to); }
    else U.roots.nA.value = U.roots.nB.value = nightOf(kt === 'roots' ? to : from);
    const a = LIGHT[from], b = LIGHT[to], k = moving ? q * q * (3 - 2 * q) : 1;
    mixC(hemi.color, a.sky, b.sky, k); mixC(hemi.groundColor, a.gnd, b.gnd, k); hemi.intensity = a.hemi + (b.hemi - a.hemi) * k;
    mixC(sun.color, a.sun, b.sun, k); sun.intensity = a.sunI + (b.sunI - a.sunI) * k;
    mixC(rim.color, a.rim, b.rim, k); rim.intensity = a.rimI + (b.rimI - a.rimI) * k;
    scene.environmentIntensity = a.env + (b.env - a.env) * k;
  }
  function setWorld(id) { if (!LIGHT[id] || (state.from === id && state.to === id && state.p === 1)) return; state.from = state.to = id; state.p = 1; apply(); }
  function blend(from, to, q) { if (!LIGHT[from] || !LIGHT[to]) return; state.from = from; state.to = to; state.p = Math.min(1, Math.max(0, q)); apply(); }

  // steerInput -1..1 (right positive); speed in m/s along the road (negative when backing up)
  function update(dt, steerInput, {speed = 0, reducedMotion = false} = {}) {
    state.steer += (THREE.MathUtils.clamp(steerInput, -1, 1) - state.steer) * Math.min(1, dt * 7); state.t += dt;
    const st = state.steer, v = Math.abs(speed);
    for (const b of Object.values(state.bikes)) {
      b.front.quaternion.setFromAxisAngle(b.axis, -st * STEER_MAX);      // bars, fork and wheel turn together about the steering axis
      if (b.wheel) b.wheel.rotation.x -= speed * dt / b.radius;           // rolling without slipping
    }
    if (state.arms) solveArms(-st * STEER_MAX);
    mount.rotation.set(0, 0, -st * 0.05);                                 // a little lean into the turn
    mount.position.y = !reducedMotion && v > 0.5 ? Math.sin(state.t * 11) * 0.003 * Math.min(1, v / 6) : 0;      // road buzz
  }
  // Arms in mount space: paw on the grip of the bike in view (blended between bikes during a switch), turned with the bar.
  const qS = new THREE.Quaternion(), q1 = new THREE.Quaternion(), qU = new THREE.Quaternion(), qF = new THREE.Quaternion(), qI = new THREE.Quaternion(), qA = new THREE.Quaternion();
  const T = new THREE.Vector3(), T2 = new THREE.Vector3(), E = new THREE.Vector3(), w1 = new THREE.Vector3();
  function gripTarget(out, kind, arm, angle) {
    const b = state.bikes[kind]; if (!b) return false;
    const g = b.grips ? b.grips[arm.sx > 0 ? 'L' : 'R'] : arm.H0;
    out.copy(g).sub(b.pivot).applyQuaternion(qS.setFromAxisAngle(b.axis, angle)).add(b.pivot); return true;
  }
  function solveArms(angle) {
    const kf = kindOf(state.from), kt = kindOf(state.to), q = state.p, k = kf !== kt && q < 1 ? q * q * (3 - 2 * q) : 1;
    for (const a of state.arms) {
      if (!gripTarget(T, kt, a, angle)) { if (!gripTarget(T, kf, a, angle)) continue; }
      else if (k < 1 && gripTarget(T2, kf, a, angle)) T.lerpVectors(T2, T, k);
      qA.setFromAxisAngle((state.bikes[kt] || state.bikes[kf]).axis, angle);
      { const u = THREE.MathUtils.clamp((Math.abs(T.x) - ARM.narrow.at) / (ARM.narrow.wide - ARM.narrow.at), 0, 1);
        a.dir.set(a.sx * (ARM.narrow.x + (ARM.dir.x - ARM.narrow.x) * u), ARM.dir.y, ARM.narrow.z + (ARM.dir.z - ARM.narrow.z) * u).normalize(); }
      E.copy(T).sub(w1.copy(a.HE).applyQuaternion(qA));                         // elbow: the forearm keeps its modelled pose relative to the paw
      a.up.position.copy(w1.copy(E).addScaledVector(a.dir, -a.l1)).applyMatrix4(a.parentInv);      // shoulder: down the upper arm from the elbow
      q1.setFromUnitVectors(a.dirU, a.dir); qU.copy(q1).multiply(a.qU0);
      a.up.quaternion.copy(qI.copy(a.qP).invert()).multiply(qU);
      qF.copy(qA).multiply(a.qF0); a.fo.quaternion.copy(qI.copy(qU).invert()).multiply(qF);      // the paw bone keeps its own pose under the forearm
    }
  }
  const dir = new THREE.Vector3(), right = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0), tgt = new THREE.Vector3();
  // yaw / pitch in degrees, as the world camera's look-around uses them (yaw right positive, pitch down positive)
  function render(aspect, {yaw = 0, pitch = 0, fov = 60} = {}) {
    if (!Object.keys(state.bikes).length) return;
    camera.aspect = aspect; camera.fov = THREE.MathUtils.clamp(fov, POV.minFov, POV.maxFov);
    camera.position.copy(POV.eye);
    dir.set(0, 0, -1).applyAxisAngle(UP, -yaw * Math.PI / 180); right.crossVectors(dir, UP).normalize();
    dir.applyAxisAngle(right, -(pitch + POV.pitchDown) * Math.PI / 180);
    camera.up.copy(UP); camera.lookAt(tgt.copy(camera.position).add(dir)); camera.updateProjectionMatrix();
    const ac = renderer.autoClear; renderer.autoClear = false; renderer.clearDepth(); renderer.render(scene, camera); renderer.autoClear = ac;
  }
  apply();
  return {scene, camera, mount, state, ready, setWorld, blend, update, render, uniforms: U};
}
