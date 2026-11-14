"""bake_roots_worlds.py: place the roots loop tiles (day + night) into the desert endless road's frame.

    uv run --with numpy python bake_roots_worlds.py

Similarity roots-native -> desert units: x_d = s R x_r + t, s = upm_d/upm_r, R maps (period dir, right, up) of the roots onto
(TA, right, up) of the desert, t puts the roots ride centre line at 4 m after the first camera (tile window start, eye height)
on desert path[0]. Tiles are written recentred (local = x_d - C) so half-precision centres stay accurate; C goes in the config.
Writes worlds/roots-{day,night}-tile-desertframe.ply, worlds/roots-to-desert.json, splat-browser-demo/fantasy-worlds.json.
"""
import json, os, sys
from pathlib import Path
import numpy as np

HERE = Path(__file__).resolve().parent
DEMO = HERE.parents[1]
D = json.load(open(DEMO / "fantasy-desert-endless.json"))
Rj = json.load(open(DEMO / "fantasy-roots-v1.json"))
TILES = {"day": DEMO / "fantasy-roots-v2b-tile8-k0.5.ply", "night": DEMO / "fantasy-roots-night-tile8-k0.5.ply"}
WIN0 = 4.0  # tile window start, m after the first camera (along the period axis)

def read_ply(p):
    with open(p, "rb") as f:
        hdr = b""
        while not hdr.endswith(b"end_header\n"): hdr += f.readline()
        body = f.read()
    h = hdr.decode(); lines = h.splitlines()
    assert "binary_little_endian" in h
    props = [l.split()[-1] for l in lines if l.startswith("property")]
    assert all(l.split()[1] == "float" for l in lines if l.startswith("property"))
    n = int([l for l in lines if l.startswith("element vertex")][0].split()[-1])
    return h, props, np.frombuffer(body, "<f4", n * len(props)).reshape(n, len(props)).copy()

def unit(v): v = np.asarray(v, float); return v / np.linalg.norm(v)
def frame(fwd, up):
    f = unit(fwd); u = unit(np.asarray(up, float) - (np.dot(up, f)) * f); r = np.cross(f, u); return f, r, u

def quat_of(R):
    w = np.sqrt(max(1e-12, 1 + np.trace(R))) / 2
    return np.array([w, (R[2, 1] - R[1, 2]) / (4 * w), (R[0, 2] - R[2, 0]) / (4 * w), (R[1, 0] - R[0, 1]) / (4 * w)])
def qmul(p, q):
    return np.stack([p[0] * q[:, 0] - p[1] * q[:, 1] - p[2] * q[:, 2] - p[3] * q[:, 3], p[0] * q[:, 1] + p[1] * q[:, 0] + p[2] * q[:, 3] - p[3] * q[:, 2],
                     p[0] * q[:, 2] - p[1] * q[:, 3] + p[2] * q[:, 0] + p[3] * q[:, 1], p[0] * q[:, 3] + p[1] * q[:, 2] - p[2] * q[:, 1] + p[3] * q[:, 0]], 1)
def qmat(q):  # (n,4) wxyz -> (n,3,3)
    q = q / np.linalg.norm(q, axis=1, keepdims=True); w, x, y, z = q.T
    return np.stack([np.stack([1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)], -1),
                     np.stack([2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)], -1),
                     np.stack([2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)], -1)], 1)

# ---------- frames
upm_d, upm_r = D["units_per_metre"], Rj["units_per_metre"]; s = upm_d / upm_r
Pd = np.array(D["path"]); TA, rd, ud = frame(D["forwards"][0], D["up"])
Pr = np.array(Rj["path"]); per_r = np.array(Rj["loop"]["period"]); fr, rr, ur = frame(per_r, Rj["up"])
assert np.dot(rd, D["rights"][0]) > 0.99 and np.dot(np.array(Rj["rights"]).mean(0), rr) > 0.99
R = np.stack([TA, rd, ud], 1) @ np.stack([fr, rr, ur], 1).T
assert abs(np.linalg.det(R) - 1) < 1e-9

# ---------- roots ride centre line: direction forced = period axis; fit lateral + vertical offset over the window
rel = Pr - Pr[0]; t_m = rel @ fr / upm_r; lat_path = rel @ rr / upm_r; ver_path = rel @ ur / upm_r
LL, LR = np.array(Rj["corridor"]["lane_left_m"]), np.array(Rj["corridor"]["lane_right_m"])
cen_lat = lat_path + (LR - LL) / 2                        # lane centre, m right of the path[0] axis line
win = (t_m >= WIN0) & (t_m <= WIN0 + 8)
off_lat = float(cen_lat[win].mean()); off_ver_path = float(ver_path[win].mean())
# vertical: the road in the roots tiles lies ~1.1 m (at upm_r) below the filmed camera, not 1.6 m (the roots scale is approximate).
# Keep metre-for-metre scale and put the ride line EYE m above the roots road instead (camera EYE-g above the filmed height,
# inside the roots loop's reviewed free-fly band). Road = per-metre mode of opaque splats within 0.5 m of the centre line.
EYE = D.get("eye_height_m", 1.6)
def road_below(p):
    _, props, dat = read_ply(p); r = dat[:, :3].astype(np.float64) - Pr[0]
    al = r @ fr / upm_r; lat = r @ rr / upm_r - off_lat; ver = r @ ur / upm_r - off_ver_path; op = 1 / (1 + np.exp(-dat[:, props.index("opacity")]))
    m = (np.abs(lat) <= 0.5) & (op > 0.5) & (ver < -0.3); modes = []
    for b in np.arange(WIN0, WIN0 + 8, 1.0):
        mm = m & (al >= b) & (al < b + 1)
        if mm.sum() > 50:
            hh, e = np.histogram(-ver[mm], bins=np.arange(0.3, 3.0, 0.05)); modes.append(e[hh.argmax()] + 0.025)
    return modes
ROAD = {k: road_below(p) for k, p in TILES.items()}
g_r = float(np.median(np.concatenate([ROAD["day"], ROAD["night"]])))
# scale the roots up so the filmed camera height IS the eye height: road EYE m below the filmed centre-line height
K = EYE / g_r; s = s * K                                     # roots-native metre m -> K*m desert metres
off_ver = off_ver_path
A_r = Pr[0] + (WIN0 * fr + off_lat * rr + off_ver * ur) * upm_r       # ride centre at the window start, eye height
tvec = Pd[0] - s * R @ A_r
def fwd(x): return s * np.asarray(x) @ R.T + tvec
C = Pd[0] + TA * 4.0 * K * upm_d                                # mid-window on the desert ride line
period_mapped = s * R @ per_r

# per-frame L/R about the straight centre line: d = path offset right of the centre line, lane spans [d - LL, d + LR]
d = lat_path - off_lat
Lc, Rc = (LL - d)[win], (LR + d)[win]
info = dict(s=s, R=R.tolist(), t=tvec.tolist(), C=C.tolist(), quat_wxyz=quat_of(R).tolist(),
            centre_line=dict(lateral_m_right_of_path0_axis=off_lat, vertical_m_above_path0=off_ver, filmed_path_mean_vertical_m=off_ver_path,
                             roots_road_below_filmed_camera_m=g_r, road_modes_by_metre=dict(day=[round(x, 3) for x in ROAD["day"]], night=[round(x, 3) for x in ROAD["night"]]),
                             scale_up_K=K, period_desert_m=8 * K, window_frames=int(win.sum()),
                             window_t_m=[float(t_m[win].min()), float(t_m[win].max())], filmed_t_end_m=float(t_m[-1]),
                             path_lateral_range_m=[float(d[win].min()), float(d[win].max())]),
            lane_about_centre=dict(left_min=float(Lc.min()), right_min=float(Rc.min()), left_med=float(np.median(Lc)), right_med=float(np.median(Rc))))

# ---------- bake
checks = {}
out = {}
for k, p in TILES.items():
    h, props, dat = read_ply(p); I = {q: i for i, q in enumerate(props)}; n = len(dat)
    X = dat[:, :3].astype(np.float64)
    tt = ((X - Pr[0]) @ fr) / upm_r
    checks[f"{k}_tile_along_m_p01_p99"] = [float(np.percentile(tt, 1)), float(np.percentile(tt, 99))]
    Y = fwd(X) - C
    q = dat[:, [I["rot_0"], I["rot_1"], I["rot_2"], I["rot_3"]]].astype(np.float64)
    qn = qmul(quat_of(R), q)
    ls = dat[:, [I["scale_0"], I["scale_1"], I["scale_2"]]].astype(np.float64) + np.log(s)
    o = dat.copy()
    o[:, :3] = Y; o[:, [I["rot_0"], I["rot_1"], I["rot_2"], I["rot_3"]]] = qn; o[:, [I["scale_0"], I["scale_1"], I["scale_2"]]] = ls
    if "nx" in I:
        N = dat[:, [I["nx"], I["ny"], I["nz"]]].astype(np.float64)
        if np.abs(N).max() > 0: o[:, [I["nx"], I["ny"], I["nz"]]] = N @ R.T
    # orientation check: Sigma' = s^2 R Sigma R^T
    rng = np.random.default_rng(0); idx = rng.choice(n, 2000, replace=False)
    def sig(qq, ll):
        M = qmat(qq); Sd = np.exp(2 * ll); return np.einsum("nij,nj,nkj->nik", M, Sd, M)
    S0 = sig(q[idx], dat[idx][:, [I["scale_0"], I["scale_1"], I["scale_2"]]].astype(np.float64))
    S1 = sig(o[idx][:, [I["rot_0"], I["rot_1"], I["rot_2"], I["rot_3"]]].astype(np.float64), o[idx][:, [I["scale_0"], I["scale_1"], I["scale_2"]]].astype(np.float64))
    S0m = s * s * np.einsum("ij,njk,lk->nil", R, S0, R)
    rel_err = np.linalg.norm(S1 - S0m, axis=(1, 2)) / np.linalg.norm(S0m, axis=(1, 2))
    checks[f"{k}_cov_rel_err_max"] = float(rel_err.max()); assert rel_err.max() < 1e-3, rel_err.max()
    dst = HERE / f"roots-{k}-tile-desertframe.ply"
    with open(dst, "wb") as f: f.write(h.encode()); f.write(o.astype("<f4").tobytes())
    # parse back
    h2, props2, back = read_ply(dst)
    assert props2 == props and len(back) == n
    same = all(np.array_equal(back[:, I[c]], dat[:, I[c]]) for c in ["f_dc_0", "f_dc_1", "f_dc_2", "opacity"])
    pos_err = float(np.abs((back[:, :3].astype(np.float64) + C) - fwd(X)).max() / upm_d)
    checks[f"{k}_readback"] = dict(splats_in=n, splats_out=len(back), colour_opacity_bit_identical=bool(same), max_pos_err_m=pos_err,
                                   local_extent_units=[float(np.abs(back[:, :3]).max())])
    out[k] = (back[:, :3].astype(np.float64) + C, 1 / (1 + np.exp(-back[:, I["opacity"]].astype(np.float64))))
    link = DEMO / f"fantasy-worlds-roots-{k}-tile.ply"
    if link.is_symlink() or link.exists(): link.unlink()
    os.symlink(os.path.relpath(dst, DEMO), link)

# ---------- checks (in desert units, measured in metres about the desert ride line through path[0] along TA)
def coords(Xd):
    r = Xd - Pd[0]; return r @ TA / upm_d, r @ rd / upm_d, r @ ud / upm_d
# (a) mapped roots centre line vs desert ride line
a = {}
for m in (0, 4, 8):                      # roots-native metres -> K*m along the desert ride
    pr = A_r + (m * fr) * upm_r; _, lat, ver = coords(fwd(pr)[None])
    pd = Pd[min(len(Pd) - 1, int(round(m * K / 0.2)))]; _, latd, verd = coords(pd[None])
    a[f"{m}m"] = dict(roots_lat_m=float(lat[0]), roots_vert_m=float(ver[0]), desert_path_lat_m=float(latd[0]), desert_path_vert_m=float(verd[0]))
checks["a_centre_line_offsets"] = a
# filmed path mapped, for reference
_, latp, verp = coords(fwd(Pr[win]))
checks["a_filmed_path_mapped_lat_range_m"] = [float(latp.min()), float(latp.max())]
checks["a_filmed_path_mapped_vert_range_m"] = [float(verp.min()), float(verp.max())]

def ground(al, lat, ver, op, a0, a1):
    m = (al >= a0) & (al < a1) & (np.abs(lat) <= 0.5) & (ver < -0.3) & (op > 0.5)
    hist, edges = np.histogram(-ver[m], bins=np.arange(0.3, 4.0, 0.05))
    i = hist.argmax(); return dict(mode_below_eye_m=float((edges[i] + edges[i + 1]) / 2), n=int(m.sum()))
_, _, dts = read_ply(DEMO / "fantasy-desert-v4-tile.ply")
dal, dlat, dver = coords(dts[:, :3].astype(np.float64)); dop = 1 / (1 + np.exp(-dts[:, 9].astype(np.float64)))
checks["b_ground_desert"] = {f"{a0}-{a0+4}m": ground(dal, dlat, dver, dop, a0, a0 + 4) for a0 in (0, 4)}
Pm = 8 * K; H = Pm / 2
for k, (Xd, op) in out.items():
    al, lat, ver = coords(Xd)
    checks[f"b_ground_roots_{k}"] = {f"{a0:.1f}-{a0+H:.1f}m": ground(al, lat, ver, op, a0, a0 + H) for a0 in (0, H)}
    # (c) walls: 5th percentile sideways distance of opaque splats 0.8-2.6 m above the ground, per 0.25 m bin, all 4 copies
    g = list(checks[f"b_ground_roots_{k}"].values())[0]["mode_below_eye_m"]
    hgt = ver + g; mk = (op > 0.3) & (hgt > 0.8) & (hgt < 2.6)
    A = np.concatenate([al[mk] + Pm * c for c in (-1, 0, 1, 2)]); S = np.tile(lat[mk], 4)
    WL, WR = [], []
    for b in np.arange(0, Pm, 0.25):
        mm = (A >= b - 0.25) & (A < b + 0.5)
        l = -S[mm & (S < 0)]; r = S[mm & (S > 0)]
        WL.append(np.percentile(l, 5) if len(l) > 20 else 3.0); WR.append(np.percentile(r, 5) if len(r) > 20 else 3.0)
    WL, WR = np.array(WL), np.array(WR)
    checks[f"c_walls_{k}"] = dict(left_min=float(WL.min()), left_med=float(np.median(WL)), left_max=float(WL.max()),
                                  right_min=float(WR.min()), right_med=float(np.median(WR)), right_max=float(WR.max()),
                                  left_m=WL.round(2).tolist(), right_m=WR.round(2).tolist())
ang = np.degrees(np.arccos(np.clip(np.dot(unit(period_mapped), TA), -1, 1)))
checks["d_period"] = dict(angle_to_TA_deg=float(ang), length_m=float(np.linalg.norm(period_mapped) / upm_d),
                          desert_period_m=float(np.linalg.norm(D["loop"]["period"]) / upm_d), desert_period_angle_to_TA_deg=float(np.degrees(np.arccos(np.clip(np.dot(unit(D["loop"]["period"]), TA), -1, 1)))))
info["checks"] = checks
print(json.dumps({k: v for k, v in checks.items() if not k.startswith("c_walls")} | {k: {kk: vv for kk, vv in v.items() if not kk.endswith("_m")} for k, v in checks.items() if k.startswith("c_walls")}, indent=1))
print(json.dumps({k: v for k, v in info.items() if k != "checks"}, indent=1))
json.dump(info, open(HERE / "roots-to-desert.json", "w"), indent=1)


# ---------- viewer config: desert endless config + "worlds"
wl = min(checks["c_walls_day"]["left_min"], checks["c_walls_night"]["left_min"]); wr = min(checks["c_walls_day"]["right_min"], checks["c_walls_night"]["right_min"])
fl = lambda x: float(np.floor(x * 20) / 20)
Lw, Rw = fl(0.5 * wl), fl(0.5 * wr)                                       # 50% of the nearest wall (roots loop rule), covers 9.5-12 m too
Lm, Rm = min(fl(Lc.min() * K), Lw), min(fl(Rc.min() * K), Rw)                     # narrowest per-frame lane over the window, capped by the wall rule
info["lane_m"] = dict(left=Lm, right=Rm, rule="narrowest per-frame corridor lane about the straight centre line over the filmed window (4-9.5 m), rounded down to 0.05 m, capped by 50% of the narrowest wall distance (day and night) for the unfilmed 9.5-12 m",
                      wall_rule_alternative=dict(left=Lw, right=Rw))

json.dump(info, open(HERE / "roots-to-desert.json", "w"), indent=1)
W = json.loads(json.dumps(D)); W["loop"]["unwrapped"] = True
rt = lambda v: [round(float(x), 10) for x in v]
roots = dict(origin=rt(C), period=rt(period_mapped), copies=[-1, 0, 1, 2], ext=False, sky=False, lane_left_m=float(Lm), lane_right_m=float(Rm), yaw_deg=15)
W["worlds"] = [
    dict(id="desert", label="Desert road", tile_ply="./fantasy-desert-v4-tile.ply", origin=[0, 0, 0], period=D["loop"]["period"], copies=[-1, 0, 1],
         ext=True, sky=True, background="#000000", lane_left_m=1.5, lane_right_m=1.5, yaw_deg=15),
    dict(id="day", label="Root passage (day)", tile_ply="./fantasy-worlds-roots-day-tile.ply", background="#3a3a30", **roots),
    dict(id="night", label="Glowing night", tile_ply="./fantasy-worlds-roots-night-tile.ply", background="#0d1a24", **roots)]
c = checks
W["worlds_basis"] = (
    "Roots tiles (roots-v2b day and night-b, tile8 k0.5) placed in the desert frame by worlds/bake_roots_worlds.py: similarity x_d = s R x_r + t, "
    f"s = (upm_d/upm_r) x {K:.4f} = {s:.6f} (roots metres assumed 4 m between the root walls, but put the road only {g_r:.3f} m below the filmed camera; scaled up by 1.6/{g_r:.3f} so the filmed camera height is the 1.6 m eye height), R maps the roots period axis, right and up "
    "(up orthogonalised) onto the desert TA, right and up (det +1), t puts the roots ride centre line at 4 m after the first filmed camera (start of the "
    "tile window) on desert path[0]. Centre line: parallel to the roots period (so copies do not drift), lateral offset = mean of the lane centre "
    f"path + rights (lane_right - lane_left)/2 over the filmed frames 4.0-9.5 m in roots units ({off_lat * K:+.2f} m right of the first camera's axis after scaling; the filmed path wanders "
    f"{c['a_filmed_path_mapped_lat_range_m'][0]:+.2f} to {c['a_filmed_path_mapped_lat_range_m'][1]:+.2f} m about it; the filmed path ends at 9.46 roots m, so the last 2.5 roots m of the window are extrapolated); "
    "height = mean filmed camera height over the window (the validated roots viewpoint). "
    "Tiles are written recentred on origin C = desert path[0] + TA x (4 roots m x K) (mid-window on the ride line, same C for day and night): put copy k at origin + k x period; "
    f"copy k covers about {8*K:.2f}k-{0.5*K:.2f} to {8*K:.2f}k+{8.5*K:.2f} m along the ride from path[0] ({K:.2f} m cross-fades at the seams). "
    f"Checks: centre line vs desert ride line 0 lateral/vertical at the window start, middle and end; mapped period {c['d_period']['length_m']:.3f} m at "
    f"{c['d_period']['angle_to_TA_deg']:.4f} deg to TA; road below the eye (mode of opaque splats within 0.5 m across): desert {c['b_ground_desert']['0-4m']['mode_below_eye_m']:.2f}/"
    f"{c['b_ground_desert']['4-8m']['mode_below_eye_m']:.2f} m, roots day {'/'.join(f"{v['mode_below_eye_m']:.2f}" for v in c['b_ground_roots_day'].values())} m, "
    f"night {'/'.join(f"{v['mode_below_eye_m']:.2f}" for v in c['b_ground_roots_night'].values())} m (desert 0-4/4-8 m along, roots each half of the period); root walls (5th percentile of opaque "
    f"splats 0.8-2.6 m above the road, all copies) left {wl:.2f} m nearest / {c['c_walls_night']['left_med']:.2f} m median, right {wr:.2f} / {c['c_walls_night']['right_med']:.2f} m (night medians; the day tile has too few opaque left-wall splats about 0.4-3.7 m into each copy to measure); "
    f"lane = narrowest per-frame corridor lane about this line (35% of the distance to the solved points) x K, {Lm:.2f} m left / {Rm:.2f} m right (50% of the nearest wall "
    f"would allow {Lw:.2f}/{Rw:.2f} m). Splat counts preserved ({c['day_readback']['splats_out']} day, {c['night_readback']['splats_out']} night), colour and opacity "
    "bit-identical, covariances match s^2 R S R^T to 1e-6.")
json.dump(W, open(DEMO / "fantasy-worlds.json", "w"))
print("lane", Lm, Rm); print(W["worlds_basis"])
