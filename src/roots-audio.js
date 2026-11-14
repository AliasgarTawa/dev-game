const clamp = (value) => Math.min(1, Math.max(0, value));

// Shares the game's context and buses. Both arrangements stay on the same
// audio clock, but unverified beat grids are separated by an ambience bridge.
export function createRootsAudio(context, buses, download) {
  const musicGate = context.createGain();
  const ambienceGate = context.createGain();
  const motion = context.createGain();
  const musicFilter = context.createBiquadFilter();
  musicGate.gain.value = ambienceGate.gain.value = 0;
  motion.gain.value = 0.55;
  musicFilter.type = 'lowpass';
  musicFilter.frequency.value = 5500;
  musicFilter.Q.value = 0.6;
  musicFilter.connect(motion).connect(musicGate).connect(buses.music);
  ambienceGate.connect(buses.ambience);
  const layers = {};
  const pending = new Map();
  let cues;
  let active = false;
  let epoch;
  let voice;

  function loop(buffer, destination, duration) {
    const source = context.createBufferSource();
    const gain = context.createGain();
    gain.gain.value = 0;
    source.buffer = buffer;
    source.loop = true;
    source.loopEnd = duration;
    source.connect(gain).connect(destination);
    const now = context.currentTime + 0.02;
    epoch ??= now;
    source.start(now, (now - epoch) % duration);
    return { source, gain };
  }

  async function load(category) {
    if (layers[category] || (category === 'effects' && cues)) return;
    if (pending.has(category)) return pending.get(category);
    const request = (async () => {
      if (category === 'effects') {
        const [day, night] = await Promise.all([
          download('roots/transition-to-day.wav'), download('roots/transition-to-night.wav'),
        ]);
        cues = { day, night };
      } else {
        const files = category === 'music'
          ? ['roots/woodland-day.mp3', 'roots/glowing-night.mp3']
          : ['roots/forest-day.mp3', 'roots/forest-night.mp3'];
        const buffers = await Promise.all(files.map(download));
        const destination = category === 'music' ? musicFilter : ambienceGate;
        const duration = category === 'music' ? 39.782 : 20;
        layers[category] = buffers.map((buffer) => loop(buffer, destination, duration));
      }
    })().finally(() => pending.delete(category));
    pending.set(category, request);
    return request;
  }

  function stopCue() {
    if (!voice) return;
    const now = context.currentTime;
    voice.gain.gain.cancelAndHoldAtTime(now);
    voice.gain.gain.linearRampToValueAtTime(0, now + 0.015);
    voice.source.stop(now + 0.02);
    voice = null;
  }

  function cue(style) {
    if (!active || !cues || context.state !== 'running' || document.hidden) return;
    stopCue();
    const source = context.createBufferSource();
    const gain = context.createGain();
    source.buffer = cues[style];
    gain.gain.value = 0.45;
    source.connect(gain).connect(buses.effects);
    const current = { source, gain };
    voice = current;
    source.onended = () => {
      source.disconnect();
      gain.disconnect();
      if (voice === current) voice = null;
    };
    source.start();
  }

  function setActive(next) {
    if (active === next) return;
    active = next;
    const now = context.currentTime;
    musicGate.gain.cancelAndHoldAtTime(now);
    musicGate.gain.setTargetAtTime(active ? 1 : 0, now + (active ? 0.3 : 0), 0.07);
    ambienceGate.gain.setTargetAtTime(active ? 1 : 0, now, 0.07);
    if (!active) stopCue();
  }

  function update(ride, blend, transition) {
    const now = context.currentTime;
    const pace = clamp(Math.abs(ride.speed || 0) / 12);
    motion.gain.setTargetAtTime(pace > 0.03 ? 0.75 : 0.55, now, 1.2);
    musicFilter.frequency.setTargetAtTime(5500 + pace * 8500, now, 1.2);
    if (layers.ambience) {
      layers.ambience[0].gain.gain.setTargetAtTime(Math.cos(blend * Math.PI / 2), now, 0.04);
      layers.ambience[1].gain.gain.setTargetAtTime(Math.sin(blend * Math.PI / 2), now, 0.04);
    }
    if (layers.music) {
      let day = 1 - blend;
      let night = blend;
      if (transition) {
        const outgoing = Math.cos(Math.min(1, transition.progress * 2) * Math.PI / 2);
        const incoming = Math.sin(Math.max(0, transition.progress * 2 - 1) * Math.PI / 2);
        [day, night] = transition.to === 'night' ? [outgoing, incoming] : [incoming, outgoing];
      }
      layers.music[0].gain.gain.setTargetAtTime(day, now, 0.04);
      layers.music[1].gain.gain.setTargetAtTime(night, now, 0.04);
    }
  }

  return { load, setActive, update, cue, stopCue };
}
