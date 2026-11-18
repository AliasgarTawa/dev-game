# Dune Rush: one track, five worlds you can switch while riding

A browser game prototype. You ride a dirt bike, seen from the rider's eyes, round a 1.4 km circuit through a root passage. While riding you can switch between five looks of that passage (day, glowing night, frozen, neon, painted), and the scenery, the bike, the music and the bike's sound all change together.

Status on 2026-11-15: working prototype. It runs from a local folder with `python3 serve.py`; download it from the [latest release](https://github.com/AliasgarTawa/dev-game/releases/latest). Not hosted online.

---

## 1. What you see in the demo

1. A short **loading screen** with the passage's picture.
2. **Opening** ("Dune Rush"): the title over the live track. The view glides toward the finish gate with no bike drawn, and the world changes every nine seconds, rolling in from the far end (root passage, glowing night, frozen, neon, painted), each with its own accent colour, name and line, and its music and ambience once the page has had a click or key. Five picture cards or the arrow keys pick a world; **Ride** (or Enter) puts you on the start line in the world showing. The bike waits until you hold W. The home button in the ride comes back here. **Lap times** sit under the track map: the running lap, the last lap and the best on record (kept in the browser), with a banner at the line.
3. **Five worlds**, picked from picture cards at the top left, all looks of the same passage:
   - Root passage (day)
   - Glowing night
   - Frozen passage
   - Neon passage
   - Painted passage
4. **Switching** happens while you ride: the new world rolls in from the far end of the passage one tile at a time, and the bike's skin changes as the change reaches you.
5. **Rider's-eye view**: handlebars, tank and the mascot's orange arms with paws on the grips.
6. **Riding**: a five-gear bike that reaches 100 km/h, with brakes and lean steering. Turns have to be braked for: too fast and the bike runs wide and slides; into the stones and it is knocked aside and slowed.
7. **Sound**: music, ambience, engine and tyres, different in each world. A speaker button turns it on and off.
8. **Map**: a small map of the circuit with an arrow for the rider, the lap number and the distance into the lap.

Controls: hold W to ride (let go and the bike slows to a stop), S brake (then reverse), A / D lean, Space cruise control, drag to look around. Gears change on their own. The small readout at the bottom left ends in "PhysX" when the physics engine is running.

How to open it: run `python3 serve.py` in the game folder, then

- The game, opening first: http://127.0.0.1:17012/ (`fantasy.html` is the same page)
- Straight into the ride, no opening: http://127.0.0.1:17012/?open=0
- The old desert menu address, `/worlds-opening/`, forwards to the root (the menu itself is kept as `worlds-opening/index.desert.html`).

A sixth world, the desert road, is built and set aside (`worlds_disabled` in `fantasy-worlds.json`); moving its entry back brings it back, with its own bike and music.

---

## 2. The worlds are Gaussian splats, not polygon levels

Each world is a **3D Gaussian splat**: several hundred thousand small coloured blobs that together look like a photo you can move through. The splats were trained from video frames, then cut into a short **tile** that repeats.

| World | Tile length | Splats per tile | Copies in a row | File |
| --- | --- | --- | --- | --- |
| Root passage (day) | 11.9 m | 463,444 (lightened from 605,277) | 7 | 30 MB |
| Glowing night | 11.9 m | 584,107 (lightened from 634,062) | 7 | 38 MB |
| Frozen passage | 11.9 m | 592,352 (from 648,664) | 7 | 38 MB |
| Neon passage | 11.9 m | 585,095 (from 636,108) | 7 | 38 MB |
| Painted passage | 11.9 m | 575,475 (from 633,244) | 7 | 37 MB |
| Desert road (set aside) | 40 m | 1,564,494 | 3 | 106 MB |

All five are looks of the same place, so they share one shape, one tile length, one set of stones and one circuit. The four after day were each made from 32 restyled views of the day world (one Atlas Chisel request per look) and a one-minute fit that starts from the day splat, which is why they line up exactly (working notes, not in this repository).

**Endless road.** Each world's splats are downloaded once, at the start; nothing is fetched while riding. The game keeps seven copies of the tile in a row (one behind the rider, six ahead, about 70 m of track) and moves the rearmost copy to the far end as you ride. The camera never jumps, so there is no flash at the seam. With four copies the far end was 24 to 36 m away and each piece could be seen arriving; with seven it arrives at a distant vanishing point. The copies share one set of splat data, and the drawn-splat budget is unchanged, so the cost is small: about 10% of the frame rate in the test pane.

**Curves from straight footage.** The tiles were filmed straight. A small shader step moves every splat onto a curved track and turns it to match, and the camera rides along the same curve. The track is a repeating list in `fantasy-worlds.json` (now a closed 1,396 m circuit of ten wide turns, radius 50 to 60 m to the right and 70 to 85 m to the left, each entered and left through a 15 m easing arc of twice the radius, with a 175 m home straight; a small solver adjusts the straights and the turn angles so the end meets the start). No new video was needed. The limit is the outer wall of a curve: it is seen more face-on than it was ever filmed. Right-hand turns hold down to a 35 m radius; left-hand turns need 55 m or more, because at 35 to 40 m the canopy opens over the right-hand wall.

**One coordinate frame.** All worlds were put into one frame offline, so the road is 1.6 m below the rider's eyes and runs in the same direction everywhere. That is what lets a switch happen in place.

Renderer: three.js (r180) with the Spark splat renderer, in a single HTML page.

---

## 3. The world switch (roll-in)

- The new world takes the passage one tile copy at a time, starting with the furthest (about 60 m ahead) and coming towards the rider, one step every 0.38 s.
- Each new copy stays invisible until the renderer has picked its detail, fades in over the old copy, and the old copy then goes. At most a few copies are doubled at any moment, so the frame rate holds during a switch.
- The sky, background colour, light and sound ease from one world to the other as the change comes nearer; the bike changes as it reaches the rider. You keep riding. It takes about 2 seconds riding and 3 standing.
- The earlier switch, a "rainfall reveal" in which a shader faded every splat of both worlds by height and column over one second, is still there with `?switch=rain`. It drew both worlds whole and halved the frame rate for that second.

---

## 4. Speed: what actually costs time

Measured on an Apple M3 MacBook (1440 x 900 window), by timing finished frames at a fixed spot:

| Setup | Time per frame |
| --- | --- |
| Four tile copies, every splat drawn (2.4 million) | 28 to 29 ms |
| Two copies | 18 ms |
| One copy | 10 ms |
| No scenery (bike, arms and overhead only) | 3 ms |
| Four copies with a 1.2 million splat budget | 17 ms |
| Four copies with a 0.8 million splat budget | 13 ms |

- **Frame time follows the number of splats drawn**, about 12 ms per million. Screen resolution matters much less: drawing six times fewer pixels only took a frame from 34 ms to 25 ms.
- So the game uses the renderer's **level of detail**: each tile is loaded with a detail tree (built at load, 1 to 2 seconds per world), and the renderer draws at most 1.0 million splats, coarser far away. Side by side at four spots, a 1.2 million budget looked nearly the same as drawing everything.
- **Lighter tiles.** A fifth of the day tile's splats were almost fully transparent (opacity under 5%), and both tiles carried splats more than 6.5 m to the side or 6.6 m up, outside what the rider sees. Dropping those took the day tile from 605,277 to 463,444 splats and the night tile from 634,062 to 584,107, with no visible difference in seven side-by-side frames (`?light=0` rides on the originals).
- **Fewer splats at speed.** The splat budget falls with speed, to 65% at 100 km/h, where detail cannot be seen anyway.
- Quality levels are set for frame rate first: 1.0M splats at 1.25x resolution, 1.0M at 1x, and 0.85M at 1x (lower looked like mush). The game steps to a faster level when the frame rate stays under 92% of the display's rate (55 on a 60 Hz screen), tries a sharper one only at 95%, and remembers the level in the browser. `?sharp=1` brings back the older, sharper levels (up to 1.2M at 1.5x).
- **Picture punch, at no drawing cost.** Each world's saturation and contrast are raised on every splat's own colour inside the splat shader (no extra pass), and the blur added to each splat before drawing is 0.18 instead of 0.30, which makes edges measurably crisper (16% stronger at 0.12) for a little more grain. A small readout at the bottom left shows the frame rate, the budget and the resolution in use.
- The budget is focused on the view: full detail inside a 70 degree cone, much less to the sides and behind.
- **Detail keeps up with the rider.** In the renderer's default mode, picking which detail to show took 0.8 to 1.5 seconds, so while riding the view showed detail chosen 10 m back and only sharpened when the bike stopped. In its incremental mode a pick takes about 0.25 seconds, and the viewpoint it works from is moved ahead of the rider by that much travel. Picks are limited to one every 0.6 seconds, because running them back to back cost frame rate. Moving frames went from about a third of the sharpness of stopped frames to between a half and three quarters, depending on the pick rate.
- While riding in the built-in browser, frames sat right at the edge of 60 per second (alternating 17 and 33 ms at 0.85M), so small savings matter.
- The game draws at 1x resolution instead of the display's 2x.

These timings were taken in the Claude app's built-in browser. They show what is expensive; the frame rate in Chrome was not measured.

---

## 5. The bikes and the rig

**Source models.** Generated vehicles of about 31,000 triangles each. In the game: a woodland bike with a day skin and a glowing night skin on the same shape, a snowmobile (Frozen passage), a neon street bike (Neon passage) and a vintage bike with a basket (Painted passage). A desert bike is set aside with its world. Each arrived as one fused mesh with no moving parts.

**Rigging, done with a Blender script** (headless Blender 5.2; the script is in the working notes, not in this repository):

- Splits each bike into three parts: **body**, **front end** (fork, handlebars, hand guards, fender, headlight) and **front wheel**.
- The front end pivots on the steering axis; the wheel pivots on its axle.
- Because the mesh is fused, the split is made by position, with rules measured on each bike (for example, the woodland bike's tank starts 0.3 m behind the fork line, so the cut sits at 0.2 m).
- Straightens the woodland bike's handlebar, which was skewed by 0.40 m per metre in the generated model.
- Shrinks textures to 2K WebP: about 4 MB per bike instead of 26 to 37 MB.

**In the game** (`fantasy-rider.js`):

- The bars, fork and wheel turn with the lean, up to 14 degrees about the steering axis.
- The front wheel rolls at the riding speed.
- The bike is drawn in its own pass on top of the splats, with lights that change per world.
- On a switch, the skin sweeps across the bike as the change reaches the rider, and the night skin's cyan runes glow. Between worlds with different vehicles, one dissolves out and the other in with that same sweep.
- Each newer vehicle is scaled so its grips sit where the woodland bike's do, which is where the rider's arms reach. The snowmobile has no front wheel. Its windshield is not drawn: it sat on the vanishing point and hid the way ahead in a tall window, so the body is cut off level just below it. On narrow handlebars (the vintage bike) the rider's elbows point outwards, so the arms leave by the bottom corners instead of rising through the middle of the view.

**The mascot's arms.** Only the arms of the rigged mascot are drawn. The forearm and paw sit on the grip exactly as the model was posed and turn with the bar; the upper arm runs down out of view.

---

### Roadside props

Each world has ten props of its own beside the path (a tower, a building, a monument, a finish gate, three medium and three small ones): 50 generated models in all, cut down from 1.7 GB to 14 MB for the game. The ten fill the same ten roles in every world, and a placement names a role, so a world switch swaps like for like in place, with the same top-to-bottom rain sweep as the scenery (`fantasy-props.js`, `worlds-props/layout.json`; `?props=0` turns them off).

- They stand in the gaps between the standing stones, one every 18 m, because the passage's walls are solid: anything set back from the road is hidden by roots. That also sets their size: towers about 2.5 m, not the 5 m they were designed for.
- The finish gate stands 18 m past the start line and is about 5 m tall. The road is funnelled to within 0.8 m of the middle as the bike approaches it, so the gate does not have to span the whole road.
- They cost nothing measurable in frame rate (57 to 59 fps with, 55 to 56 without, same ride).
- **Rocks on the road:** each world also has a low rock of its own, always leaving one side of the road clear. Riding over one is a jolt, not a crash: about 3 cm of lift, the nose up 1.5 degrees, 2.5% of the speed gone and a thud, once per crossing however fast the bike or slow the frame. They are drawn at twice their made size (1.2 m wide, 0.3 m high) so they can be seen beyond the handlebars. Five round the lap.

## 6. Riding physics

Two layers: the rider's controls (`ridePhysics` in `fantasy.html`) and a physics engine that moves the bike's body and handles the stones (`fantasy-physx.js`).

| Behaviour | Value |
| --- | --- |
| Top speed | 100 km/h (a limiter; `?top=` sets it lower) |
| Acceleration | 0 to 50 km/h in 2.2 s, 0 to 100 in 5.6 s (89 m) |
| Gears | five, changing up at 25, 42, 59 and 75 km/h; each change cuts the drive for 0.14 s |
| Brakes | 12 m/s²: 100 km/h to a stop in 2.3 s (32 m), then reverse up to 9 km/h |
| Letting go of W | engine braking and drag: stops from 100 km/h in 5.2 s (65 m), from 40 in about 2 s |
| Cruise control (Space, off by default) | holds 29 km/h; braking switches it off |
| Speed a turn holds with full lean | about 61 to 67 km/h in the right turns (50 to 60 m radius), 72 to 80 in the lefts |
| Lean into a curve | atan(v² / (radius × g)), up to about 29 degrees |

**Motorcycle mechanics**

- **Drive** is the smaller of what the rear tyre can push (7.5 m/s²) and engine power divided by speed, less air drag that grows with the square of speed. So the bike pulls hard low down and tails off towards 100.
- **Gears** set the revs: the engine note climbs through each gear and drops at each change, and a rev bar and gear number sit by the speed.
- **Corners have a speed.** A curve pushes the bike outward by 0.35 × v² / radius metres per second, and leaning in gives about 2 m/s, so each turn holds a speed (table above). 100 km/h is for the 175 m home straight; the shorter straights reach 70 to 85.
- **The view widens with speed** (8 degrees more at 100 km/h) and the wind gets louder.

**What happens at the boundary**

| What the rider does | What happens |
| --- | --- |
| Takes a turn too fast | The bike runs wide to the edge of the road and the tyres slide: speed drops (up to 9 m/s², less than the brakes), the drive is gone while it slides, and the tyres take 2 seconds to hook up again afterwards. The tyres are heard and a note says "Running wide". It follows the edge without touching a stone. |
| Rests on the outside of a turn, hands off | Rides along the edge. At cruise and at 50 km/h through the 190-degree hairpin: no stone touched. |
| Leans into the stones | A stone that closes in hits the bike: it is turned aside, loses speed (0.6 m/s for each m/s the stone takes), the view is pushed once away from the stone, that side of the screen flashes red, and there is a thud. At 60 km/h: about one hit a second, down to 49 km/h. |
| Hits stones hard, or arrives at a hairpin far too fast | The same as above, only harder: leaning into the stones at 100 km/h for 3 seconds gave four hits and took the bike down to 65 km/h. The bike never goes down. |

Going down in a crash was built and then switched off at the user's choice. `?crash=1` turns it on: hits adding up to 4.5 m/s within a moment (a stone face at about 85 km/h or more), or a slide of 3.4 m/s at a hairpin, put the bike down; it stops within a second and is back upright in the middle of the road after 1.6 s.

Measured on a lap from a standing start (on the current circuit): a scripted rider who brakes for each turn and leans to hold the middle takes 76 s, touches nothing, stays within 0.5 m of the middle and reaches 100 km/h on the home straight. On the earlier hairpin circuit the same rider took 88 s and holding the throttle with no steering took 102 s; the throttle-held lap has not been re-timed on the current circuit.

**The physics engine is NVIDIA PhysX 5.12**, the open-source engine, running in the browser as WebAssembly (the `physx-js-webidl` build, two files, 10 MB, in `vendor/physx/`).

- **The bike is a rigid body**: a capsule 1.84 m long and 0.84 m wide (the width of the handlebars), 180 kg. Each frame the game tells PhysX the speed the rider is asking for, PhysX resolves contacts, and the velocity that survives is the bike's motion.
- **The stones are solid walls built from the splats.** When a world loads, the game finds the first dense obstacle each side of the path every 25 cm (splats 0.3 to 1.4 m above the road). Day and night share one shape, so they vote, which drops the night world's glow specks. The result is a wall each side, 1.5 to 1.8 m from the middle, made of a few long capsules, so the bike's middle can go 1.1 to 1.4 m each side, as far as before.
- **A stone turns the bike aside, it never stops it dead.** The walls close in at no more than 0.2 m per metre ridden, so the steepest stone face is about 11 degrees to the road. Riding into one at 38 km/h pushes the bike sideways at about 2 m/s and costs about 0.5 m/s.
- **Steering eases off towards the stone beside the bike**, so the rider cannot ram one sideways. Only a stone that closes into the bike's path hits it.
- **The bike stays upright by rule.** A free two-wheeler would fall over, and the scenery only holds looking ahead, so the body cannot rotate or leave the ground. Lean, pitch and suspension are drawn, not simulated.
- **Cost**: 0.02 ms per frame, at 240 physics steps a second.
- **Fallback**: if the engine cannot load, the game rides on its built-in model, where the lane eases around the stones and nothing is hit (`?physx=0` forces this).

The rest is the rider model:

- **Lean steering**: A / D lean the bike; the lean sets a sideways speed. The view and the handlebars lean into a curve with speed.
- **View**: heads into the turn, rolls with the lean, lifts under throttle and dives under braking. A stone hit shows as a sideways swing of the view (up to 10 degrees) and a short dive.
- **Road following**: the ground height along the lane is measured from the splats when a world loads. Both worlds show the same gentle rise of about 10 cm in each tile, so it is real shape. The front and rear wheels follow it through a suspension spring; the ride height moves smoothly by a few centimetres.

Two things had to be right before the stones felt solid, each found by measuring:

1. **Rotational inertia.** With the engine's default value, 98% of a stone's push went into a spin that the upright rule then discards, so the bike took a metre to turn aside and lost 10 to 12% of its speed. This was the real cause of what first looked like the bike catching on the wall's joints.
2. **No steering into a stone.** Steering at full speed into a stone made the bike bounce off and swing back three times a second.

---

## 7. Sound

Audio files from the opening screen's sound set, mixed with the Web Audio API (`fantasy-audio.js`).

| World | Music | Ambience | Tyres | Engine |
| --- | --- | --- | --- | --- |
| Root passage (day) | woodland day track | forest day | mostly moss | softer, lower pitch |
| Glowing night | glowing night track | forest night | moss | deep and muffled |
| Frozen passage | its own track | none | packed snow | snowmobile |
| Neon passage | its own track | none | wet road | electric: nearly silent at rest, a whine with speed |
| Painted passage | its own track | none | dirt lane | vintage single |

- Engine: idle, cruise and load loops, mixed by the bike's real speed and throttle; the pitch follows the revs through the gears; wind grows with speed.
- The three newer worlds have their own music and vehicle sound: ElevenLabs takes, one picked per role by measuring loudness, steadiness and how well the ends join, then made seamless and matched in level to the older sounds.
- On a switch the old music leaves before the new one arrives, the bike sound crossfades, and a short transition cue plays.
- Browsers hold sound until the first click or key press; after that the opening plays the shown world's music and ambience, and the engine joins at Ride.

---

## 8. Loading and screen layout

- **Loading**: a cover shows the passage's picture, and the opening fades in when the first world, the bike and the arms are ready; the other four worlds load behind it. Downloads go in order (world, then bike, then sound) and are retried, because the simple local server refuses connections when about 30 downloads start at once.
- **World cards**: one picture per world, plain image files in `worlds-ui/`, named in `fantasy-worlds.json`.
- **Round buttons**: cruise control, sound on / off, back to the opening. A speed readout sits at the bottom left.
- **Map and lap times**: bottom right (top right on a narrow screen), with the running lap, the last lap and the best lap under it. The map is drawn from the same track list the scenery is bent to, so changing the track changes the map; `?map=0` hides it.
- **Starting world** is one setting: `default_world` in `fantasy-worlds.json`.

---

## 9. How it was checked

Everything below was checked on the running game, mostly from rendered frames:

- Each world settled, straight, leaning left and right, braking, and looking down.
- Level of detail on and off at the same four spots, and right after a switch.
- Physics run frame by frame at fixed time steps (60, 45 and 30 a second, same result): acceleration, top speed, coasting, braking, reverse and cruise; holding the bike into the stones on each side for 8 seconds; riding hands-off through the curve; the tile seam (no change in speed across it); a world switch while pressed against a stone; and the fallback with the engine switched off and with its file missing.
- Frames with the bike as far as it can go against the stones: six places on each side by day, three by night, and look-down views; and a frame sequence through a stone hit.
- From the opening (2026-11-15, the new one): the world cycle, picking by card and by arrow key, Ride by button and by Enter (start line, 0 km/h, bike and readouts back, engine sound in), W riding off, the home button back to the opening, and the layout at 1024 x 768, 900 x 420 and the 496 x 714 pane; no errors. Sound was read from the mixer, not listened to.
- Sound: all files loaded and the mixer levels were read while cruising, at full throttle and stopped.

Pictures and GIFs from the game are in `docs/media/`.

---

## 10. Known limits

- **Frame rate in Chrome is not measured.** The timings in section 4 are from the Claude app's built-in browser.
- **Sound was measured, not listened to.** The levels are right; the balance still needs a human ear.
- **The physics engine handles the body and the stones only.** Balance, lean, tyre grip and suspension are a rider model, not simulated. The stones are two walls, not individual rocks, and there is nothing to hit in the middle of the road.
- **The stone hit was measured and looked at in still frames, not ridden by a person.** Its feel (how hard the shove is) is one number, the wall's steepest slope.
- **Sharpness at speed.** The scenery's detail was tuned for 40 km/h. At 100 km/h most frames hold, but some go soft, and in a turn at 70 a few whole frames were soft. Asking the renderer for detail more often was tried and was worse.
- **The new sounds were run, not listened to** (hit thud, tyre slide, revs through the gears).
- **Riding hands-off through a curve**, the drift carries the bike to the outer stones, where it is nudged once per tile (view swing about 7 degrees). Leaning in avoids it.
- **Looking down at the edge of the road**, the near ground is soft in places (it was before, too).
- **Curves expose the outer wall.** In the day world a gap and a pale smear show above the left wall on the way into a right-hand curve; the night world hides it.
- **Only the front of the bike is rigged.** The rear wheel is out of view. The cuts in the bike are open and drawn double-sided.
- **Arms**: looking down more than about 20 degrees shows where the upper arms end.
- **Roadside props** are small details in a tall, narrow window (partly behind the stones, often outside the view); only the finish gate stands out there. They are solid in the physics, but they stand outside the bike's reach and the gate's funnel keeps it off the legs, so in play they are not hit. The windmill's sails and the waterwheel turn and the flags wave; nothing else on them moves.
- **The Frozen and Neon passages are recoloured fits.** Their colours were smoothed and regraded so the tunnel's shape reads; Frozen is cloudier than the fit as a result. The Painted passage's canopy is streaky close up; that is in the fit.
- **Frame rate in the Claude app's pane (496 x 714) ranged from 34 to 60 fps** over one evening with the tab in front, for reasons not found. Readings from a tab that is not in front are not valid; only before/after pairs taken together are compared here.
- **One spot in the passage** has a gap in the canopy near the top of the view; it is in the tile itself.
- **Not hosted yet**: the game needs its local server (`serve.py`); the release zip is about 400 MB.
- **Lap times** have been checked with scripted laps (1:28.04 from standing, throttle held, hands off); the best is kept per browser.

---

## 11. Where things are

| What | Where |
| --- | --- |
| Game page (opening, physics, HUD, lap times, loading, speed control) | `fantasy.html` |
| Bike, arms and switch effect on the bike | `fantasy-rider.js` |
| Sound | `fantasy-audio.js`, files in `worlds-opening/audio/worlds/` |
| Physics engine layer (body, walls, stepping) | `fantasy-physx.js` |
| Roadside props and rocks | `fantasy-props.js`, `worlds-props/` |
| PhysX browser build (MIT licence) | `vendor/physx/` |
| Worlds, starting world, card pictures, track | `fantasy-worlds.json`, `worlds-ui/` |
| Splat tiles | `fantasy-worlds-roots-<world>-tile-light.ply` |
| Rigged vehicles and mascot | `worlds-models/` |
| Local server | `serve.py` |

---

## 12. Possible next steps

1. Ride laps by hand and tune the feel (rocks, stones, the gate funnel).
2. Listen to the sound mix and tune levels; add ambience for the three newer worlds.
3. Measure the frame rate in Chrome and tune the splat budget.
4. Compress the splat tiles and host the game so it runs from a link.
