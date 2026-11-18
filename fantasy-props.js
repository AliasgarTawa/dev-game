// Roadside props for the worlds game: fifty textured models (ten per world), standing beside the path.
//
// Source: runs/map-props-2026-11-15 (Meshy models, 1.7 GB). worlds-props/ holds game-size copies (14 MB in all) made by
// runs/new-worlds-2026-11-15/props/convert.mjs, with props.json (sizes) and layout.json (where each one stands).
//
// The five worlds are five looks of one passage, and the ten props of each world fill the same ten roles ("slots": 1 tower,
// 2 building, 3 monument, 4 finish gate, 5 to 7 medium, 8 finish flag, 9 and 10 small, 11 a low rock on the road that the
// bike rides over with a jolt: rockHit below). A placement names a slot, so every
// world has its own model at the same spot, and a world switch swaps like for like with the same top-to-bottom rain sweep
// the scenery uses (a dithered dissolve here, since the models are solid).
//
// Where a prop stands is given in the straight track's own coordinates: metres along the lap, metres across (right is
// positive), metres above the road. The passage is one 11.9 m tile repeated, with a root arch across the road in the second
// half of each tile and open gaps between arches, so a placement also names a "site": a spot within the tile that is free in
// all five worlds. Each lap the prop goes to the site nearest its lap position. The page's bendPose() then puts it on the
// curved track exactly as the shader puts the splats there.
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';

// light on the props per world (the splats are unlit, so this only has to sit well beside them); glow: [strength, threshold]
// makes the bright, saturated parts of a texture give off light (the night and neon props are painted with glowing lines)
const LIGHT = {
  day:       {sky: 0xe8f0d8, gnd: 0x4a4636, hemi: 1.55, sun: 0xfff0d0, sunI: 1.5, fillI: 0.5, glow: [0, 1]},
  night:     {sky: 0xa8c8ff, gnd: 0x2a4058, hemi: 2.2, sun: 0xa8c4ff, sunI: 0.9, fillI: 0.6, glow: [2.6, 0.1]},
  winter:    {sky: 0xeaf3ff, gnd: 0x9aa8b8, hemi: 1.5, sun: 0xf4f8ff, sunI: 1.1, fillI: 0.45, glow: [0, 1]},
  cyberpunk: {sky: 0xd8c0ff, gnd: 0x3a2060, hemi: 2.0, sun: 0xff9ae6, sunI: 0.9, fillI: 0.6, glow: [2.2, 0.14]},
  ghibli:    {sky: 0xe6f2ff, gnd: 0x6a8a48, hemi: 1.6, sun: 0xfff2cc, sunI: 1.6, fillI: 0.5, glow: [0, 1]},
};
const NEAR = -16, FAR = 82, GROW_MS = 350;

// ---- Moving parts ----
// The models are single fused shells, so a part that should move has to be cut out by where it is. bakeMesh() takes the
// model's one mesh out and returns its triangles in the model's own coordinates (the files store them quantised behind a
// node transform); partGeometry() builds a geometry from some of those triangles.
export function bakeMesh(root) {
  root.updateMatrixWorld(true); let src = null; root.traverse(o => { if (o.isMesh && !src) src = o; }); if (!src) return null;
  const g = src.geometry, p = g.attributes.position, uv = g.attributes.uv, n = p.count, pos = new Float32Array(n * 3), uvs = uv ? new Float32Array(n * 2) : null, v = new THREE.Vector3();
  for (let i = 0; i < n; i++) { v.fromBufferAttribute(p, i).applyMatrix4(src.matrixWorld); pos[i * 3] = v.x; pos[i * 3 + 1] = v.y; pos[i * 3 + 2] = v.z; if (uvs) { uvs[i * 2] = uv.getX(i); uvs[i * 2 + 1] = uv.getY(i); } }
  const index = g.index ? Uint32Array.from(g.index.array) : Uint32Array.from({length: n}, (_, i) => i);
  src.parent.remove(src);
  return {pos, uvs, index, material: src.material, tris: index.length / 3};
}
export function partGeometry(b, tris, origin = [0, 0, 0], copies = []) {      // copies: [{tris, map(x, y, z) -> [x, y, z]}], the same triangles again, moved
  const remap = new Map(), P = [], UV = [], I = [];
  const vert = (i, f, tag) => { const key = f ? tag + ':' + i : i; let k = remap.get(key); if (k === undefined) { k = P.length / 3; remap.set(key, k);
    let x = b.pos[i * 3], y = b.pos[i * 3 + 1], z = b.pos[i * 3 + 2]; if (f) [x, y, z] = f(x, y, z); P.push(x - origin[0], y - origin[1], z - origin[2]); if (b.uvs) UV.push(b.uvs[i * 2], b.uvs[i * 2 + 1]); } return k; };
  for (const t of tris) I.push(vert(b.index[t * 3]), vert(b.index[t * 3 + 1]), vert(b.index[t * 3 + 2]));
  copies.forEach((c, ci) => { for (const t of c.tris) I.push(vert(b.index[t * 3], c.map, ci), vert(b.index[t * 3 + 1], c.map, ci), vert(b.index[t * 3 + 2], c.map, ci)); });
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); if (UV.length) g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
  g.setIndex(I); g.computeVertexNormals(); return g;
}
// Cut a turning part (windmill sails, a waterwheel) out of a model. spec, in the model's own units: centre [x, y] of the axle
// (the axle runs along z, front to back); the part is every triangle whose middle is inside zmin..zmax, above ymin, right of
// xmin and within rmax of the axle, and of those only the largest connected piece (so bits of wall that happen to be in the
// same slab stay where they are). fill180: where the part has nothing opposite it across the axle (a wheel half sunk in a
// wall has no far side to turn into view), the near side is copied there, turned half round.
// The model's mesh is replaced by a 'body' mesh and a 'spin' group at the axle holding the part; turn spin.rotation.z.
export function splitMoving(root, spec) {
  const b = bakeMesh(root); if (!b) return null;
  const nT = b.tris, [cx, cy] = spec.centre, C = new Float32Array(nT * 3), sel = new Uint8Array(nT);
  for (let t = 0; t < nT; t++) { for (let k = 0; k < 3; k++) { const i = b.index[t * 3 + k]; C[t * 3] += b.pos[i * 3] / 3; C[t * 3 + 1] += b.pos[i * 3 + 1] / 3; C[t * 3 + 2] += b.pos[i * 3 + 2] / 3; }
    const x = C[t * 3], y = C[t * 3 + 1], z = C[t * 3 + 2];
    sel[t] = +((spec.zmin === undefined || z >= spec.zmin) && (spec.zmax === undefined || z <= spec.zmax) && (spec.ymin === undefined || y >= spec.ymin) && (spec.xmin === undefined || x >= spec.xmin) && (spec.rmax === undefined || Math.hypot(x - cx, y - cy) <= spec.rmax)); }
  if (spec.largest !== false) {      // connected pieces, with vertices at the same place counted as one (texture seams split them)
    const ids = new Map(), vid = new Int32Array(b.pos.length / 3), par = [];
    for (let i = 0; i < vid.length; i++) { const key = Math.round(b.pos[i * 3] * 4000) + ',' + Math.round(b.pos[i * 3 + 1] * 4000) + ',' + Math.round(b.pos[i * 3 + 2] * 4000); let k = ids.get(key); if (k === undefined) { k = par.length; ids.set(key, k); par.push(k); } vid[i] = k; }
    const find = x => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
    for (let t = 0; t < nT; t++) if (sel[t]) { const a = find(vid[b.index[t * 3]]); for (let k = 1; k < 3; k++) { const c = find(vid[b.index[t * 3 + k]]); if (c !== a) par[c] = a; } }
    const count = new Map(); let best = -1, bestN = 0;
    for (let t = 0; t < nT; t++) if (sel[t]) { const r = find(vid[b.index[t * 3]]), n = (count.get(r) || 0) + 1; count.set(r, n); if (n > bestN) { bestN = n; best = r; } }
    for (let t = 0; t < nT; t++) if (sel[t] && find(vid[b.index[t * 3]]) !== best) sel[t] = 0;
  }
  const part = [], body = []; for (let t = 0; t < nT; t++) (sel[t] ? part : body).push(t);
  const copies = [];
  if (spec.fill180 && part.length) { const NA = 36, NR = 8; let rmax = 0; for (const t of part) rmax = Math.max(rmax, Math.hypot(C[t * 3] - cx, C[t * 3 + 1] - cy));
    const bin = t => { const x = C[t * 3] - cx, y = C[t * 3 + 1] - cy; return [Math.min(NR - 1, Math.floor(Math.hypot(x, y) / rmax * NR)), Math.floor((Math.atan2(y, x) + Math.PI) / (2 * Math.PI) * NA) % NA]; };
    const occ = new Uint16Array(NA * NR); for (const t of part) { const [r, a] = bin(t); occ[r * NA + a]++; }
    const fill = part.filter(t => { const [r, a] = bin(t); return r >= 2 && occ[r * NA + (a + NA / 2) % NA] === 0; });      // not the hub: it is whole
    if (fill.length) copies.push({tris: fill, map: (x, y, z) => [2 * cx - x, 2 * cy - y, z]}); }
  const bodyMesh = new THREE.Mesh(partGeometry(b, body), b.material); bodyMesh.name = 'body';
  const spin = new THREE.Group(); spin.name = 'spin'; spin.position.set(cx, cy, 0); spin.add(new THREE.Mesh(partGeometry(b, part, [cx, cy, 0], copies), b.material));
  root.add(bodyMesh, spin); return {spin, part: part.length, body: body.length, filled: copies.length ? copies[0].tris.length : 0};
}
// A flag: where its pole is, which side the cloth hangs, how long the cloth is and where it ends below (model units), found
// from the shape: the pole is under the model's highest point, the cloth is what reaches furthest from it in the upper half.
// Returns the two uniform vectors the wave in the vertex shader uses, and puts the mesh back in the model's own coordinates.
export function flagWave(root, F) {
  const b = bakeMesh(root); if (!b) return null; const n = b.pos.length / 3; let y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < n; i++) { y0 = Math.min(y0, b.pos[i * 3 + 1]); y1 = Math.max(y1, b.pos[i * 3 + 1]); }
  const H = y1 - y0; let xp = 0, m = 0; for (let i = 0; i < n; i++) if (b.pos[i * 3 + 1] > y1 - 0.03 * H) { xp += b.pos[i * 3]; m++; } xp /= m;
  let sum = 0; for (let i = 0; i < n; i++) if (b.pos[i * 3 + 1] > y0 + 0.45 * H && Math.abs(b.pos[i * 3] - xp) > 0.12 * H) sum += b.pos[i * 3] - xp;
  const side = Math.sign(sum) || 1; let len = 0; for (let i = 0; i < n; i++) if (b.pos[i * 3 + 1] > y0 + 0.45 * H) len = Math.max(len, (b.pos[i * 3] - xp) * side);
  let yMin = y1; for (let i = 0; i < n; i++) if (b.pos[i * 3 + 1] > y0 + 0.3 * H && (b.pos[i * 3] - xp) * side > 0.35 * len) yMin = Math.min(yMin, b.pos[i * 3 + 1]);
  const all = Array.from({length: b.tris}, (_, t) => t), mesh = new THREE.Mesh(partGeometry(b, all), b.material); root.add(mesh);
  return {uWave: new THREE.Vector4(xp, side, yMin - 0.02 * H, (F.amp_frac ?? 0.1) * len), uWave2: new THREE.Vector4(len, (F.waves ?? 1.3) * 2 * Math.PI / len, F.speed ?? 5, 0), len, yMin, xp, side, H};
}      // metres behind / ahead of the rider within which a prop is drawn; grow-in time

export function createProps(scene, o) {
  const {worlds, P0, Tu, RIGHT, up, upm, eye, bendAxis, bendPose, lapLen, period, after = Promise.resolve(), version = '', copyOpacity = () => 1, roadHeight = () => 0, onStatus = () => {}, renderer = null, camera = null} = o;
  const U = up.clone().normalize();
  const lapM = lapLen / upm, PlM = period / upm;
  const hemi = new THREE.HemisphereLight(0xffffff, 0x000000, 1), sun = new THREE.DirectionalLight(0xffffff, 1), fill = new THREE.DirectionalLight(0xffffff, 0.4);
  scene.add(hemi, sun, sun.target, fill, fill.target);
  const uni = {uP: {value: 1}, uUp: {value: U.clone()}, uBase: {value: 0}, uSpan: {value: 4 * upm}, uCell: {value: 0.15 * upm}, uTime: {value: 0}};
  const NOWAVE = {uWave: new THREE.Vector4(0, 1, 0, 0), uWave2: new THREE.Vector4(1, 0, 0, 0)};
  const W = {};                                                    // per world: {group, insts, uDir, uGlow, loaded}
  // a world's group is in the scene only while it is drawn (apply): three.js and the splat renderer walk every node in
  // the scene each frame, hidden or not, and four of the five worlds are hidden at any time
  for (const id of worlds) { const g = new THREE.Group(); g.visible = false; W[id] = {group: g, insts: [], uDir: {value: 1}, uGlow: {value: new THREE.Vector2(...(LIGHT[id] || LIGHT.day).glow)}, loaded: false, failed: 0}; }
  const state = {from: worlds[0], to: worlds[0], p: 1, loaded: [], drawn: 0, rockHits: 0, error: null, W};

  // The scenery's rain sweep (fantasy.html revealModifier), on a solid surface: the same start time by height and by ground
  // column, and a screen-door dissolve in place of opacity.
  // wave (flags only): the cloth is pushed front and back by a wave that travels from the pole to the free end and grows
  // towards it; the pole, the base and everything below the cloth stay still.
  function patch(mat, w, wave = NOWAVE) {
    mat.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, uni, {uDir: w.uDir, uGlow: w.uGlow, uWave: {value: wave.uWave}, uWave2: {value: wave.uWave2}});
      sh.vertexShader = 'varying vec3 vPropW;\nuniform vec4 uWave, uWave2; uniform float uTime;\n' + sh.vertexShader
        .replace('#include <begin_vertex>', `#include <begin_vertex>
  if (uWave.w > 0.0) { float pvU = clamp((transformed.x - uWave.x) * uWave.y / uWave2.x, 0.0, 1.0);
    transformed.z += uWave.w * pvU * sqrt(pvU) * step(uWave.z, transformed.y) * sin(uWave2.y * pvU * uWave2.x - uTime * uWave2.z); }`)
        .replace('#include <project_vertex>', '#include <project_vertex>\n  vPropW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = 'varying vec3 vPropW;\nuniform float uP, uDir, uBase, uSpan, uCell; uniform vec3 uUp; uniform vec2 uGlow;\n' + sh.fragmentShader
        .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
  float pvH = clamp((dot(vPropW, uUp) - uBase) / uSpan, 0.0, 1.0);
  vec3 pvF = vPropW - dot(vPropW, uUp) * uUp;
  vec2 pvC = floor(vec2(pvF.x + pvF.z, pvF.y - pvF.z) / uCell);
  float pvS = 0.30 * fract(sin(dot(pvC, vec2(12.9898, 78.233))) * 43758.5453) + 0.40 * (1.0 - pvH);
  float pvR = smoothstep(pvS, pvS + 0.22, uP);
  float pvK = uDir > 0.0 ? pvR : 1.0 - pvR;
  if (pvK <= fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) * 0.999 + 0.0005) discard;`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
  { float pvMx = max(diffuseColor.r, max(diffuseColor.g, diffuseColor.b)), pvMn = min(diffuseColor.r, min(diffuseColor.g, diffuseColor.b));
    totalEmissiveRadiance += diffuseColor.rgb * uGlow.x * smoothstep(uGlow.y, uGlow.y + 0.2, (pvMx - pvMn) * pvMx);
    if (uDir > 0.0) totalEmissiveRadiance += vec3(0.35, 0.75, 1.0) * (4.0 * pvR * (1.0 - pvR)) * 0.55; }`);
    };
    mat.customProgramCacheKey = () => 'worlds-prop';
  }

  const gltf = new GLTFLoader(), pause = ms => new Promise(r => setTimeout(r, ms));
  const retry = async (fn, tries = 4) => { for (let i = 0; ; i++) { try { return await fn(); } catch (e) { if (i >= tries - 1) throw e; await pause(600 * (i + 1)); } } };
  const getJson = url => retry(() => fetch(url, {cache: 'no-store'}).then(r => { if (!r.ok) throw new Error(url + ' ' + r.status); return r.json(); }));
  const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _pose = {x: 0, y: 0, phi: 0}, _m = new THREE.Matrix4(), _a = new THREE.Vector3(), _b = new THREE.Vector3();

  // One model, ready to place: its scene wrapped so that the middle of its base is at the origin, plus its size.
  async function loadModel(e, w) {
    const g = await retry(() => gltf.loadAsync('./worlds-props/' + e.file + '?v=' + (version || e.bytes)));
    const root = g.scene; root.updateMatrixWorld(true);
    // moving parts: a turning piece cut out of the model (layout.moving), or a flag's cloth found for the wave
    const mv = layout.moving?.[e.world + '/' + e.slot]; let spin = null, wave;
    try { if (mv?.spin) spin = splitMoving(root, mv.spin); else if (e.slot === 8 && layout.flags) wave = flagWave(root, layout.flags) || undefined; } catch (err) { console.warn('moving part skipped', e.file, err); }
    root.updateMatrixWorld(true);
    root.traverse(m => { if (!m.isMesh) return; if (!m.geometry.attributes.normal) m.geometry.computeVertexNormals();      // the files carry no normals (see convert.mjs)
      m.material.roughness = 0.85; m.material.metalness = 0; if (m.material.normalScale) m.material.normalScale.setScalar(0.8);
      if (e.slot === 11 && layout.rocks?.tint?.[e.world]) m.material.color.multiplyScalar(layout.rocks.tint[e.world]);      // a rock the colour of the road cannot be seen in time
      patch(m.material, w, wave); });
    const box = new THREE.Box3().setFromObject(root), size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
    root.position.sub(new THREE.Vector3(c.x, box.min.y, c.z));
    // a gate's opening, in model units: `inner(f0)` is the nearest its legs come to its middle between the fraction f0 of its
    // height and 45%, and `arch` the fraction of its height where the opening closes overhead
    let inner = null, arch = 0.55;
    if (e.slot === 4) { const bands = new Float32Array(20).fill(Infinity);
      root.traverse(m => { if (!m.isMesh) return; const p = m.geometry.attributes.position;
        for (let i = 0; i < p.count; i++) { _v.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld); const b = Math.min(19, Math.floor((_v.y - box.min.y) / size.y * 20)); bands[b] = Math.min(bands[b], Math.abs(_v.x - c.x)); } });
      inner = f0 => { let m = Infinity; for (let b = Math.ceil(f0 * 20); b < 9; b++) m = Math.min(m, bands[b]); return m; };
      for (let b = 6; b < 20; b++) if (bands[b] < 0.1 * size.x / 2) { arch = b / 20; break; } }
    return {root, size, inner, arch, spin: spin ? {speed: mv.spin.speed ?? 0.8, ...spin, spin: undefined} : null, wave};
  }

  // A placement of a model: how big, which way it faces, where across the road. yawDeg turns the model's front (its +z) from
  // "along the track" towards the right; side props face the road, turned a little towards the oncoming rider.
  function place(model, e, pl, site, L) {
    const inst = new THREE.Group(), child = new THREE.Group(); child.add(model.root.clone()); inst.add(child); inst.visible = false; inst.matrixAutoUpdate = false;      // child carries the size; the model inside it keeps its base-at-origin offset
    let sx, sy, yaw, lat, sink = 0;
    if (!site) {
      // A rock on the road (slot 11): its real size, 60 x 45 x 15 cm, lying across the lane at pl.lat metres from the middle and
      // turned a little, differently each (so they are not copies of one stone). Its height follows the road (update()).
      sx = sy = pl.scale ?? L.rocks.scale ?? 1; yaw = ((pl.lap * 37) % 50) - 25; lat = pl.lat; sink = L.rocks.sink_m ?? 0.03;
    } else if (e.slot === 4) {
      // Finish gate, across the road. Its flared feet are sunk into the ground (gate.sink of its height). It is sized so the
      // opening is gate.opening_half_m each side of the middle and the arch clears the rider's head by gate.headroom_m; if
      // that would make it taller than gate.max_height_m it is widened instead (never by more than a quarter).
      // The road is funnelled to gate.lane_cap_m near a gate (laneCap below), because a gate wide enough for the whole
      // road would be eight metres tall.
      const G = L.gate, f = G.sink ?? 0.1, H = model.size.y;
      sx = sy = Math.max(G.opening_half_m / model.inner(f + 0.02), G.headroom_m / ((model.arch - f) * H));
      if (sy * H * (1 - f) > G.max_height_m) { sy = G.max_height_m / (H * (1 - f)); sx = Math.min(sx, sy * 1.25); }
      sink = f * H * sy; yaw = 180; lat = site.lat || 0;
    } else {
      const side = Math.sign(site.edge) || 1, turn = (site.turn ?? 25) * Math.PI / 180;
      let h = e.suggested_m * (L.height_scale[e.size] ?? 1);
      // footprint once turned: along the track and across it
      const along = (model.size.x * Math.cos(turn) + model.size.z * Math.sin(turn)) / model.size.y, across = (model.size.x * Math.sin(turn) + model.size.z * Math.cos(turn)) / model.size.y;
      h = Math.min(h, (site.along ?? L.max_along_m) / along, (site.across ?? L.max_across_m) / across); sx = sy = h / model.size.y;      // never longer than the gap it stands in
      yaw = side < 0 ? 90 + (site.turn ?? 25) : -90 - (site.turn ?? 25); lat = site.edge + side * across * h / 2;
    }
    child.scale.set(sx, sy, sy);
    // What the bike can run into (metres): circles on the ground, each {lat: metres from the middle of the road, da: metres
    // along from the prop's place, r}. A side prop is one circle whose inner edge is the prop's; a gate is its two legs.
    // Rocks have none: they are ridden over.
    const col = [];
    if (site && e.slot === 4) { const open = model.inner((L.gate.sink ?? 0.1) + 0.02) * sx, r = Math.max(0.2, Math.min((model.size.x * sx / 2 - open) / 2, model.size.z * sy / 2));
      col.push({lat: lat - open - r, da: 0, r}, {lat: lat + open + r, da: 0, r}); }
    else if (site) { const side = Math.sign(site.edge) || 1, turn = (site.turn ?? 25) * Math.PI / 180, h = model.size.y * sy;
      const along = (model.size.x * Math.cos(turn) + model.size.z * Math.sin(turn)) / model.size.y * h, across = (model.size.x * Math.sin(turn) + model.size.z * Math.cos(turn)) / model.size.y * h, r = Math.max(0.15, Math.min(along, across) / 2);
      col.push({lat: site.edge + side * r, da: 0, r}); }
    const ps = yaw * Math.PI / 180, front = _a.copy(Tu).multiplyScalar(Math.cos(ps)).addScaledVector(RIGHT, Math.sin(ps)).normalize(), X = _b.crossVectors(U, front).normalize();
    const q0 = new THREE.Quaternion().setFromRotationMatrix(_m.makeBasis(X, U, front));
    const spinObj = model.spin ? child.getObjectByName('spin') : null;
    Object.assign(inst.userData, {col, spin: spinObj, spinSpeed: model.spin ? model.spin.speed : 0, lap: pl.lap, u: site ? site.u : null, road: !site, lat, h: (site ? site.ground ?? 0 : 0) + (pl.lift ?? 0) - sink, q0, open: site && e.slot === 4 ? model.inner((L.gate.sink ?? 0.1) + 0.02) * sx : 0, t0: 0, slot: e.slot, heightM: model.size.y * sy, site: pl.site});
    return inst;
  }

  let layout = null, index = null;
  const ready = (async () => {
    await after;
    [index, layout] = await Promise.all([getJson('./worlds-props/props.json'), getJson('./worlds-props/layout.json')]);
    const order = [state.to, ...worlds.filter(id => id !== state.to)];      // the world in view first, the rest in the background
    for (const id of order) {
      const w = W[id]; if (!w) continue;
      const slots = [...new Set(layout.placements.map(p => p.slot))], models = {};
      for (let i = 0; i < slots.length; i += 3) await Promise.all(slots.slice(i, i + 3).map(async s => {       // three at a time: the local server refuses bursts
        const e = index[id + '/' + s]; if (!e) return;
        try { models[s] = await loadModel(e, w); } catch (err) { w.failed++; console.warn('prop not loaded', e.file, err); } }));
      for (const pl of layout.placements) { const m = models[pl.slot], site = layout.sites[pl.site]; if (!m || (!site && pl.lat === undefined)) continue;
        const inst = place(m, index[id + '/' + pl.slot], pl, site, layout); w.insts.push(inst); w.group.add(inst); }
      // Compile the shaders and send the textures to the graphics card now, a model at a time between frames, so the first
      // time a prop comes into view (or a world is switched to) costs nothing.
      if (renderer && camera) for (const m of Object.values(models)) { try {
        m.root.traverse(q => { if (q.isMesh) for (const k of ['map', 'normalMap']) if (q.material[k]) renderer.initTexture(q.material[k]); });
        await renderer.compileAsync(m.root, camera, scene); } catch (err) { console.warn('prop warm-up skipped', err); }      // the model itself, not its world's group: nothing is made visible for this
        await pause(30); }
      w.hasRock = !!models[11]; w.loaded = true; state.loaded.push(id); onStatus(state.loaded); apply();
    }
  })().catch(e => { state.error = e; console.warn('props off:', e); });

  // which worlds are drawn, and the light, from (from, to, p)
  const cA = new THREE.Color(), cB = new THREE.Color();
  function apply() {
    // In a solid blend (the roll-in switch) the leaving world stays drawn until the switch ends, not only until p reaches 1:
    // the roll reaches p = 1 while the old copies at the rider are still there, and their props would vanish before the new
    // ones beside them had faded in. Which world shows at each place is left to copyOpacity.
    const {from, to, p} = state, moving = from !== to && (p < 1 || !!state.solid), k = moving ? p * p * (3 - 2 * p) : 1;
    for (const [id, w] of Object.entries(W)) { const show = w.loaded && (id === to || (moving && id === from)); w.group.visible = show;
      if (show) { if (!w.group.parent) scene.add(w.group); } else if (w.group.parent) scene.remove(w.group);
      w.uDir.value = moving && !state.solid && id === from ? -1 : 1; }
    uni.uP.value = moving && !state.solid ? p : 1;
    const a = LIGHT[from] || LIGHT.day, b = LIGHT[to] || LIGHT.day, mix = (x, y) => x + (y - x) * k;
    hemi.color.copy(cA.set(a.sky)).lerp(cB.set(b.sky), k); hemi.groundColor.copy(cA.set(a.gnd)).lerp(cB.set(b.gnd), k); hemi.intensity = mix(a.hemi, b.hemi);
    sun.color.copy(cA.set(a.sun)).lerp(cB.set(b.sun), k); sun.intensity = mix(a.sunI, b.sunI); fill.color.copy(sun.color); fill.intensity = mix(a.fillI, b.fillI);
  }
  function setWorld(id) { if (state.to === id && state.from === id && state.p === 1) return; state.from = state.to = id; state.p = 1; state.solid = false; apply(); }
  // solid: both worlds' props are drawn whole (no dissolve); which of them shows where is then left to copyOpacity, as
  // in the switch that rolls in a tile copy at a time
  function blend(from, to, p, solid = false) { state.from = from; state.to = to; state.p = p; state.solid = solid; apply(); }

  // Where a rock placed at `lap` metres round the lap lies this lap, near the rider at R (metres along). The lap is not a whole
  // number of tiles, so it falls at a different place in the tile each lap; if that is on the seam between two tile copies
  // (rocks.seam, metres into the tile) it is moved on by rocks.seam_shift_m.
  function rockAt(lap, R) {
    let A = lap + lapM * Math.round((R - lap) / lapM); const k = layout.rocks, ph = ((A % PlM) + PlM) % PlM;
    if (ph > k.seam[0] || ph < k.seam[1]) A += k.seam_shift_m; return A;
  }
  // Every frame: put the props near the rider on the track. along: the rider's distance along the straight line (scene units).
  function update(along, reveal, now = performance.now()) {
    if (reveal) { uni.uBase.value = reveal.base; uni.uSpan.value = reveal.span; }
    uni.uTime.value = now / 1000;
    const R = along / upm; let drawn = 0;
    // the light keeps its direction relative to the rider's heading, which turns as the track does
    bendPose(along, 0, _pose); _q.setFromAxisAngle(bendAxis, _pose.phi);
    sun.position.copy(_v.copy(U).multiplyScalar(1).addScaledVector(RIGHT, -0.55).addScaledVector(Tu, -0.35).applyQuaternion(_q)); sun.target.position.set(0, 0, 0);
    fill.position.copy(_v.copy(U).multiplyScalar(0.5).addScaledVector(RIGHT, 0.4).addScaledVector(Tu, -1).applyQuaternion(_q)); fill.target.position.set(0, 0, 0);
    for (const [id, w] of Object.entries(W)) {
      if (!w.group.visible || (id !== state.to && id !== state.from)) continue;      // only the world in view, and the one leaving during a switch
      for (const inst of w.insts) { const d = inst.userData;
        let A; if (d.road) A = rockAt(d.lap, R); else { A = d.lap + lapM * Math.round((R - d.lap) / lapM); A = d.u + PlM * Math.round((A - d.u) / PlM); }      // this lap's copy, at its site in the tile
        const ahead = A - R;
        d.A = A;
        if (ahead < NEAR || ahead > FAR || copyOpacity(id, A * upm) < 0.98) { inst.visible = false; d.t0 = 0; continue; }      // only where its ground is drawn
        if (d.spin) d.spin.rotation.z = now / 1000 * d.spinSpeed;
        if (!inst.visible) { inst.visible = true; d.t0 = d.t0 || now; }
        const g = Math.min(1, (now - d.t0) / GROW_MS), grow = ahead > 40 ? g * g * (3 - 2 * g) : 1;      // far ones grow in; near ones (a world switch) are simply there
        bendPose(A * upm, d.lat * upm, _pose);
        _v.copy(P0).addScaledVector(Tu, _pose.x).addScaledVector(RIGHT, _pose.y).addScaledVector(U, (d.h + (d.road ? roadHeight(A * upm) : 0) - eye) * upm);
        _q.setFromAxisAngle(bendAxis, _pose.phi).multiply(d.q0);
        inst.matrix.compose(_v, _q, _a.setScalar(upm * Math.max(0.001, grow))); inst.matrixWorldNeedsUpdate = true; drawn++;
      }
    }
    state.drawn = drawn;
  }
  // How far from the middle the bike may ride here (metres), because of a finish gate: gate.lane_cap_m at the gate, easing in
  // over the 22 m before it and out over the 8 m after. Infinity away from gates, and until the layout has loaded.
  function laneCap(along) {
    if (!layout) return Infinity; const R = along / upm, cap = layout.gate.lane_cap_m; let out = Infinity;
    for (const pl of layout.placements) { if (pl.slot !== 4) continue; const site = layout.sites[pl.site]; if (!site) continue;
      let A = pl.lap + lapM * Math.round((R - pl.lap) / lapM); A = site.u + PlM * Math.round((A - site.u) / PlM);
      const d = A - R, k = d > 3 ? (25 - d) / 22 : d < -2 ? (d + 10) / 8 : 1; if (k <= 0) continue;
      const s = Math.min(1, k), e = s * s * (3 - 2 * s); out = Math.min(out, cap + (1 - e) * 2.2); }
    return out;
  }
  // Rocks are ridden over, never a wall. Called once a frame with the rider's place before and after the frame (metres along)
  // and across (metres, right positive): returns {k, side} if the front wheel crossed a rock in that stretch, else null.
  // k is 1 for a hit on the rock's middle, falling to 0.5 at its edge; side is which side of the wheel the rock was on.
  // The stretch is swept, so a fast bike or a slow frame cannot step over a rock, and it works backwards. A rock fires once
  // per crossing: it is armed again only when the wheel is a metre clear of it. This goes by placement, not by world, so a
  // world switch on top of a rock does not fire it twice. Nothing fires until the current world's rocks are loaded and drawn.
  const armed = new Map();
  function rockHit(m0, m1, x) {
    if (!layout || !layout.rocks) return null; const w = W[state.to]; if (!w || !w.loaded || !w.hasRock) return null;
    const k = layout.rocks, front = k.wheel_ahead_m, lo = Math.min(m0, m1) + front - k.radius_along_m, hi = Math.max(m0, m1) + front + k.radius_along_m, reach = k.radius_across_m + k.tyre_m;
    let out = null;
    for (const pl of layout.placements) { if (pl.slot !== 11 || pl.lat === undefined) continue;
      const A = rockAt(pl.lap, m1), id = pl.lap;
      if (armed.get(id) === false) { if (Math.abs(A - (m1 + front)) > 1) armed.set(id, true); continue; }
      if (A < lo || A > hi) continue; const dx = x - pl.lat; if (Math.abs(dx) > reach) continue;
      armed.set(id, false); state.rockHits++; out = {k: 1 - 0.5 * (dx / reach) ** 2, side: Math.sign(-dx) || 1, lap: pl.lap}; }
    return out;
  }
  // The circles the bike can hit near the rider, for the physics engine: [{a: metres along, lat, r}], from the props of the
  // world in view that are drawn now. Only those within 0.46 of a tile (5.5 m): the engine makes each one again a tile
  // before and after (see setObstacles), and with a longer reach one of those copies would stand level with the bike, an
  // invisible gate leg in the road a tile before the gate.
  const _cols = [];
  // During a roll-in switch (solid blend) the props drawn near the bike are still the leaving world's until the change
  // reaches the rider, so both worlds' drawn props count; each instance's visible flag says which is drawn where.
  function colliders(along) {
    _cols.length = 0; const R = along / upm;
    const ws = state.solid && state.from !== state.to ? [W[state.to], W[state.from]] : [W[state.to]];
    for (const w of ws) { if (!w || !w.loaded || !w.group.visible) continue;
      for (const inst of w.insts) { const d = inst.userData; if (!inst.visible || !d.col.length || Math.abs(d.A - R) > PlM * 0.46) continue; for (const c of d.col) _cols.push({a: d.A + c.da, lat: c.lat, r: c.r}); } }
    return _cols;
  }
  apply();
  return {ready, state, setWorld, blend, update, laneCap, colliders, rockHit, rockAt: (lap, R) => layout && layout.rocks ? rockAt(lap, R) : null, lights: {hemi, sun, fill}, uniforms: uni, get layout() { return layout; }};
}
