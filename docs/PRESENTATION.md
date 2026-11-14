# Dune Rush: three worlds you can ride through

A browser game prototype. You ride a dirt bike, seen from the rider's eyes, down an endless road. While riding you can switch between three worlds, and the scenery, the bike, the music and the bike's sound all change together.

Status on 2026-11-14: working prototype on one Mac, served locally. Not deployed.

---

## 1. What you see in the demo

1. **Opening screen** ("Dune Rush"): one button, Start Race.
2. **The ride** starts straight away in the **root passage (day)**.
3. **Three worlds**, picked from picture cards at the top left:
   - Desert road
   - Root passage (day)
   - Glowing night
4. **Switching** happens while you ride: the new world "rains in" from the top down, and the bike dissolves into the next bike with the same rain pattern.
5. **Rider's-eye view**: handlebars, tank and the mascot's orange arms with paws on the grips. Steering turns the bars and the arms follow.
6. **Sound**: music, ambience, engine and tyres, different in each world. A speaker button turns it on and off.

Controls: Space starts and pauses riding, W / S go forward and back, A / D steer, drag to look around.

How to open it (on this Mac):

- Opening screen: http://localhost:17012/worlds-opening/
- Straight into the ride: http://localhost:17012/fantasy.html

---

## 2. The worlds are Gaussian splats, not polygon levels

Each world is a **3D Gaussian splat**: a few hundred thousand to a few million small coloured blobs that together look like a photo you can move through. The splats were trained from video frames, then cut into a short **tile** that repeats.

| World | Tile length | Splats per tile | Copies drawn | File |
| --- | --- | --- | --- | --- |
| Desert road | 40 m | 1,564,494 | 3 | 106 MB |
| Root passage (day) | 11.9 m | about 0.6 million | 4 | 41 MB |
| Glowing night | 11.9 m | 634,062 | 4 | 43 MB |

The day and night root passages are two looks of the same place, so they share one shape and one tile length.

**Endless road.** The game draws a few copies of the tile in a row and moves the rearmost copy to the front as you ride. The camera never jumps, so there is no flash at the seam.

**One coordinate frame.** The root passage was trained in its own units. It was scaled, rotated and moved into the desert's frame once, offline, so that in all three worlds the road is 1.6 m below the rider's eyes and runs in the same direction. That is what lets a switch happen in place.

Renderer: three.js (r180) with the Spark splat renderer, in a single HTML page.

---

## 3. The world switch ("rainfall reveal")

- A small shader runs on every splat. It reads one number, the switch progress from 0 to 1.
- Each splat gets its own start time from three things: how high it is (high first), which 15 cm column it stands in (random per column), and a little random jitter.
- The outgoing world fades out with that timing while the incoming one fades in, with a brief cyan flash on arriving splats.
- Both worlds are drawn during the switch, and you keep riding. The default switch takes 1 second.
- The sky dome fades in or out early, since the root passage is a tunnel.

---

## 4. The bikes and the rig

**Source models.** Two generated bikes (about 31,000 triangles each): a desert bike, and a woodland bike that has a day skin and a glowing night skin on the same shape. Each arrived as one fused mesh with no moving parts.

**Rigging, done with a Blender script** (`runs/desert-2026-11-14/worlds/rig_bike.py`, headless Blender 5.2):

- Splits each bike into three parts: **body**, **front end** (fork, handlebars, hand guards, fender, headlight) and **front wheel**.
- The front end pivots on the steering axis; the wheel pivots on its axle.
- Because the mesh is fused, the split is made by position, with rules measured on each bike (for example, the woodland bike's tank starts 0.3 m behind the fork line, so the cut sits at 0.2 m).
- Straightens the woodland bike's handlebar, which was skewed by 0.40 m per metre in the generated model.
- Shrinks textures to 2K WebP: about 4 MB per bike instead of 26 to 37 MB.

| Bike | Body | Front end | Front wheel | Wheel radius |
| --- | --- | --- | --- | --- |
| Desert | 21,829 triangles | 5,691 | 4,758 | 0.27 m |
| Woodland | 20,090 triangles | 7,167 | 4,045 | 0.31 m |

**In the game** (`fantasy-rider.js`):

- A / D turn the front end up to 14 degrees about the steering axis.
- The front wheel rolls at the riding speed (rolling without slipping).
- The bike is drawn in its own pass on top of the splats, with its own lights that change per world (warm desert sun, soft forest light, cool night light).
- On a world switch the bike uses the same rain timing as the scenery: desert bike and woodland bike dissolve into each other; day and night sweep the skin across the one woodland bike, and the night skin's cyan runes glow.

---

## 5. The mascot's arms

- Only the arms of the rigged mascot are drawn; the body and head are left out, because the camera sits where the head is.
- The forearm and paw sit on the grip exactly as the model was posed, so the paw wraps the grip.
- When the bars turn, each paw and forearm turn with their grip; the upper arm runs from the elbow down out of the bottom of the view.
- The grips are in different places on the two bikes. The woodland bike's grip positions are measured from its handlebar at load, and the arms move across during a switch.

---

## 6. Sound

15 audio files from the opening screen's sound set, mixed with the Web Audio API (`fantasy-audio.js`).

| World | Music | Ambience | Tyres | Engine |
| --- | --- | --- | --- | --- |
| Desert road | desert track | none | sand | bright, highest pitch |
| Root passage (day) | woodland day track | forest day | mostly moss | softer, lower pitch |
| Glowing night | glowing night track | forest night | moss | deep and muffled |

- Engine: idle, cruise and load loops, mixed by speed and throttle; wind grows with speed.
- On a switch the old music leaves before the new one arrives, the bike sound crossfades, and a short transition cue plays.
- Sound starts from the Start Race click, as browsers require a click before audio.

---

## 7. Screen layout

- **World cards**: one picture per world. The pictures are plain image files (`runs/splat-browser-demo/worlds-ui/`) named in `fantasy-worlds.json`, so they can be swapped without touching code.
- **Round buttons**: ride / pause, sound on / off, back to the menu.
- **Starting world** is one setting: `default_world` in `fantasy-worlds.json`.

---

## 8. How it was checked

Everything below was checked from rendered frames of the running game, not only from code:

- Each world settled, straight and steering left and right, and looking down.
- Frames taken halfway through each of the six possible switches.
- Nine and ten switches in a row while riding, including across tile seams: no crash and no console errors.
- Sound: all 15 files loaded and the mixer levels were read in each world; they match the table in section 6.
- From the opening screen: Start Race lands in the root passage within one second, riding, with sound running.

Review images are in `runs/desert-2026-11-14/worlds/review/`.

---

## 9. Known limits

- **Sound was measured, not listened to.** The levels are right; the balance still needs a human ear.
- **Graphics memory is near the limit.** Three full-precision desert copies work; four lost the WebGL context on this Mac.
- **Only the front of the bike is rigged.** The rear wheel is out of view and does not turn. The front wheel is hidden behind the headlight in this view.
- **The cuts in the bike are open**, drawn double-sided to hide them. At full steering lock, looking straight down, the woodland tank's front corners look slightly ragged.
- **The desert bike's handlebar** is a little higher on the right in the generated model.
- **Arms**: looking down more than about 20 degrees shows where the upper arms end.
- **Movement is on rails**: forward and back along the road and a little sideways. No physics or collisions.
- **Not deployable yet**: the splat files (about 190 MB for the three tiles) and the page are served from one local folder.
- The menu still shows the full mascot on the bike; in the ride only the arms are shown.

---

## 10. Where things are

| What | Where |
| --- | --- |
| Game page | `runs/splat-browser-demo/fantasy.html` |
| Bike, arms and switch effect on the bike | `runs/splat-browser-demo/fantasy-rider.js` |
| Sound | `runs/splat-browser-demo/fantasy-audio.js` |
| Worlds, starting world, card pictures | `runs/splat-browser-demo/fantasy-worlds.json` |
| Rigged bikes and mascot | `runs/splat-browser-demo/worlds-models/` |
| Opening screen | `runs/splat-browser-demo/worlds-opening/` |
| Blender rig script | `runs/desert-2026-11-14/worlds/rig_bike.py` |
| Script that put the root passage in the desert's frame | `runs/desert-2026-11-14/worlds/bake_roots_worlds.py` |
| Full working notes | `runs/desert-2026-11-14/results.md` |

---

## 11. Possible next steps

1. Listen to the sound mix and tune levels.
2. Rig the rear wheel and add a third-person camera option.
3. Cap the cut openings in Blender and even out the desert handlebar.
4. Compress the splat tiles and host the game so it runs from a link.
5. Add gameplay: speed, obstacles or a goal, since movement is currently free riding.
