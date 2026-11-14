# Roots audio delivery and integration

The implementation follows `ROOTS-DAY-NIGHT-DESIGN-AND-AUDIO.md`.
Run `npm run dev` and open `/roots-audio.html` for the listening preview.
`/roots-audio.html?style=night` starts directly in the night environment.
The preview uses the supplied passage reference images and a small ride
simulation. It does not claim to implement the unpublished root-passage viewer,
root-bike meshes or rider rig.

## Delivered audio

ElevenLabs generated two instrumental companion arrangements. The night
generation was conditioned on both halves of the stored day song. Both target
96 BPM, D Dorian and a 16-bar phrase. Edited playback loops are 39.782 seconds.
Onset autocorrelation estimates about 95.34 BPM for each; this diagnostic does
not certify their exact beat grids, key or harmonic compatibility.

Accordingly, transitions fade the outgoing music to silence through the
continuous ambience before bringing up the incoming arrangement. The tracks
continue on the audio clock and never restart on an environment change. No
independent percussion stem is layered over an unverified beat grid.

The pack includes:

- `woodland-day.mp3` and `glowing-night.mp3`
- `forest-day.mp3` and `forest-night.mp3`: 20 seconds each
- `tires-moss.wav` and `bike-idle.wav`: 4.8-second PCM loops
- `bike-start.wav`, `bike-stop.wav` and `brake-soft.wav`
- `transition-to-day.wav` and `transition-to-night.wav`

Existing cruise/load engine recordings, sand tires and procedural wind are
reused. The forest beds combine four distinct five-second generated textures
each, with short overlaps and a small pitch-preserving stretch. The installed
MCP's SFX tool caps individual generations at five seconds.

Playback assets live in `public/audio/roots/` (about 4.3 MB total). Original
exports, derived WAV masters, exact composition plans, SFX prompts and provider
song IDs live in `assets/audio/roots/`. `generation.json` records the observed
batch cost: **1,738 credits**, from account usage 1,045 to 2,783. The MCP does not
expose per-SFX generation IDs or per-job credit totals; these are explicitly
unavailable rather than invented.

`manifest.json` records source hashes/formats, delivery hashes, durations, loop
points, channels, loudness, true peaks and automated signal checks. The original
MP3 exports are preserved. Processing them into 48 kHz WAV does not restore
information lost during generation/export.

## Audio API

`initAudio()` retains the desert menu defaults and its existing controls.
`initAudio({ level: 'roots', environment: 'night' })` selects a cold night entry.
Only one instance should be created per page. The Roots module shares the
existing context, master compressor and saved channel settings.

The controller expects the existing Music/Effects toggle, status and Settings
slider elements. An optional Ambience channel uses the same naming convention:
`ambience-toggle`, `ambience-status`, `ambience-volume`, `ambience-level`.
Use `.audio-toggle__state` inside each toggle. The preview is a complete
accessible markup example.

| Method | Contract |
| --- | --- |
| `start(action?)` | Call directly from a user gesture to unlock playback. Preserves saved mutes and handles channel loading/retry. |
| `prepareRoots()` | Decodes the Roots pack using the existing context. Rejects if a category cannot load. Does not create a context before the first activation. |
| `setLevel('roots', 'day' \| 'night')` | Prepares the pack before changing level, then uses an ambience bridge from the desert music. |
| `setLevel('desert')` | Restores the existing menu track at its continuing playback position. |
| `beginEnvironmentTransition('day' \| 'night')` | Call when the actual visual reveal begins, after assets load. Returns false for duplicate, current-style or concurrent transitions. Fires one directional cue. |
| `setEnvironmentProgress(p)` | Pass actual reveal progress, 0–1. At 1 the destination becomes current. Music and ambience follow this progress. |
| `cancelEnvironmentTransition()` | Restores the last completed environment mix and stops the transition cue. Restore the visual state in the caller too. |
| `updateRide(state)` | Send current physical state each render frame; audio changes are capped at 20 Hz. |
| `setPaused(boolean)` | Fades and suspends all buses, preserving their playback positions. The game must pause its own simulation too. |
| `getState()` | Returns level, completed environment, blend, pause/activation/readiness and transition state for UI. |

### Load before revealing

```js
// Inside a gesture handler: resume is invoked synchronously before any await.
await audio.start();
await Promise.all([loadRootPassage(), audio.prepareRoots()]);
await audio.setLevel('roots', initialStyle);

// A later environment switch:
try {
  await Promise.all([loadDestinationVisuals(nextStyle), audio.prepareRoots()]);
  if (audio.beginEnvironmentTransition(nextStyle)) {
    revealDestinationVisuals({
      onProgress: (progress) => audio.setEnvironmentProgress(progress),
      onComplete: () => audio.setEnvironmentProgress(1),
    });
  }
} catch {
  restorePreviousVisuals();
  audio.cancelEnvironmentTransition();
  showRetry();
}
```

Disable repeated switches while loading/revealing. For reduced motion, change
the image immediately and advance the audio progress over 100–250 ms. The
preview uses 150 ms. If a game pauses midway through a reveal, freeze both the
visual progress and simulation; the controller preserves the audio clock.

### Ride state in the Roots level

```js
audio.updateRide({
  active: true,
  engineOn: true,
  speed: signedSpeedMetresPerSecond,
  throttle: throttleFromSimulation, // 0–1
  braking: brakesApplied,
  pan: cameraRelativePan,           // clamped to -0.4…0.4
  roughness: surfaceRoughness,       // 0–1, retained for the shared contract
  boost: 0,
});
```

For Roots, `speed` is signed metres/second, with 12 m/s as the initial mix
reference speed. For the desert preview the prior normalized speed/boost
contract is unchanged. Do not feed a key's pressed state as vehicle speed.

Rolling and wind use absolute speed and fade to zero at rest. Idle is audible
only with an active, running engine. Start, stop and brake cues follow state
edges; unmuting does not replay stale events. Reverse travel does not reverse
sample playback. Engine playback-rate variation stays within 0.85–1.2.
The Roots ride has no invented gearshift/jump/impact events.

## Asset processing

Rebuild delivered audio locally:

```sh
python3 scripts/prepare-roots-audio.py
```

This requires FFmpeg/ffprobe and NumPy. It does not call ElevenLabs or spend
credits. Music and ambience use stereo 48 kHz MP3 with gapless metadata; short
effects use mono 48 kHz PCM WAV to avoid the padding seen in WebKit with short
44.1 kHz MP3 effects. WAV masters use 24-bit PCM; delivered WAV uses 16-bit PCM.
If replacing music with different lengths, update the loop duration in
`src/roots-audio.js` to match the generated manifest.

The two supplied reference images are converted to 1280×720 WebP at quality 86
under `public/roots/`. The originals remain untouched under
`assets/roots/reference/`.

## Review limits

Automated decoding and waveform checks cannot establish that a mix sounds
right, that every generated timbre is appropriate, or that independent
arrangements are harmonically interchangeable. The manifest keeps human
listening review pending. Listen through three repeats and the complete ride
cycle on headphones, laptop speakers and a physical phone before final
creative approval. The full level integration still requires its unpublished
viewer/models and their actual load/reveal callbacks.
