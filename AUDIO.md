# Dune Rush audio

`public/audio/dune-rush-menu.mp3` is **Sunset Run**, an instrumental menu
soundtrack generated for Dune Rush with ElevenLabs `music_v2` on 2026-11-14.

The brief requested a steady 120 BPM desert-rock/electronic groove: muted
guitar, warm analog bass, dry drums, hand percussion and spacious synth pads.
Generation used `force_instrumental: true`, with no artist references or
requested engine effects. It is mixed separately from the reactive bike audio.

## Asset

- Stereo MP3, 48 kHz, 192 kbps, approximately 1.49 MB.
- 62 seconds after editing the 64-second generation.
- Removed 24 ms of encoder lead-in, overlapped the last and first two seconds
  using complementary cosine fades, then rotated the join into the file.
- Applied 6.36 dB of linear attenuation to the original (-11.64 LUFS) for a
  background-music target near -18 LUFS.
- Final MP3 measured -18.27 LUFS integrated and -6.97 dBTP, with no clipped
  samples or silence intervals of 50 ms or longer below -50 dBFS.
- Encoded with a Xing/LAME header to preserve gapless decoding information.
- The original and 24-bit WAV loop master are retained locally in
  `~/Desktop/elevenlabs-output/`. Only the playback MP3 is shipped.

## Bike and surface assets

Three effects were generated through ElevenLabs' sound-effects tool with
`loop: true` and a five-second duration. They were requested as isolated sound
layers, without music, voices or pass-by effects:

| Asset | Requested sound | Final LUFS | True peak |
| --- | --- | --- | --- |
| `bike-cruise.wav` | Steady medium-low RPM, 250cc single-cylinder four-stroke motocross engine | -20.40 | -4.50 dBTP |
| `bike-load.wav` | The same type of bike at steady high RPM under load | -17.98 | -4.82 dBTP |
| `sand-tires.wav` | Knobby tires rolling over dry sand and fine gravel | -22.01 | -5.37 dBTP |

Each playback asset is 4.8 seconds, mono, 48 kHz, 16-bit PCM WAV and about 461 KB.
PCM avoids the extra padding WebKit added when decoding the short MP3 versions.
The source clips were trimmed by 25 ms at each edge, filtered at 65 Hz and
6.5 kHz, joined with a 150 ms complementary cosine overlap and level matched
with peak headroom. Original generations and WAV loop masters remain in
`~/Desktop/elevenlabs-output/`.

## Reactive mix

The existing scene supplies normalized speed, boost, throttle, road roughness
and camera-relative pan. `src/audio-effects.js` uses these to:

- Crossfade cruising and loaded engine loops and smoothly vary their pitch.
- Simulate two upshifts during the boost, with short RPM dips and mechanical cues.
- Increase tire grit and wind with speed; road texture also follows roughness.
- Apply restrained stereo placement to the engine and tires.

Filtered procedural noise provides wind. Lightweight synthesized cues mark
menu focus/hover, confirmation, launch, shifts and returning to the menu.
Hover feedback is rate limited; at most six transient voices remain active,
and each disconnects after completion. Five persistent looping sources cover
the music, two engine layers, tires and wind. Audio automation runs at no more
than 20 Hz, using Web Audio smoothing rather than allocating nodes per frame.

Music defaults to 55%, effects to 80%, with a master gain of 0.8. Music ducks
by up to 62% during the visual boost, then recovers as the bike slows.
A shared compressor provides additional mix headroom. Engine/ground/wind
layers remain silent if the 3D scene is unavailable.

The shifts are sound design for the current boost preview. A future race
simulation should supply real drivetrain/gear data instead.

## Controls and loading

The footer has independent **Music** and **Effects** toggles. **Settings**
opens an accessible native dialog with separate volume sliders; zero mutes.
Effects are enabled by default but wait for a user activation. Music retains
its existing opt-in preference. Nothing downloads or plays automatically on
page load, including after a reload with saved On preferences.

Preferences use `dune-rush-music`, `dune-rush-effects` and corresponding
`-volume` keys. Storage restrictions do not prevent playback. Both toggles
support Enter/Space without triggering Start Race; sliders retain their arrow
keys, and Escape closes the mixer and restores focus.

Each category loads independently, so a failed effect download does not stop
the music. Loading and retry states are announced to screen readers. Decoded
assets are cached, with failed downloads eligible for retry.

All sound uses one audio context. Channel mutes fade their own bus; muting both
or hiding the page fades and suspends the context, preserving loop positions.
Short cues are stopped before suspension so they do not replay on return.
No ElevenLabs credentials or runtime API calls are needed in the game.

## Verification

The production build passes. Automated Chrome and WebKit checks verified:

- Actual output from the engine and mixed soundtrack, with five persistent
  loops in one context and exact 4.8-second decoding for all PCM effects.
- Increasing RPM/load during the scene's boost, music ducking, and recovery
  as the bike coasts back to menu speed.
- Independent mutes, all-muted suspension, saved levels and visibility handling.
- Slider keyboard operation, Escape and focus restoration in the native dialog.
- Rapid toggles while loading, separate music/effect download failures, retries,
  blocked storage and unavailable audio/WebGL.
- Cleanup of short-lived cue nodes; repeated interactions do not duplicate loops.

The sampled maximum-volume boost mix peaked at 0.42 full scale (approximately
-7.6 dBFS), with no clipping observed. A captured default-level launch/coast
preview measured -21.18 LUFS and -8.41 dBTP; its MP3 listening copy is saved as
`~/Desktop/elevenlabs-output/dune-rush-mix-preview.mp3`.

The footer and mixer passed scoped axe WCAG A/AA checks. Both layouts were
checked at 320, 375, 390, 768, 1024 and 1440 px. Mobile screenshots were reviewed.
The production audio assets match their sources in `public/audio/`.

These are technical checks, not an auditory review or a physical-phone test.
Audition the complete mix in context with Start Race and adjust it in Settings.
