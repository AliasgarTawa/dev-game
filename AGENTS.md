# Desert opening screen

When building or changing the opening/title screen, use the supplied desert frames as the visual source of truth. Read [the desert asset guide](assets/desert/README.md) before choosing images or generating more.

- Start with `assets/desert/opening/first-frame.png` for the opening background. Preserve its sandstone arch, sandy road, warm earth tones, blue sky, and natural photographic lighting.
- Use the supplied images directly where they fit. Generate additional matching frames from these image references when the screen needs more views or a longer sequence; follow the prompts and continuity checks in the asset guide.
- The 64 files in `assets/desert/reference-views/` are spatial reference views, not a chronological animation. Do not play their numeric order as a movie.
- Keep titles, buttons, riders, bikes, and other interactive elements on separate layers. Do not bake UI or characters into the landscape frames.
- Preserve the originals. Save new outputs in `assets/desert/generated/` with their prompt, reference filenames, model/settings, and sequence order.
- Check image loading, responsive crops, text contrast, reduced-motion behavior, and visual continuity before shipping the opening screen.

This commit supplies assets and an implementation brief. It does not implement the opening screen or include the game's 3D scene.
