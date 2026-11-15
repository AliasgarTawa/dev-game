// Rigid-body physics for the worlds game, on NVIDIA PhysX 5 (vendor/physx: the physx-js-webidl browser build).
//
// What PhysX does here: it owns the bike's body, moves it, and resolves its collisions with the standing stones and roots,
// so the bike slides along them and loses speed by friction. What it does not do: balance a two-wheeler. The body is an
// upright capsule that cannot rotate or leave the ground plane (a free bike would fall over, and the scenery only holds
// looking ahead), so lean, pitch and suspension stay visual in fantasy.html.
//
// Space: "straight space" in metres. x = across the path (right positive), z = along it, wrapped into one tile period
// [0, period): the stones are the same in every tile, so walls exist for the tile before, the tile itself and the tile after,
// and the body is carried back one period when it leaves. The curved track is not seen here; fantasy.html adds the curve's
// sideways push to the commanded speed.
//
// Control is at velocity level: before each fixed substep the game's commanded velocity is written to the body, PhysX then
// solves contacts, and the velocity that survives is read back. A stone therefore overrides the command and nothing else does.
const SUB = 1 / 480;                         // longest substep: a frame of 17 to 50 ms is cut into equal parts no longer than this
const MARGIN = 0.01;                         // contact margin per shape (m): how far ahead of touching the engine starts a contact
export const BODY = {radius: 0.42, half: 0.5, y: 0.6};      // capsule along the bike: 1.84 m long, 0.84 m wide (bar width)

export async function createPhysics({url = './vendor/physx/physx-js-webidl.mjs', locate = null, friction = 0.05, straight = 0.04} = {}) {
  const factory = (await import(url)).default;
  const PX = await factory(locate ? {locateFile: locate} : {});
  const TL = PX.PxTopLevelFunctions;
  const top = n => { const f = PX[n] ?? TL?.[n] ?? TL?.prototype?.[n]; return typeof f === 'function' ? f.bind(TL?.prototype ?? PX) : f; };
  const en = (E, n) => { const v = PX[E]?.[n] ?? PX['_emscripten_enum_' + E + '_' + n]?.(); if (v === undefined) throw new Error('PhysX enum missing: ' + E + '.' + n); return v; };

  const version = top('PHYSICS_VERSION');
  const foundation = top('CreateFoundation')(version, new PX.PxDefaultAllocator(), new PX.PxDefaultErrorCallback());
  const scale = new PX.PxTolerancesScale();
  const physics = top('CreatePhysics')(version, foundation, scale);
  const v3 = new PX.PxVec3(0, 0, 0), pose = new PX.PxTransform(en('PxIDENTITYEnum', 'PxIdentity'));      // reused: no per-frame allocation
  const setV = (x, y, z) => { v3.set_x(x); v3.set_y(y); v3.set_z(z); return v3; };
  const setPose = (x, y, z, qy = 0, qw = 1) => { const p = pose.get_p(), q = pose.get_q(); p.set_x(x); p.set_y(y); p.set_z(z); q.set_x(0); q.set_y(qy); q.set_z(0); q.set_w(qw); pose.set_p(p); pose.set_q(q); return pose; };

  const desc = new PX.PxSceneDesc(scale);
  desc.set_gravity(setV(0, 0, 0));                           // the body is held on its plane; height comes from the road profile
  desc.set_cpuDispatcher(top('DefaultCpuDispatcherCreate')(0));
  desc.set_filterShader(top('DefaultFilterShader')());
  const scene = physics.createScene(desc);
  const flags = new PX.PxShapeFlags(en('PxShapeFlagEnum', 'eSCENE_QUERY_SHAPE') | en('PxShapeFlagEnum', 'eSIMULATION_SHAPE'));
  const filter = new PX.PxFilterData(1, 1, 0, 0);
  // friction against a stone: a glancing hit costs a little more speed than the turn alone; no bounce
  const matBike = physics.createMaterial(friction, friction, 0.02), matWall = physics.createMaterial(friction, friction, 0.02);

  // the bike: a capsule lying along z, no rotation, no vertical motion
  const body = physics.createRigidDynamic(setPose(0, BODY.y, 0));
  { const geo = new PX.PxCapsuleGeometry(BODY.radius, BODY.half), sh = physics.createShape(geo, matBike, true, flags);
    sh.setLocalPose(setPose(0, 0, 0, Math.SQRT1_2, Math.SQRT1_2));      // capsule axis x -> z (quarter turn about y)
    sh.setSimulationFilterData(filter); sh.setContactOffset(MARGIN); sh.setRestOffset(0); body.attachShape(sh); }
  body.setMass(180);
  // Rotation is locked, and the engine enforces that by discarding the spin after each solve. With its default inertia (1 kg m^2)
  // almost all of a stone's push at the bike's nose went into that discarded spin (98%), so the bike took a metre to turn
  // aside and lost three times the speed. A very large inertia sends the whole push into the bike's motion.
  body.setMassSpaceInertiaTensor(setV(1e9, 1e9, 1e9));
  for (const f of ['eLOCK_LINEAR_Y', 'eLOCK_ANGULAR_X', 'eLOCK_ANGULAR_Y', 'eLOCK_ANGULAR_Z']) body.setRigidDynamicLockFlag(en('PxRigidDynamicLockFlagEnum', f), true);
  body.setLinearDamping(0); body.setSleepThreshold?.(0);
  scene.addActor(body);

  let walls = [], period = 0, wallInfo = null, press = 0, pressT = 0;      // press: the side (-1 left, 1 right) a stone was touched on in the last 0.05 s
  const HOLD = 0.006;                                                      // m/s into a stone while against it
  const st = {x: 0, z: 0, vx: 0, vz: 0};
  function read() { const t = body.getGlobalPose(), p = t.get_p(); st.x = p.get_x(); st.z = p.get_z(); const v = body.getLinearVelocity(); st.vx = v.get_x(); st.vz = v.get_z(); }
  function place(x, z, vx = st.vx, vz = st.vz) {  body.setGlobalPose(setPose(x, BODY.y, z), true); body.setLinearVelocity(setV(vx, 0, vz), true); st.x = x; st.z = z; st.vx = vx; st.vz = vz; }

  // Walls. edgeL[i] / edgeR[i]: distance from the path's middle to the first stone on that side, at step i of `n` along one tile
  // of length `len`. Each side becomes a chain of capsules lying in the ground plane, with their surfaces on the chain.
  // The chain is first reduced to its real corners (points within `straight` of a straight run are dropped), so a straight run
  // is one capsule. This is tidiness, not a fix: with the inertia set right, a chain of short pieces measured the same
  // (speed after a ramp 9.39 of 10 either way). The chain is repeated for the tile before and the tile after.
  const WALL_R = 0.3, STRAIGHT = straight;
  function corners(edge, dz) {                                 // Douglas-Peucker over one tile, end points kept so tiles join
    const n = edge.length, P = []; for (let i = 0; i <= n; i++) P.push([edge[i % n], (i + .5) * dz]);
    const keep = new Uint8Array(n + 1); keep[0] = keep[n] = 1;
    const cut = (a, b) => { let worst = 0, at = -1; const [xa, za] = P[a], [xb, zb] = P[b], L = Math.hypot(xb - xa, zb - za);
      for (let i = a + 1; i < b; i++) { const d = Math.abs((P[i][0] - xa) * (zb - za) - (P[i][1] - za) * (xb - xa)) / L; if (d > worst) { worst = d; at = i; } }
      if (worst > STRAIGHT) { keep[at] = 1; cut(a, at); cut(at, b); } };
    cut(0, n); return P.filter((_, i) => keep[i]);
  }
  function setWalls(edgeL, edgeR, len) {
    for (const w of walls) { scene.removeActor(w); w.release(); } walls = [];
    const n = edgeL.length, dz = len / n; period = len; let made = 0;
    for (const [edge, side] of [[edgeL, -1], [edgeR, 1]]) { const P = corners(edge, dz);
      for (let k = -1; k <= 1; k++) for (let i = 0; i + 1 < P.length; i++) {
        const x0 = side * (P[i][0] + WALL_R), x1 = side * (P[i + 1][0] + WALL_R), z0 = P[i][1] + k * len, z1 = P[i + 1][1] + k * len;
        const dx = x1 - x0, L = Math.hypot(dx, z1 - z0), phi = Math.atan2(-(z1 - z0), dx);      // turn about y taking the capsule's axis (x) onto the piece
        const actor = physics.createRigidStatic(setPose((x0 + x1) / 2, BODY.y, (z0 + z1) / 2, Math.sin(phi / 2), Math.cos(phi / 2)));
        const geo = new PX.PxCapsuleGeometry(WALL_R, L / 2), sh = physics.createShape(geo, matWall, true, flags);
        sh.setSimulationFilterData(filter); sh.setContactOffset(MARGIN); sh.setRestOffset(0); actor.attachShape(sh); scene.addActor(actor); walls.push(actor); made++;
      } }
    wallInfo = {capsules: made, period: len, minL: Math.min(...edgeL), minR: Math.min(...edgeR)};
    return wallInfo;
  }

  // One frame of `dt` seconds, cut into equal substeps. cmd.long(v, h): the game's forward-speed rule over h seconds;
  // cmd.vt: sideways speed wanted; cmd.rate: how fast sideways speed follows it (1/s); cmd.x, cmd.u: where the game says the
  // bike is (a difference means a teleport: test hooks, start, an edge correction), cmd.vx, cmd.vz: its speed in that case.
  // Returns where the body ended up, the distance ridden (`moved`, unwrapped), and what contacts did: `lost` is the velocity
  // the stones took away during this frame (m/s, summed over its substeps: one hit is spread over two or three of them, so
  // this, not the largest single substep `blocked`, is the size of a hit), `side` which side the stone was on (-1 left,
  // 1 right, 0 none), `press` the side a stone is being touched on now.
  const res = {x: 0, u: 0, vx: 0, vz: 0, moved: 0, blocked: 0, lost: 0, side: 0, steps: 0, press: 0};
  function step(dt, cmd) {
    if (!period || !(dt > 0)) return null;
    let du = cmd.u - st.z; du -= Math.round(du / period) * period;
    if (Math.abs(cmd.x - st.x) > 0.02 || Math.abs(du) > 0.05) place(cmd.x, ((cmd.u % period) + period) % period, cmd.vx, cmd.vz);
    const n = Math.max(1, Math.ceil(dt / SUB - 1e-6)), h = dt / n, k = 1 - Math.exp(-h * cmd.rate);
    let moved = 0, blocked = 0, side = 0, lostSum = 0;
    for (let i = 0; i < n; i++) {
      const vz = cmd.long(st.vz, h), z0 = st.z;
      let vx = st.vx + (cmd.vt - st.vx) * k;
      // Against a stone, steering does not keep driving into it (that made every glancing stone a brake); the bike is only
      // held lightly against it, so it follows the stone's face and keeps its speed.
      if (press && (vx - st.vx) * press > 0) vx = st.vx + press * HOLD;
      body.setLinearVelocity(setV(vx, 0, vz), true);
      scene.simulate(h); scene.fetchResults(true);
      read();
      moved += st.z - z0;
      const lost = Math.hypot(st.vx - vx, st.vz - vz);
      if (lost > 1e-3) { press = Math.sign(vx - st.vx) || press; pressT = 0.05; } else if ((pressT -= h) <= 0) press = 0;
      if (lost > 0.03) lostSum += lost;                       // a real push from a stone (holding against one costs under 0.01)
      if (lost > blocked) { blocked = lost; side = lost > 1e-3 ? Math.sign(vx - st.vx) : 0; }
      if (st.z >= period || st.z < 0) place(st.x, ((st.z % period) + period) % period);
    }
    res.x = st.x; res.u = st.z; res.vx = st.vx; res.vz = st.vz; res.moved = moved; res.blocked = blocked; res.lost = lostSum; res.side = side; res.steps = n; res.press = press;
    return res;
  }
  // Obstacles that come and go: the roadside props near the bike, as circles on the ground. list: [{x, u, r}] with u along
  // the path in the same unwrapped metres as cmd.u; bodyU: the bike's own cmd.u. Each is made three times, a tile apart, as
  // the walls are, so the bike's carry-back at the end of a tile cannot step past one. Rebuilt only when the list changes.
  let obstacles = [], obsKey = '';
  function setObstacles(list, bodyU) {
    if (!period) return 0; const base = Math.floor(bodyU / period) * period;
    const key = base.toFixed(2) + '|' + list.map(o => o.x.toFixed(2) + ',' + o.u.toFixed(2) + ',' + o.r.toFixed(2)).join(';');
    if (key === obsKey) return obstacles.length; obsKey = key;
    for (const a of obstacles) { scene.removeActor(a); a.release(); } obstacles = [];
    for (const o of list) for (let k = -1; k <= 1; k++) {
      const actor = physics.createRigidStatic(setPose(o.x, BODY.y, o.u - base + k * period)), geo = new PX.PxSphereGeometry(o.r), sh = physics.createShape(geo, matWall, true, flags);
      sh.setSimulationFilterData(filter); sh.setContactOffset(MARGIN); sh.setRestOffset(0); actor.attachShape(sh); scene.addActor(actor); obstacles.push(actor); }
    return obstacles.length;
  }
  // the game changes the bike's speed after a hit through this (the body keeps its place)
  function setSpeed(vx, vz) { body.setLinearVelocity(setV(vx, 0, vz), true); st.vx = vx; st.vz = vz; }
  return {PX, version, setWalls, setObstacles, get obstacles() { return obstacles.length; }, place, step, setSpeed, state: st, get wallInfo() { return wallInfo; }, get ready() { return period > 0; }};
}
