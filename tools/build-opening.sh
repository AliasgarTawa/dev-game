#!/bin/sh
# Rebuild opening/ (the "Dune Rush" title screen) from the GitHub repo without touching this working tree's index.html.
# Start Race opens the splat desert ride, and the opening shows the fixed bike and rigged mascot (tools/opening_patch.py).
# Needs Node 20+ (Vite 8). Usage: sh tools/build-opening.sh [git-ref=origin/main]
set -e
REF=${1:-origin/main}
ROOT=$(cd "$(dirname "$0")/.." && pwd)
SRC=$(mktemp -d)
cd "$ROOT" && git fetch origin
git archive "$REF" index.html src public package.json package-lock.json vite.config.js | tar -x -C "$SRC"
cd "$SRC"
python3 "$ROOT/tools/opening_patch.py"
npm ci --no-audit --no-fund
# Same public URLs as upstream, but derived from the fixed dev-game assets (originals untouched).
node_modules/.bin/gltf-transform optimize "$ROOT/assets/models/desert-bike/desert-bike-game.glb" public/models/desert-bike.glb \
  --compress meshopt --texture-compress webp --texture-size 2048 --simplify false
node_modules/.bin/gltf-transform optimize "$ROOT/assets/models/mascot/rider-rigged.glb" public/models/rider.glb \
  --compress meshopt --texture-compress webp --texture-size 2048 --simplify false
ls -la public/models
npx vite build --base=/dev-game/opening/ --outDir "$ROOT/opening" --emptyOutDir
echo "Built $ROOT/opening from $REF ($(git -C "$ROOT" rev-parse --short "$REF"))"
