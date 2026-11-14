#!/bin/bash
# review.sh <file.blend|.glb> <out_prefix> "<views dict for render_views.py>" [size]
# Renders orthographic review views, overlays a 0.1 m grid (yellow every 0.5 m, red through the view centre),
# and writes <out_prefix>_sheet.png. Needs Blender and ImageMagick.
set -e
here="$(cd "$(dirname "$0")" && pwd)"
src="$1"; out="$2"; views="$3"; size="${4:-600}"
/Applications/Blender.app/Contents/MacOS/Blender -b --python "$here/render_views.py" -- "$src" "$out" "$views" "$size" > "$out.log" 2>&1
names=$(python3 -c "import sys; d=eval(sys.argv[1]); print(' '.join(f'{k}:{v[2]}' for k,v in d.items()))" "$views")
files=()
for nv in $names; do
  n="${nv%%:*}"; s="${nv##*:}"
  python3 - "$size" "$s" > "$out.mvg" <<'PY'
import sys
W=int(sys.argv[1]); s=float(sys.argv[2]); st=0.1/s*W
for i in range(-60,61):
    p=W/2+i*st
    if p<0 or p>W: continue
    c='rgba(255,0,0,0.8)' if i==0 else ('rgba(255,255,0,0.55)' if i%5==0 else 'rgba(255,255,255,0.22)')
    print(f"stroke '{c}' line {p:.1f},0 {p:.1f},{W}  line 0,{p:.1f} {W},{p:.1f}")
PY
  magick "${out}_${n}.png" -draw "@$out.mvg" -fill white -pointsize 16 -annotate +6+20 "$n" "${out}_${n}_g.png"
  files+=("${out}_${n}_g.png")
done
montage "${files[@]}" -tile "${#files[@]}x1" -geometry "${size}x${size}+2+2" "${out}_sheet.png"
echo "${out}_sheet.png"
