"""Soft region masks for the original Meshy mascot, in its native Blender coordinates (face toward -Y, Z up, height 1.9).
Tuned by eye from gridded orthographic renders (tools/blender/render_views.py)."""
import numpy as np
def ss(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t)
def band(x, lo, hi, soft):
    return ss(lo - soft, lo + soft, x) * (1 - ss(hi - soft, hi + soft, x))
def region_weights(V):
    x, y, z = V[:, 0], V[:, 1], V[:, 2]
    W = {}
    # Original stubby arms: lumps on the upper torso sides whose paws rest on the belly.
    W['armL'] = ss(-0.04, -0.12, x) * band(z, -0.45, -0.02, 0.04) * (1 - ss(0.10, 0.22, y))
    W['armR'] = ss(0.12, 0.20, x) * band(z, -0.47, -0.01, 0.04) * (1 - ss(0.10, 0.22, y))
    # Legs: forward blobs at the bottom front.
    W['legL'] = ss(0.02, -0.06, x) * (1 - ss(-0.50, -0.42, z)) * (1 - ss(-0.12, 0.0, y))
    W['legR'] = ss(0.08, 0.16, x) * (1 - ss(-0.50, -0.42, z)) * (1 - ss(-0.12, 0.0, y))
    W['head'] = ss(-0.06, 0.06, z)
    return W

def weld_map(V, tol=1e-5):
    """glTF splits vertices at UV seams; map each vertex to a welded id so moved copies stay together."""
    key = np.round(V / tol).astype(np.int64)
    _, inv = np.unique(key, axis=0, return_inverse=True)
    return inv.ravel()

def adjacency(faces, inv, n):
    import collections
    nb = [set() for _ in range(n)]
    for f in faces:
        ids = [inv[i] for i in f]
        for a in range(len(ids)):
            b, c = ids[a], ids[(a + 1) % len(ids)]
            if b != c: nb[b].add(c); nb[c].add(b)
    return [np.fromiter(s, dtype=np.int64) for s in nb]

AXIS = np.array([0.04, 0.13])   # torso vertical axis (x, y)

def torso_radius_grid(V, exclude, z0=-0.56, z1=0.12, dz=0.03, nth=48):
    """Median torso radius per (z, angle) bin from vertices outside the masked parts; gaps filled around the circle and smoothed."""
    x, y, z = V[:, 0] - AXIS[0], V[:, 1] - AXIS[1], V[:, 2]
    th = np.arctan2(x, -y); r = np.hypot(x, y)
    zb = np.arange(z0, z1 + 1e-9, dz); R = np.full((len(zb), nth), np.nan)
    ti = ((th + np.pi) / (2 * np.pi) * nth).astype(int) % nth
    keep = exclude < 0.02
    for i, zc in enumerate(zb):
        m = keep & (np.abs(z - zc) < dz)
        for j in range(nth):
            mm = m & (ti == j)
            if mm.sum() >= 2: R[i, j] = np.median(r[mm])
    # fill gaps around the circle (periodic linear interpolation), then across z
    for i in range(len(zb)):
        row = R[i]; ok = ~np.isnan(row)
        if ok.sum() >= 3:
            idx = np.arange(nth); xp = np.concatenate([idx[ok] - nth, idx[ok], idx[ok] + nth]); fp = np.tile(row[ok], 3)
            R[i] = np.interp(idx, xp, fp)
    for j in range(nth):
        col = R[:, j]; ok = ~np.isnan(col)
        if ok.any(): R[:, j] = np.interp(np.arange(len(zb)), np.arange(len(zb))[ok], col[ok])
    # smooth: 3 passes of a small periodic box blur in angle and z
    for _ in range(6):
        R = (np.roll(R, 1, 1) + R + np.roll(R, -1, 1)) / 3
        R[1:-1] = (R[:-2] + R[1:-1] + R[2:]) / 3
    return zb, R, nth

def sample_radius(zb, R, nth, V):
    x, y, z = V[:, 0] - AXIS[0], V[:, 1] - AXIS[1], V[:, 2]
    th = np.arctan2(x, -y)
    fi = np.clip((z - zb[0]) / (zb[1] - zb[0]), 0, len(zb) - 1.001); i0 = fi.astype(int); a = fi - i0
    fj = (th + np.pi) / (2 * np.pi) * nth - 0.5; j0 = np.floor(fj).astype(int); b = fj - j0
    j0 %= nth; j1 = (j0 + 1) % nth
    r0 = R[i0, j0] * (1 - b) + R[i0, j1] * b; r1 = R[i0 + 1, j0] * (1 - b) + R[i0 + 1, j1] * b
    return r0 * (1 - a) + r1 * a, th

def flatten_into_torso(V, faces, w, exclude, iters=4000):
    """Replace masked lumps (the original stub arms) with the torso surface underneath.
    The lump vertices are re-embedded in the torso's (angle, height) parameter domain by harmonic (Tutte) relaxation with
    the surrounding torso fixed, which unfolds the old arm's triangles, then mapped back onto the fitted torso radius."""
    inv = weld_map(V); n = inv.max() + 1
    U = np.zeros((n, 3)); U[inv] = V
    wu = np.zeros(n); np.maximum.at(wu, inv, w)
    ex = np.zeros(n); np.maximum.at(ex, inv, exclude)
    zb, R, nth = torso_radius_grid(U, np.maximum(ex, wu))
    nb = adjacency(faces, inv, n)
    act = np.where(wu > 0.02)[0]
    # flattened neighbour arrays for vectorised Jacobi iterations
    src = np.concatenate([np.full(len(nb[i]), k) for k, i in enumerate(act)]); dst = np.concatenate([nb[i] for i in act])
    deg = np.bincount(src, minlength=len(act)).astype(float)
    x, y = U[:, 0] - AXIS[0], U[:, 1] - AXIS[1]
    th = np.arctan2(x, -y); P = np.stack([th * 0.45, U[:, 2]], 1)      # ~arc length so the domain is roughly isotropic
    for _ in range(iters):
        acc = np.zeros((len(act), 2)); np.add.at(acc, src, P[dst]); P[act] = acc / deg[:, None]
    th2 = P[act, 0] / 0.45; z2 = P[act, 1]
    Q = np.stack([np.sin(th2), -np.cos(th2), z2], 1)   # direction carrier for sampling
    rt, _ = sample_radius(zb, R, nth, np.stack([AXIS[0] + Q[:, 0], AXIS[1] + Q[:, 1], z2], 1))
    new = np.stack([AXIS[0] + np.sin(th2) * rt, AXIS[1] - np.cos(th2) * rt, z2], 1)
    # blend in a thin band at the patch edge so the torso joins without a step
    b = np.clip(wu[act] / 0.25, 0, 1)[:, None]
    U2 = U.copy(); U2[act] = U[act] * (1 - b) + new * b
    # final 3D relaxation (Taubin, shrink-free) over the patch grown by two rings; outer ring fixed
    grow = set(act.tolist())
    for _ in range(2): grow |= {j for i in list(grow) for j in nb[i]}
    reg = np.array(sorted(grow)); inner = np.array([i for i in reg if wu[i] > 0.0 or all(wu[j] > 0 for j in nb[i])])
    s2 = np.concatenate([np.full(len(nb[i]), k) for k, i in enumerate(inner)]); d2 = np.concatenate([nb[i] for i in inner])
    dg = np.bincount(s2, minlength=len(inner)).astype(float)[:, None]
    for it in range(60):
        acc = np.zeros((len(inner), 3)); np.add.at(acc, s2, U2[d2]); L = acc / dg - U2[inner]
        U2[inner] += L * (0.5 if it % 2 == 0 else -0.53)
    return U2[inv]
