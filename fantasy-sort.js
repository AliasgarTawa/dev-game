// Sort distances for the worlds game (fantasy.html), worked out on a worker thread.
//
// Splats are drawn back to front, so whenever the camera moves the renderer needs every drawn splat's distance from it.
// The renderer gets those by reading a texture back from the graphics card (gl.getBufferSubData). In Chrome that call
// waits for everything already queued for the graphics card. Measured while riding on an M3 (1.0M splats, 1440 x 820,
// 2026-11-17): each read blocked the page for 110 to 230 ms, two to three times a second, a third of all the time;
// the frames in between took 37 ms and one frame in ten took over 100 ms.
//
// The same distances can be computed from what the page already holds: the centres of each tile's splats, which of them
// the level of detail picked for each tile copy, where each copy stands, and the bend of the track (the arithmetic of
// bendModifier in fantasy.html). A worker does that, so the page never waits for the graphics card.
//
// Which pick: a new level-of-detail pick can arrive between the renderer generating a set of splats and sorting it, so
// every pick carries a serial number, each generated set remembers the serials it was made from, and the worker keeps
// the last two picks of every tile copy. A set is only ever sorted with the picks it was made from.
//
// Safety: the first time a world's tile, or a combination of worlds, is drawn, the worker's distances are compared with
// the renderer's own read (they agree to about 0.001%). While o.hold() is true (the rainfall world switch, with two whole
// worlds drawn at once) the renderer's own read is used, as before: with the worker that reveal lost frames to the checks. A mismatch, an error, or three missing answers in a row switch this off for the session and the
// renderer goes back to reading from the graphics card. Nothing here can stop the frame loop: every path returns distances.
//
// It leans on internals of the vendored renderer (vendor/spark.module.js): SparkRenderer.readbackDepth and
// updateLodIndices, the accumulator's prepareGenerate and mapping, and the packed splat layout. If a newer renderer
// changes them, the first-use check fails and this module steps aside.

function workerMain() {
  // half-float to float, as a table
  const half = new Float32Array(65536);
  { const u = new Uint32Array(1), f = new Float32Array(u.buffer);
    for (let h = 0; h < 65536; h++) { const s = h >> 15 & 1, e = h >> 10 & 31, m = h & 1023; let bits;
      if (e === 0) { if (m === 0) bits = s << 31; else { let mant = m, ex = -14; while ((mant & 1024) === 0) { mant <<= 1; ex--; } bits = s << 31 | (ex + 127) << 23 | (mant & 1023) << 13; } }
      else if (e === 31) bits = s << 31 | (m ? 0x7fc00000 : 0x7f800000);
      else bits = s << 31 | (e - 15 + 127) << 23 | m << 13;
      u[0] = bits; half[h] = f[0]; } }
  let B = null;                                   // {P0, T, R, U}: the track's origin and its along / right / up directions
  // tile id -> its splats' centres as (along T, along R, along U) triples, and the middle of the tile along T.
  // mesh key -> the last two picks for that tile copy: the same triples for the picked splats, gathered once per pick
  // in the order the renderer keeps them. Gathering jumps about in memory; after it, each set of distances is one
  // straight pass.
  const tiles = new Map(), picks = new Map();
  const PX = new Float64Array(4), PY = new Float64Array(4), PH = new Float64Array(4), KK = new Float64Array(4), IK = new Float64Array(4), SP = new Float64Array(4), CP = new Float64Array(4), OFF = new Float64Array(4);
  const RF = new Float64Array(4), S0 = new Float64Array(4), C0 = new Float64Array(4);

  // The distance of every drawn splat from the eye, in the order the renderer keeps them (m.meshes: base and count per
  // tile copy; slots between copies stay at infinity, which the sorter leaves out, as the renderer's own read does).
  function fill(m) {
    const out = m.out, b = m.b, tx = B.T[0], ty = B.T[1], tz = B.T[2], rx = B.R[0], ry = B.R[1], rz = B.R[2], ux = B.U[0], uy = B.U[1], uz = B.U[2];
    out.fill(Infinity, 0, m.n);
    const e0x = B.P0[0] - m.eye[0], e0y = B.P0[1] - m.eye[1], e0z = B.P0[2] - m.eye[2];
    // the four stretches of track a splat can be on (before the rider's segment, on it, and the next two), each with
    // the pose it starts from: the same walk as the shader's
    const adv = (px, py, ph, k, len) => { const e = ph + k * len; return Math.abs(k) < 1e-9 ? [px + len * Math.cos(ph), py + len * Math.sin(ph), e] : [px + (Math.sin(e) - Math.sin(ph)) / k, py + (Math.cos(ph) - Math.cos(e)) / k, e]; };
    const s1 = adv(b.cx, b.cy, b.phi, b.k1, b.ln0), s2 = adv(s1[0], s1[1], s1[2], b.k2, b.ln1), ln0 = b.ln0, ln01 = b.ln0 + b.ln1;
    const C = [[b.cx, b.cy, b.phi, b.k0, 0], [b.cx, b.cy, b.phi, b.k1, 0], [s1[0], s1[1], s1[2], b.k2, ln0], [s2[0], s2[1], s2[2], b.k3, ln01]];
    for (let c = 0; c < 4; c++) { PX[c] = C[c][0]; PY[c] = C[c][1]; PH[c] = C[c][2]; const k = C[c][3], flat = Math.abs(k) < 1e-9; KK[c] = flat ? 0 : k; IK[c] = flat ? 0 : 1 / k; SP[c] = Math.sin(C[c][2]); CP[c] = Math.cos(C[c][2]); OFF[c] = C[c][4]; }
    for (const q of m.meshes) {
      if (q.empty) continue;      // an invisible copy without a pick yet: left at infinity, not drawn
      const pk = picks.get(q.key), ix = pk && (pk[0] && pk[0].serial === q.serial ? pk[0] : pk[1] && pk[1].serial === q.serial ? pk[1] : null);
      if (!ix || !ix.G || ix.n !== q.count) return false;
      const G = ix.G, base = q.base, n = q.count;
      const px0 = q.x - B.P0[0], py0 = q.y - B.P0[1], pz0 = q.z - B.P0[2];
      const oa = px0 * tx + py0 * ty + pz0 * tz - b.a0, ol = px0 * rx + py0 * ry + pz0 * rz, oh = px0 * ux + py0 * uy + pz0 * uz;
      // On a curve the heading at a splat is the heading at the middle of this tile copy plus a small turn (the copy is
      // 13 m long, the tightest curve 35 m), so its sine and cosine come from the middle's by a short series; a splat
      // further than 0.3 rad of turn from the middle gets the exact ones.
      for (let c = 0; c < 4; c++) { RF[c] = ix.mid + oa - OFF[c]; const E = PH[c] + KK[c] * RF[c]; S0[c] = Math.sin(E); C0[c] = Math.cos(E); }
      for (let i = 0, g = 0; i < n; i++, g += 3) {
        let aa = G[g] + oa; const l = G[g + 1] + ol, h = G[g + 2] + oh;
        let c; if (aa < 0) c = 0; else if (aa <= ln0) c = 1; else if (aa <= ln01) { c = 2; aa -= ln0; } else { c = 3; aa -= ln01; }
        let X, Y; const k = KK[c];
        if (k === 0) { const sp = SP[c], cp = CP[c]; X = PX[c] + aa * cp - l * sp; Y = PY[c] + aa * sp + l * cp; }
        else { const d = k * (aa - RF[c]), d2 = d * d; let sE, cE;
          if (d2 < 0.09) { const sd = d * (1 - d2 * (1 / 6) * (1 - d2 * 0.05)), cd = 1 - d2 * 0.5 * (1 - d2 * (1 / 12) * (1 - d2 * (1 / 30))); sE = S0[c] * cd + C0[c] * sd; cE = C0[c] * cd - S0[c] * sd; }
          else { const E = PH[c] + k * aa; sE = Math.sin(E); cE = Math.cos(E); }
          X = PX[c] + (sE - SP[c]) * IK[c] - l * sE; Y = PY[c] + (CP[c] - cE) * IK[c] + l * cE; }
        const dx = e0x + tx * X + rx * Y + ux * h, dy = e0y + ty * X + ry * Y + uy * h, dz = e0z + tz * X + rz * Y + uz * h;
        out[base + i] = Math.sqrt(dx * dx + dy * dy + dz * dz);
      }
    }
    return true;
  }

  onmessage = e => { const m = e.data;
    try {
      if (m.t === 'init') B = m;
      else if (m.t === 'tile') {      // packed splats: four words each; the centre is three half floats (word 1 low and high, word 2 low)
        const p = m.packed, n = m.n, C = new Float32Array(n * 3), tx = B.T[0], ty = B.T[1], tz = B.T[2], rx = B.R[0], ry = B.R[1], rz = B.R[2], ux = B.U[0], uy = B.U[1], uz = B.U[2]; let lo = Infinity, hi = -Infinity;
        for (let i = 0, c = 0; i < n; i++, c += 3) { const w1 = p[i * 4 + 1], x = half[w1 & 65535], y = half[w1 >>> 16], z = half[p[i * 4 + 2] & 65535], a = x * tx + y * ty + z * tz;
          C[c] = a; C[c + 1] = x * rx + y * ry + z * rz; C[c + 2] = x * ux + y * uy + z * uz; if (a < lo) lo = a; if (a > hi) hi = a; }
        tiles.set(m.id, {C, n, mid: n ? (lo + hi) / 2 : 0});
      }
      else if (m.t === 'pick') { const t = tiles.get(m.tile), I = m.I, n = m.n; let G = null;
        if (t) { const C = t.C, N = t.n; G = new Float32Array(n * 3); for (let i = 0, g = 0; i < n; i++, g += 3) { const j = I[i]; if (j < N) { const c = j * 3; G[g] = C[c]; G[g + 1] = C[c + 1]; G[g + 2] = C[c + 2]; } else G[g] = G[g + 1] = G[g + 2] = 1e30; } }
        const pk = picks.get(m.key) || [null, null]; pk[1] = pk[0]; pk[0] = {serial: m.serial, G, n, mid: t ? t.mid : 0}; picks.set(m.key, pk); }
      else if (m.t === 'keys') { const t0 = performance.now(), ok = fill(m); postMessage({t: 'keys', seq: m.seq, ok, out: m.out, ms: performance.now() - t0}, [m.out.buffer]); }
    } catch (err) { postMessage({t: 'error', seq: m.seq, message: String(err), out: m.out || null}, m.out ? [m.out.buffer] : []); }
  };
}

// spark: the SparkRenderer. o: {P0, Tu, RIGHT, up} (THREE.Vector3, as the bend shader uses them) and bend(reuse) ->
// {a0, cx, cy, phi, k0, k1, k2, k3, ln0, ln1}, the bend's inputs as the shader has them now; hold() -> true while the
// renderer's own read should be used (a world switch).
// Returns {state, off(reason)} or null if it could not start (the renderer then carries on as before).
export function createSortKeys(spark, o) {
  const {P0, Tu, RIGHT, up, bend, hold = () => false} = o;
  const proto = spark.display && Object.getPrototypeOf(spark.display);
  if (typeof spark.readbackDepth !== 'function' || typeof spark.updateLodIndices !== 'function' || !proto || typeof proto.prepareGenerate !== 'function' || typeof Worker === 'undefined') return null;
  // worker / card: sorts fed by the worker / by the renderer's own read from the graphics card (reasons says why)
  // pause: set true (from the console or a test) to use the renderer's own read for a while, to compare the two in one ride
  const state = {on: true, pause: false, why: '', worker: 0, card: 0, checked: 0, slow: 0, lastMs: 0, maxMs: 0, worst: 0, left: 0, reasons: {}};      // left: worker sorts that left out an invisible copy with no pick yet
  const count = why => { state.card++; state.reasons[why] = (state.reasons[why] || 0) + 1; };
  const url = URL.createObjectURL(new Blob(['(' + workerMain.toString() + ')()'], {type: 'text/javascript'}));
  const worker = new Worker(url);
  worker.postMessage({t: 'init', P0: P0.toArray(), T: Tu.toArray(), R: RIGHT.toArray(), U: up.toArray()});
  let seq = 0, pending = null, buf = null;      // the request in flight, and the spare distance buffer that travels to the worker and back
  const off = why => { if (!state.on) return; state.on = false; state.why = String(why); console.warn('sort distances: back to the renderer\'s own read (' + state.why + ')'); try { worker.terminate(); URL.revokeObjectURL(url); } catch (e) {} if (pending) { const p = pending; pending = null; clearTimeout(p.timer); p.resolve(null); } };

  // each tile's splat centres go to the worker once; each level-of-detail pick sends the splats chosen for each copy
  const tileIds = new WeakMap(), tileOk = new Map(), meshPick = new WeakMap(), okSets = new Set(); let nextTile = 1, serial = 0;
  const tileOf = mesh => { const ls = mesh.packedSplats && mesh.packedSplats.lodSplats; if (!ls || !ls.packedArray || !ls.numSplats) return 0;
    let id = tileIds.get(ls);
    if (!id) { id = nextTile++; tileIds.set(ls, id); tileOk.set(id, false); const packed = ls.packedArray.slice(0, ls.numSplats * 4); worker.postMessage({t: 'tile', id, n: ls.numSplats, packed}, [packed.buffer]); }
    return id; };
  const update0 = spark.updateLodIndices;
  spark.updateLodIndices = function (uuidToMesh, keyIndices) {
    if (state.on) try { for (const [uuid, ci] of Object.entries(keyIndices)) { const mesh = uuidToMesh.get(uuid); if (!mesh || mesh.paged) continue; const tile = tileOf(mesh); if (!tile) continue;
      // The renderer only sends a new pick to the graphics card if the copy's pick texture has been drawn with before. A
      // second pick that arrives before the first was ever used changes the count and nothing else: the card keeps the
      // first pick's splats. (Seen at start-up, where the first-use check caught it.) So that is what is mirrored here.
      const inst = this.lodInstances && this.lodInstances.get(mesh); let src = ci.indices;
      if (inst && inst.indices && ci.indices.length <= inst.indices.length && !this.renderer.properties.has(inst.texture)) src = inst.indices;
      const I = src.slice(0, ci.numSplats), s = ++serial; meshPick.set(mesh, {n: ci.numSplats, tile, serial: s, at: performance.now()}); worker.postMessage({t: 'pick', key: mesh.uuid, tile, serial: s, n: ci.numSplats, I}, [I.buffer]); } } catch (e) { off('picks: ' + e); }
    return update0.call(this, uuidToMesh, keyIndices);
  };

  // what each set of generated splats was made from: where every tile copy stood, which pick it used, and the bend
  const prepare0 = proto.prepareGenerate;
  proto.prepareGenerate = function (a) {
    const r = prepare0.call(this, a); if (!state.on || !r || typeof r.generate !== 'function') return r;
    const acc = this, gen = r.generate;
    r.generate = () => { gen();
      try { const s = acc.__keys || (acc.__keys = {pos: [], pick: [], op: [], bend: null, n: 0, ok: false}), mp = acc.mapping; s.n = mp.length; s.ok = true;
        for (let i = 0; i < mp.length; i++) { const node = mp[i].node, e = node.matrixWorld.elements, p = s.pos[i] || (s.pos[i] = [0, 0, 0]), pk = meshPick.get(node);
          if (e[0] !== 1 || e[5] !== 1 || e[10] !== 1 || e[1] || e[2] || e[4] || e[6] || e[8] || e[9]) s.ok = false;      // copies are only ever moved, never turned or scaled
          p[0] = e[12]; p[1] = e[13]; p[2] = e[14]; s.pick[i] = pk ? pk.serial : 0; s.op[i] = node.opacity; }
        s.bend = bend(s.bend); } catch (err) { acc.__keys = null; } };
    return r;
  };

  worker.onmessage = e => { const m = e.data; if (m.out) buf = m.out;
    if (pending && m.seq === pending.seq) { const p = pending; pending = null; clearTimeout(p.timer); p.resolve(m); } };
  worker.onerror = e => off('worker: ' + (e && e.message || 'error'));

  const read0 = spark.readbackDepth;
  spark.readbackDepth = async function (a) {
    if (!state.on) return read0.call(this, a);
    let msg = null, check = false, why = '', sig = '', tilesIn = null; const skip = [];
    try { const {current, numSplats} = a, s = current.__keys, mp = current.mapping;
      if (state.pause) why = 'paused'; else if (hold()) why = 'world switch'; else if (!s || !s.ok || !s.bend || s.n !== mp.length) why = 'no snapshot'; else if (pending) why = 'busy';
      else { const meshes = []; tilesIn = new Set(); sig = '';
        for (let i = 0; i < mp.length; i++) { const q = mp[i], pk = meshPick.get(q.node);
          // A copy that has just been shown (the roll-in switch, or a copy moved to the far end) is held at opacity 0 until
          // its detail pick arrives. Without a pick its distances cannot be worked out here, and these sorts went to the
          // blocking read, several per switch (up to a second each with the card busy). It is invisible, so it is left out
          // of this sort instead (its slots stay at infinity: not drawn); the renderer's read would have drawn it at 0.
          if ((!pk || !s.pick[i]) && s.op && s.op[i] === 0) { meshes.push({key: q.node.uuid, empty: true, base: q.base, count: q.count}); skip.push(q.base, q.base + q.count); continue; }
          if (!pk || !s.pick[i]) { why = 'no pick yet'; break; } if (!tileOk.get(pk.tile)) check = true;
          tilesIn.add(pk.tile);
          meshes.push({key: q.node.uuid, serial: s.pick[i], base: q.base, count: q.count, x: s.pos[i][0], y: s.pos[i][1], z: s.pos[i][2]}); }
        if (!why) { sig = [...tilesIn].sort().join(',');
          if (!okSets.has(sig)) check = true;      // a combination of worlds not checked yet (the first ride in a world, the first switch between two): check it once
          if (!buf || buf.length < numSplats) buf = new Float32Array(Math.ceil(numSplats * 1.25 / 16384) * 16384);
          const eye = current.viewOrigin; msg = {t: 'keys', seq: ++seq, n: numSplats, eye: [eye.x, eye.y, eye.z], b: Object.assign({}, s.bend), meshes, out: buf}; } }
    } catch (e) { off('request: ' + e); }
    if (!msg) { count(why || 'off'); return read0.call(this, a); }
    const out = msg.out; buf = null;
    const answer = new Promise(resolve => { pending = {seq: msg.seq, resolve, timer: setTimeout(() => { if (pending && pending.seq === msg.seq) { pending = null; resolve(null); } }, 1500)}; });
    worker.postMessage(msg, [out.buffer]);
    const {numSplats, readback} = a;
    if (check) {      // first use of a tile, or of this set of tile copies: the renderer's own read as well, and the two must agree
      await read0.call(this, a); const m = await answer; count('check');
      if (m && m.t === 'keys' && m.ok && state.on) { const g = new Float32Array(readback.buffer, readback.byteOffset, numSplats), c = m.out; let n = 0, bad = 0, worst = 0;
        // The card works in float32 on world positions that grow with every lap (copies are never moved back), so near the
        // eye its distances lose absolute precision late in a long ride; allow a few float32 steps at the largest coordinate
        // in play on top of the relative 0.2%, or a first check after many laps would turn the worker off for nothing.
        let mag = 0; for (const v of msg.eye) mag = Math.max(mag, Math.abs(v)); for (const q of msg.meshes) if (!q.empty) mag = Math.max(mag, Math.abs(q.x), Math.abs(q.y), Math.abs(q.z));
        const tol = 8 * mag * 1.1920929e-7, left = i => { for (let j = 0; j < skip.length; j += 2) if (i >= skip[j] && i < skip[j + 1]) return true; return false; };
        for (let i = 0; i < numSplats; i += 53) { if (skip.length && left(i)) continue; const gi = g[i], ci = c[i], gf = gi < 1e30, cf = ci < 1e30; n++;
          if (gf !== cf) bad++; else if (gf) { const d = Math.abs(gi - ci), r = d / Math.max(gi, 1e-9); if (r > worst) worst = r; if (d > 2e-3 * gi + tol) bad++; } }
        state.worst = Math.max(state.worst, worst);
        if (bad > n * 0.002) off('distances differ: ' + bad + ' of ' + n + ' sampled, worst ' + worst.toExponential(2));
        else { for (const t of tilesIn) tileOk.set(t, true); okSets.add(sig); state.checked++; } }
      return readback;
    }
    const m = await answer;
    if (!m || m.t !== 'keys') { count(m ? 'worker error' : 'no answer'); if (state.on && ++state.slow >= 3) off(m ? 'worker error: ' + m.message : 'no answer from the worker, three times running'); return read0.call(this, a); }
    if (!m.ok) { count('pick not held'); return read0.call(this, a); }      // more than two picks went by since this set was generated (rare)
    new Float32Array(readback.buffer, readback.byteOffset, numSplats).set(m.out.subarray(0, numSplats));
    state.worker++; state.slow = 0; state.lastMs = m.ms; if (m.ms > state.maxMs) state.maxMs = m.ms; if (skip.length) state.left++;
    return readback;
  };
  // when the last detail pick for a tile copy arrived (performance.now()), 0 if it never had one; -1 once this module is
  // off, so that nothing waits on picks it no longer records
  const pickAt = mesh => { if (!state.on) return -1; const pk = meshPick.get(mesh); return pk ? pk.at : 0; };
  return {state, off, pickAt};
}
