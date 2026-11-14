"""Patches the GitHub opening app (extracted by build-opening.sh) for dev-game. Run inside the extracted source dir.
- Start Race plays the launch, then opens the Gaussian-splat desert ride.
- The bike and rider are the fixed dev-game assets, already exported together in bike-mount space, so they are only scaled."""
import re


def patch(path, old, new):
    s = open(path).read()
    assert old in s, f'{path} changed upstream; update tools/opening_patch.py'
    open(path, 'w').write(s.replace(old, new, 1))


patch('vite.config.js', ", rootsAudio: 'roots-audio.html'", '')

patch('src/main.js', '  onStart: () => scene?.boost(),',
      "  // dev-game integration: Start Race plays the launch, then opens the Gaussian-splat desert ride.\n"
      "  onStart: () => { scene?.boost(); setTimeout(() => { location.href = '/dev-game/index.html'; }, 1500); },")

s = open('src/scene.js').read()
a = s.index('function mountRider(bike, rider) {')
b = s.index('export function createScene')
s = s[:a] + '''// dev-game integration: the bike and rigged rider are exported together in bike-mount space (metres, wheels on
// y = 0, -Z forward, 1.8 m long) with the paws already on the grips. Scale both by the same factor; no refitting.
function mountRider(bike, rider) {
  const k = BIKE_LENGTH / 1.8;
  for (const model of [bike, rider]) {
    model.scale.setScalar(k);
    model.traverse((node) => {
      if (node.isMesh) { node.castShadow = true; node.frustumCulled = false; }
    });
  }
}

''' + s[b:]
# The idle sway and breathing moved the rider alone, which would pull the paws off the grips; the whole ride still sways.
s, n = re.subn(r"\n      if \(rider\) \{\n        rider\.rotation\.z = [^\n]*\n        rider\.scale\.y = [^\n]*\n      \}", '', s)
assert n == 1, 'scene.js idle animation changed upstream; update tools/opening_patch.py'
open('src/scene.js', 'w').write(s)
print('patched vite.config.js, src/main.js, src/scene.js')
