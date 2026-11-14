# Dune Rush

Desert dirt-bike racing game. Vite + Three.js (vanilla JS, no framework).

## Commands
- `npm run dev` — dev server on http://localhost:3000 (port from `PORT` in `.env`)
- `npm run build` — production build to `dist/` (verify this passes after changes)
- `npm run preview` — serve the built `dist/`
- `npm run optimize:assets` — regenerate the web copies in `public/models/` and `public/opening/` from the originals in `assets/` (gltf-transform: meshopt geometry, 2048px WebP textures, no simplification; poster as WebP)

## Structure
- `index.html` — opening page markup: photo backdrop, 3D canvas, model load status, menu, audio controls, toast
- `src/main.js` — entry; boots the 3D scene, model load/error/retry status, menu and audio
- `src/scene.js` — opening 3D layer: loads the bike + mascot GLBs, mounts the mascot on the seat, matches the camera to the photo (vanishing point, focal length, eye height) and places the bike on the road from the UI layout; idle motion, Start Race launch, `onRide` audio data
- `public/opening/first-frame.webp`, `public/models/*.glb` — derived web copies (never edit the originals in `assets/`)
- `scripts/optimize-assets.mjs` — builds those derived copies
- `src/menu.js` — menu actions, keyboard nav, toast
- `src/audio.js` — shared audio context, music/effects buses, lazy loading, saved mix, Settings dialog and visibility pause
- `src/audio-effects.js` — engine crossfade/RPM, tire/wind layers, spatial panning and bounded procedural cues
- `public/audio/` — generated menu music and bike/surface loops; provenance and mix details in `AUDIO.md`
- `src/style.css` — design tokens + UI styles

## Notes
- `MESHY_API_KEY` lives in `.env` (gitignored). Never expose it client-side: Vite only exposes `VITE_`-prefixed vars, so keep the Meshy key unprefixed and call Meshy from a server/script.
- Dependencies are pinned to exact versions.
- The scene sends normalized speed, boost, throttle, roughness and pan to audio via `onRide`. Keep sound automation capped at 20 Hz; never create audio nodes in the render loop.
- Audio is static at runtime. No ElevenLabs API key belongs in the app or client bundle.

---

## Desert opening screen

When building or changing the opening/title screen, use the supplied desert frames as the visual source of truth. Read [the desert asset guide](assets/desert/README.md) before choosing images or generating more.

- Start with `assets/desert/opening/first-frame.png` for the opening background. Preserve its sandstone arch, sandy road, warm earth tones, blue sky, and natural photographic lighting.
- Use the supplied images directly where they fit. Generate additional matching frames from these image references when the screen needs more views or a longer sequence; follow the prompts and continuity checks in the asset guide.
- The 64 files in `assets/desert/reference-views/` are spatial reference views, not a chronological animation. Do not play their numeric order as a movie.
- The opening/title screen must also display the supplied **3D bike mesh** (`assets/models/desert-bike/desert-bike.glb`) and **3D mascot mesh** (`assets/models/mascot/rider.glb`). Use the actual textured GLB models, with the mascot mounted on the bike, as a 3D foreground composition over the desert background. This requirement applies to the opening screen itself, before entering gameplay.
- Preserve the existing bike design and orange, laptop-free mascot. Match their scale, perspective, and warm lighting to the desert; frame both clearly on desktop and mobile without obscuring the title or Start button. Use an over-the-shoulder composition as the starting layout and adjust for the opening-screen design.
- Keep the bike and mascot as separately loaded 3D objects and keep title/buttons in a separate UI layer. Do not substitute generated pictures or bake the models into the landscape frames. Preserve the original GLBs; any optimized copies should be derived assets.
- These GLBs contain no animation clips. Do not assume a rig or wheel animation exists; use a static pose or subtle whole-object motion unless animation is deliberately implemented. Keep any idle motion disabled for reduced-motion users.
- Preserve the originals. Save new outputs in `assets/desert/generated/` with their prompt, reference filenames, model/settings, and sequence order.
- Check image loading, responsive crops, text contrast, reduced-motion behavior, and visual continuity before shipping the opening screen.

### Implementation notes
- The backdrop `<img class="backdrop">` uses `object-fit: cover`; `src/scene.js` reads its box and `object-position` to align the 3D camera with the photo. If you change the crop or the `PHOTO` calibration constants, re-check that the tyres sit on the road at several viewport sizes.
- On stacked (portrait/narrow) layouts the photo is shifted down by `--backdrop-top` and the sky colour (`--color-sky`) fills the gap so the arch stays clear of the title.
- The bike's ground point comes from the layout: beside the menu text on wide screens, just above the buttons on stacked screens. Keep the title and buttons inside `.brand` / `.actions` so that measurement keeps working.
