# Dune Rush

A browser bike game on 3D Gaussian splats. One short road tile, five looks of it (day, night, winter, cyberpunk, ghibli), bent into a 1,396 m circuit. You can switch world while riding. three.js r180 + Spark, plain ES modules, no build step.

## Run
- `python3 serve.py` then open http://127.0.0.1:17012/ (`--port N` for another port). `serve.py` checks that the large LFS files are real files, not pointers, and serves `fantasy.html` at `/`.
- Clone with Git LFS (`*.ply`, `*.glb`, `*.fbx` are LFS). GitHub's "Download ZIP" gives pointers, not the game.
- There is no build. Edit the files and reload. Chrome caches `/` hard: reload with the cache bypassed after editing `fantasy.html`.

## The game files
- `fantasy.html`: the whole game page (renderer, track, riding, world switch, opening, map, lap timer, HUD). Dense one-line JS: keep patches small and never put a `//` comment in the middle of a one-line statement.
- `fantasy-rider.js`: the five rigged vehicles, the mascot's arms and the switch effect on the bike.
- `fantasy-audio.js`: music, ambience, engine, tyres and switch cues per world (Web Audio). No audio nodes are created in the render loop.
- `fantasy-physx.js`: PhysX (WASM, `vendor/physx/`) for the bike against the roadside stones and the five rocks.
- `fantasy-props.js`: the 50 roadside models, ten per world.
- `fantasy-sort.js`: the splats' sort distances, worked out on a worker thread so the page never waits for the graphics card (`?cpusort=0` hands the job back to the renderer). It checks itself against the renderer's own values the first time each world is ridden and steps aside on a mismatch. It relies on internals of the vendored `vendor/spark.module.js`, so re-check it after updating that file.
- `fantasy-worlds.json`: worlds, tile files, card pictures, track, `default_world`.
- `worlds-sky/<world>.jpg`: the painted sky behind each world's splats (8192 x 1024, from the horizon to 45 degrees up; a world's `sky_image` in `fantasy-worlds.json`). `?wsky=0` shows the flat background colour instead.
- `fantasy-worlds-roots-<world>-tile-light.ply`: the five splat tiles the game loads (day, night, winter, cyberpunk, ghibli).
- `worlds-models/`: rigged vehicles and rider. `worlds-props/`: prop models plus `layout.json` (where each slot sits on the track) and `props.json`. `worlds-ui/`: world card pictures. `worlds-opening/`: a redirect to `/` and the world audio in `worlds-opening/audio/worlds/`.
- `vendor/`: three.js, Spark and PhysX builds. Licences in `THIRD_PARTY_NOTICES.md` and `vendor/licenses/`.

## How it works
- Every world is a restyle of the same root passage, so all five tiles have the same shape. That is what allows a switch in place: the new world takes the passage one tile copy at a time, from the far end towards the rider (about 2 s riding, 3 s standing), and the bike, props and sound switch with it. `?switch=rain` brings back the older rainfall reveal, which draws both worlds whole for a second. Track, physics and lap time carry on unchanged.
- Each tile is 11.907 m long, drawn 7 times and bent onto the closed circuit. Ride position is `s`; metres = `s * 0.19907`.
- The opening is the live game behind an overlay (`#open`). Ride (Enter) starts the race from the line; ← → choose the world.
- Lap times use ride time (physics steps, each clamped to 0.05 s). The crossing is interpolated inside the step. The best lap is saved in `localStorage` under `dune-best-lap-1:<lap length in m>`. A teleport voids the current lap.

## Testing hooks
- URL options: `?open=0` skips the opening, `?style=<world>` sets the starting world, `?raf=timer` keeps the loop running in a hidden or background tab, `?sound=0`, `?physx=0`, `?props=0`, `?laps=reset`, `?res=` render scale, `?lodn=` splat budget, `?switch=rain` the older world switch, `?rollms=` the roll's step (380 ms), `?sharp=1` the older, sharper quality levels (up to 1.2M splats at 1.5x; the default stops at 1.0M at 1.25x for frame rate), `?pace=auto|1|beat` frame pacing (off by default), `?idle=0` draws every frame while the bike stands still.
- In the console: `__step(n,dt)` runs fixed physics steps, `ride(fs,x)` teleports, `chooseStyle(id,animated)` switches world, `__bike` and `__px` for the bike and physics, `__laps` for lap data, `__open` for the opening, `__sound.state()` and `__sound.levels()` for the mixer, `__fps`.
- Judge changes by rendered frames at a real window size, while riding, not by code or aimed stills alone. Background tabs are throttled and can lose the WebGL context when several game tabs are open.

## Rules
- Splat tiles, models and audio are supplied or generated assets. Don't regenerate or overwrite them; add new versions next to them.
- Keep API keys out of the repo and the page. The game makes no calls to paid services at runtime.
- After changing a `fantasy-*.js` module, bump its `?v=` stamp in `fantasy.html` so browsers fetch the new copy.

## Earlier work in this repository
`index.html`, `src/`, `public/`, `package.json` and `scripts/optimize-assets.mjs` are the first desert opening menu (Vite, `npm run dev`). The game no longer uses them; its opening is built into `fantasy.html`. `docs/ROOTS-*.md` are notes from building the root passage's sound. `MESHY_API_KEY` for that menu stays in `.env` (gitignored) and must never be exposed client-side.
