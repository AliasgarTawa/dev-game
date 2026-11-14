import { createRideAudio } from './audio-effects.js';

const ASSET_ROOT = `${import.meta.env.BASE_URL}audio/`;
const clamp = (value) => Math.min(1, Math.max(0, value));

export function initAudio() {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  const dialog = document.querySelector('#audio-settings');
  const channels = {};
  const downloads = new Map();
  let context;
  let master;
  let effects;
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
      const active = channel.enabled && activated && !channel.failed;
      const playing = active && channel.loaded && context?.state === 'running' && !document.hidden;
      channel.button.setAttribute('aria-pressed', String(active));
      channel.label.textContent = !AudioContext ? 'N/A'
        : !channel.enabled ? 'Off'
        : channel.pending ? '…'
        : channel.failed ? 'Retry'
        : playing ? 'On'
        : activated ? 'Paused' : 'Play';
      channel.button.title = active ? `Turn ${name} off` : `Play ${name}`;
      channel.status.textContent = !AudioContext ? `${name} is unavailable in this browser.`
        : !channel.enabled ? `${name} is off.`
        : channel.pending ? `Loading ${name}.`
        : channel.failed ? `${name} could not start. Select ${name} to retry.`
        : playing ? `${name} is on.`
        : active ? `${name} is paused.` : `Select ${name} or a menu action to play.`;
      channel.slider.value = channel.enabled ? Math.round(channel.volume * 100) : 0;
      channel.output.value = Number(channel.slider.value) ? `${channel.slider.value}%` : 'Off';
    }
  }

  const audible = (channel) => channel.enabled && channel.volume > 0 && !channel.failed;

  function applyMix() {
    if (!context) return;
    const now = context.currentTime;
    for (const [name, channel] of Object.entries(channels)) {
      const duck = name === 'music' ? 1 - clamp(ride.boost) * 0.62 : 1;
      channel.bus.gain.setTargetAtTime(audible(channel) ? channel.volume * duck : 0, now, 0.045);
    }
    clearTimeout(suspendTimer);
    const playing = !document.hidden && Object.values(channels).some(audible);
    master.gain.setTargetAtTime(playing ? 0.8 : 0, now, 0.035);
    if (!playing) {
      effects?.stopCues();
      suspendTimer = setTimeout(() => {
        if (document.hidden || !Object.values(channels).some(audible)) {
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

  function loadChannel(name) {
    const channel = channels[name];
    channel.failed = false;
    if (channel.loaded || channel.pending) return channel.pending;
    channel.pending = (async () => {
      try {
        if (name === 'music') {
          const buffer = await download('dune-rush-menu.mp3');
          const source = context.createBufferSource();
          source.buffer = buffer;
          source.loop = true;
          source.connect(channel.bus);
          source.start();
        } else {
          effects.load(await Promise.all(['bike-cruise.wav', 'bike-load.wav', 'sand-tires.wav'].map(download)));
          effects.update(ride, audible(channel));
        }
        channel.loaded = true;
      } catch {
        channel.failed = true;
      } finally {
        channel.pending = null;
        applyMix();
        updateControls();
      }
    })();
    updateControls();
    return channel.pending;
  }

  function cue(kind) {
    if (effects && audible(channels.effects)) effects.cue(kind);
  }

  // Resume within the activating gesture; fetching never delays the game UI.
  async function start(action) {
    if (!AudioContext || document.hidden || !Object.values(channels).some((channel) => channel.enabled)) return;
    const requestedAt = performance.now();
    activated = true;
    try {
      ensureContext();
      clearTimeout(suspendTimer);
      const resumed = context.resume();
      if (channels.effects.enabled && !effects) effects = createRideAudio(context, channels.effects.bus);
      const loading = Object.entries(channels)
        .filter(([, channel]) => channel.enabled)
        .map(([name]) => loadChannel(name));
      applyMix();
      await resumed;
      // Never play stale click feedback after a slow browser audio unlock.
      if (action && performance.now() - requestedAt < 250) cue(action === 'start' ? 'start' : 'confirm');
      await Promise.all(loading);
      applyMix();
    } catch {
      for (const channel of Object.values(channels)) {
        if (channel.enabled) channel.failed = true;
      }
      applyMix();
    } finally {
      updateControls();
    }
  }

  for (const [name, defaultVolume] of [['music', 0.55], ['effects', 0.8]]) {
    const storedVolume = read(`${name}-volume`);
    const volume = storedVolume !== null && Number.isFinite(Number(storedVolume))
      ? clamp(Number(storedVolume)) : defaultVolume;
    const channel = channels[name] = {
      enabled: (read(name) ?? (name === 'effects' ? 'on' : 'off')) === 'on' && volume > 0,
      volume,
      button: document.querySelector(`#${name}-toggle`),
      status: document.querySelector(`#${name}-status`),
      slider: document.querySelector(`#${name}-volume`),
      output: document.querySelector(`#${name}-level`),
      loaded: false,
      pending: null,
      failed: false,
    };
    channel.label = channel.button.querySelector('.audio-toggle__state');
    channel.button.disabled = channel.slider.disabled = !AudioContext;
    channel.button.addEventListener('click', () => {
      channel.enabled = !(channel.enabled && activated && !channel.failed);
      if (channel.enabled && channel.volume === 0) channel.volume = defaultVolume;
      if (!channel.enabled && name === 'effects') effects?.stopCues();
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

  return {
    start,
    cue,
    openSettings() {
      // Safari does not focus buttons on pointer activation; give the dialog
      // a consistent return target for both pointer and keyboard users.
      document.querySelector('[data-action="settings"]').focus({ preventScroll: true });
      dialog.showModal();
    },
    updateRide(state) {
      ride = state;
      if (!context || context.state !== 'running' || document.hidden) return;
      effects?.update(ride, audible(channels.effects));
      if (context.currentTime - lastMix >= 0.05) {
        lastMix = context.currentTime;
        // Only music ducking changes per frame. Suspension stays event-driven.
        channels.music.bus.gain.setTargetAtTime(
          audible(channels.music) ? channels.music.volume * (1 - clamp(ride.boost) * 0.62) : 0,
          context.currentTime, 0.12,
        );
      }
    },
  };
}
