# Desert opening screen

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

This commit supplies assets and an implementation brief. It does not implement the opening screen or include the game's 3D scene.
