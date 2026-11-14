import { createRideAudio } from './audio-effects.js';
import { createRootsAudio } from './roots-audio.js';

const ASSET_ROOT = `${import.meta.env.BASE_URL}audio/`;
const clamp = (value) => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));

export function initAudio({ level: initialLevel = 'desert', environment: initialEnvironment = 'day' } = {}) {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  const dialog = document.querySelector('#audio-settings');
  const channels = {};
  const downloads = new Map();
  let context;
  let master;
  let effects;
  let roots;
  let desertMusic;
  let desertGain;
  let level = initialLevel;
  let environment = initialEnvironment;
  let nightBlend = environment === 'night' ? 1 : 0;
  let transition = null;
  let paused = false;
  let previousLevel;
  let activated = false;
  let suspendTimer;
  let lastMix = -Infinity;
  let ride = { active: false, speed: 1, boost: 0, throttle: 0, roughness: 0, pan: 0 };

  function read(key) {
    try { return localStorage.getItem(`dune-rush-${key}`); } catch { return null; }
  }

  function save(name) {
    const channel = channels[name];
    try {
      localStorage.setItem(`dune-rush-${name}`, channel.enabled ? 'on' : 'off');
      localStorage.setItem(`dune-rush-${name}-volume`, String(channel.volume));
    } catch {
      // Storage restrictions must not disable sound controls.
    }
  }

  function updateControls() {
    for (const [name, channel] of Object.entries(channels)) {
      if (!channel.button) continue;
      const active = channel.enabled && activated && !channel.failed.has(level);
      const playing = active && channel.loaded.has(level) && context?.state === 'running' && !document.hidden && !paused;
      channel.button.setAttribute('aria-pressed', String(active));
      channel.label.textContent = !AudioContext ? 'N/A'
        : !channel.enabled ? 'Off'
        : channel.pending.has(level) ? '…'
        : channel.failed.has(level) ? 'Retry'
        : playing ? 'On'
        : activated ? 'Paused' : 'Play';
      channel.button.title = active ? `Turn ${name} off` : `Play ${name}`;
      channel.status.textContent = !AudioContext ? `${name} is unavailable in this browser.`
        : !channel.enabled ? `${name} is off.`
        : channel.pending.has(level) ? `Loading ${name}.`
        : channel.failed.has(level) ? `${name} could not start. Select ${name} to retry.`
        : playing ? `${name} is on.`
        : active ? `${name} is paused.` : `Select ${name} or a menu action to play.`;
      channel.slider.value = channel.enabled ? Math.round(channel.volume * 100) : 0;
      channel.output.value = Number(channel.slider.value) ? `${channel.slider.value}%` : 'Off';
    }
  }

  const audible = (channel) => channel.enabled && channel.volume > 0
    && !channel.failed.has(level) && (channel.name !== 'ambience' || level === 'roots');

  function updateLayers() {
    roots?.setActive(level === 'roots');
    roots?.update(ride, nightBlend, transition);
    effects?.update({ ...ride, profile: level === 'roots' ? 'roots' : 'desert', nightBlend }, audible(channels.effects));
  }

  function applyMix() {
    if (!context) return;
    const now = context.currentTime;
    for (const [name, channel] of Object.entries(channels)) {
      const duck = name === 'music' && level === 'desert' ? 1 - clamp(ride.boost) * 0.62 : 1;
      channel.bus.gain.setTargetAtTime(audible(channel) ? channel.volume * duck : 0, now, 0.045);
    }
    clearTimeout(suspendTimer);
    const playing = !paused && !document.hidden && Object.values(channels).some(audible);
    master.gain.setTargetAtTime(playing ? 0.8 : 0, now, 0.035);
    if (previousLevel !== level) {
      desertGain.gain.cancelAndHoldAtTime(now);
      desertGain.gain.setTargetAtTime(level === 'desert' ? 1 : 0, now + (previousLevel && level === 'desert' ? 0.3 : 0), 0.07);
      previousLevel = level;
    }
    updateLayers();
    if (!playing) {
      effects?.stopCues();
      roots?.stopCue();
      suspendTimer = setTimeout(() => {
        if (paused || document.hidden || !Object.values(channels).some(audible)) {
          void context.suspend().catch(() => {});
        }
      }, 160);
    }
  }

  function ensureContext() {
    if (context) return;
    context = new AudioContext();
    master = context.createGain();
    master.gain.value = 0;
    master.connect(context.destination);
    const compressor = context.createDynamicsCompressor();
    compressor.threshold.value = -8;
    compressor.knee.value = 8;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.15;
    compressor.connect(master);
    for (const channel of Object.values(channels)) {
      channel.bus = context.createGain();
      channel.bus.gain.value = 0;
      channel.bus.connect(compressor);
    }
    desertGain = context.createGain();
    desertGain.gain.value = 0;
    desertGain.connect(channels.music.bus);
    context.addEventListener('statechange', updateControls);
  }

  function download(filename) {
    if (!downloads.has(filename)) {
      downloads.set(filename, (async () => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 20000);
        try {
          const response = await fetch(`${ASSET_ROOT}${filename}`, { signal: controller.signal });
          if (!response.ok) throw new Error(`Audio request failed: ${response.status}`);
          return await context.decodeAudioData(await response.arrayBuffer());
        } catch (error) {
          downloads.delete(filename);
          throw error;
        } finally {
          clearTimeout(timeout);
        }
      })());
    }
    return downloads.get(filename);
  }

  function loadChannel(name, target = level) {
    const channel = channels[name];
    channel.failed.delete(target);
    if (channel.loaded.has(target) || channel.pending.has(target)) return channel.pending.get(target);
    const pending = (async () => {
      try {
        if (target === 'roots' && !roots) {
          roots = createRootsAudio(context, {
            music: channels.music.bus, ambience: channels.ambience.bus, effects: channels.effects.bus,
          }, download);
        }
        if (name === 'music' && target === 'desert' && !desertMusic) {
          const buffer = await download('dune-rush-menu.mp3');
          desertMusic = context.createBufferSource();
          desertMusic.buffer = buffer;
          desertMusic.loop = true;
          desertMusic.connect(desertGain);
          desertMusic.start();
        } else if (name === 'effects') {
          effects ??= createRideAudio(context, channels.effects.bus);
          effects.load(await Promise.all(['bike-cruise.wav', 'bike-load.wav', 'sand-tires.wav'].map(download)));
          if (target === 'roots') {
            effects.loadRoots(await Promise.all([
              'roots/bike-idle.wav', 'roots/tires-moss.wav', 'roots/bike-start.wav',
              'roots/bike-stop.wav', 'roots/brake-soft.wav',
            ].map(download)));
          }
        }
        if (target === 'roots') await roots.load(name);
        channel.loaded.add(target);
      } catch {
        channel.failed.add(target);
      } finally {
        channel.pending.delete(target);
        applyMix();
        updateControls();
      }
    })();
    channel.pending.set(target, pending);
    updateControls();
    return pending;
  }

  function cue(kind) {
    if (!paused && effects && audible(channels.effects)) effects.cue(kind);
  }

  // Resume within the activating gesture; fetching never delays the game UI.
  async function start(action) {
    if (!AudioContext || paused || document.hidden
      || !Object.values(channels).some((channel) => channel.enabled && (level === 'roots' || channel.name !== 'ambience'))) return;
    const requestedAt = performance.now();
    activated = true;
    try {
      ensureContext();
      clearTimeout(suspendTimer);
      const resumed = context.resume();
      if (channels.effects.enabled && !effects) effects = createRideAudio(context, channels.effects.bus);
      const loading = Object.entries(channels)
        .filter(([name, channel]) => channel.enabled && (level === 'roots' || name !== 'ambience'))
        .map(([name]) => loadChannel(name));
      applyMix();
      await resumed;
      // Never play stale click feedback after a slow browser audio unlock.
      if (action && performance.now() - requestedAt < 250) cue(action === 'start' ? 'start' : 'confirm');
      await Promise.all(loading);
      applyMix();
    } catch {
      for (const channel of Object.values(channels)) {
        if (channel.enabled) channel.failed.add(level);
      }
      applyMix();
    } finally {
      updateControls();
    }
  }

  for (const [name, defaultVolume] of [['music', 0.55], ['effects', 0.8], ['ambience', 0.6]]) {
    const storedVolume = read(`${name}-volume`);
    const volume = storedVolume !== null && Number.isFinite(Number(storedVolume))
      ? clamp(Number(storedVolume)) : defaultVolume;
    const channel = channels[name] = {
      name,
      enabled: (read(name) ?? (name !== 'music' || level === 'roots' ? 'on' : 'off')) === 'on' && volume > 0,
      volume,
      button: document.querySelector(`#${name}-toggle`),
      status: document.querySelector(`#${name}-status`),
      slider: document.querySelector(`#${name}-volume`),
      output: document.querySelector(`#${name}-level`),
      loaded: new Set(),
      pending: new Map(),
      failed: new Set(),
    };
    if (!channel.button) continue;
    channel.label = channel.button.querySelector('.audio-toggle__state');
    channel.button.disabled = channel.slider.disabled = !AudioContext;
    channel.button.addEventListener('click', () => {
      channel.enabled = !(channel.enabled && activated && !channel.failed.has(level));
      if (channel.enabled && channel.volume === 0) channel.volume = defaultVolume;
      if (!channel.enabled && name === 'effects') effects?.stopCues();
      if (!channel.enabled && name === 'effects') roots?.stopCue();
      save(name);
      if (channel.enabled) void start();
      else applyMix();
      updateControls();
    });
    channel.slider.addEventListener('input', () => {
      channel.volume = clamp(Number(channel.slider.value) / 100);
      channel.enabled = channel.volume > 0;
      save(name);
      if (channel.enabled) void start();
      else applyMix();
      updateControls();
    });
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) applyMix();
    else if (activated) void start();
  });
  dialog.addEventListener('close', () => cue('back'));
  updateControls();

  async function prepareRoots() {
    // A muted, not-yet-unlocked scene may change visually without creating audio.
    if (!context) return;
    await Promise.all(Object.keys(channels).map((name) => loadChannel(name, 'roots')));
    if (Object.values(channels).some((channel) => !channel.loaded.has('roots'))) {
      throw new Error('Woodland audio could not load. Try again.');
    }
  }

  return {
    start,
    cue,
    prepareRoots,
    async setLevel(next, style = 'day') {
      if (!['desert', 'roots'].includes(next) || !['day', 'night'].includes(style)) {
        throw new Error('Unknown audio scene.');
      }
      if (next === 'roots') await prepareRoots();
      if (next === 'desert' && context) {
        await Promise.all(['music', 'effects'].map((name) => loadChannel(name, 'desert')));
        if (channels.music.failed.has('desert') || channels.effects.failed.has('desert')) {
          throw new Error('Menu audio could not load. Try again.');
        }
      }
      level = next;
      environment = style;
      nightBlend = style === 'night' ? 1 : 0;
      transition = null;
      applyMix();
      updateControls();
    },
    // Call only after the destination visuals have loaded, as the reveal starts.
    beginEnvironmentTransition(style) {
      if (level !== 'roots' || transition || style === environment || !['day', 'night'].includes(style)) return false;
      transition = { from: environment, to: style, progress: 0 };
      if (!paused && audible(channels.effects)) roots?.cue(style);
      return true;
    },
    setEnvironmentProgress(progress) {
      if (!transition) return;
      transition.progress = clamp(progress);
      nightBlend = transition.to === 'night' ? transition.progress : 1 - transition.progress;
      if (transition.progress === 1) {
        environment = transition.to;
        transition = null;
      }
    },
    cancelEnvironmentTransition() {
      transition = null;
      nightBlend = environment === 'night' ? 1 : 0;
      roots?.stopCue();
      applyMix();
    },
    setPaused(value) {
      paused = Boolean(value);
      if (paused) applyMix();
      else void start();
      updateControls();
    },
    getState: () => ({
      level, environment, nightBlend, paused, activated, transitioning: Boolean(transition),
      ready: Object.values(channels)
        .filter((channel) => channel.enabled && (level === 'roots' || channel.name !== 'ambience'))
        .every((channel) => channel.loaded.has(level) && !channel.failed.has(level)),
    }),
    openSettings() {
      // Safari does not focus buttons on pointer activation; give the dialog
      // a consistent return target for both pointer and keyboard users.
      document.querySelector('[data-action="settings"]')?.focus({ preventScroll: true });
      dialog.showModal();
    },
    updateRide(state) {
      ride = state;
      if (!context || context.state !== 'running' || document.hidden || paused) return;
      if (context.currentTime - lastMix >= 0.05) {
        lastMix = context.currentTime;
        updateLayers();
        // Only music ducking changes per frame. Suspension stays event-driven.
        channels.music.bus.gain.setTargetAtTime(
          audible(channels.music) ? channels.music.volume * (level === 'desert' ? 1 - clamp(ride.boost) * 0.62 : 1) : 0,
          context.currentTime, 0.12,
        );
      }
    },
  };
}
