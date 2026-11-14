# Roots audio verification — 2026-11-14

The production build passes. Chromium and WebKit playback checks pass for:

- User-gesture gating, a single shared audio context and ten persistent Roots
  loops, without duplicate sources after repeated changes.
- Cold night entry without a day-music gain ramp.
- Exact decoded 39.782-second music and 20-second ambience lengths in both
  browsers. Short effects use PCM WAV.
- Ignition, idle, acceleration, braking, coasting, engine-off silence and
  reverse travel with positive playback rates.
- Delayed/failed image loads retaining the previous mix and preventing early
  transformation cues; successful retry.
- Failed music downloads and retry; rapid toggles during downloads.
- Reduced-motion changes, saved mutes and unavailable Web Audio.
- Pause/resume, independent channel controls and simulated page visibility.
- Keyboard access, Settings focus restoration and automated WCAG A/AA checks
  with zero axe violations.
- Layouts at 375, 768, 1024 and 1440 px, without horizontal overflow.

A 121-second Chromium output capture covered three complete music repeats,
with no silent analysis windows and no duplicated loops. Peak output was
0.2352; the maximum-level ride test peaked at 0.3758 in Chromium and 0.3901 in
WebKit, below full scale. These are measurements of the tested sequences,
not a proof covering every possible simultaneous cue.

The desert menu regression check confirms its five original loops and no
Roots asset downloads. No browser page errors occurred in the passing runs.
The existing Three.js scene bundle still produces Vite's large-chunk warning.

Verification used Playwright Chromium/WebKit, actual Web Audio output
sampling and source/parameter inspection. Automated runs are not listening
approval. Actual headphone, laptop-speaker and physical-phone reviews remain
pending, as does connecting this API to the unpublished woodland viewer and
root-bike models.
