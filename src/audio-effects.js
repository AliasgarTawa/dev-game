const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));

export function createRideAudio(context, destination) {
  const noiseBuffer = context.createBuffer(1, context.sampleRate * 3, context.sampleRate);
  const noiseData = noiseBuffer.getChannelData(0);
  for (let i = 0; i < noiseData.length; i++) noiseData[i] = Math.random() * 2 - 1;
  const voices = new Map();
  let layers;
  let lastUpdate = -Infinity;
  let lastHover = -Infinity;
  let gear = 0;
  let shiftUntil = 0;

  function filter(type, frequency, output) {
    const node = context.createBiquadFilter();
    node.type = type;
    node.frequency.value = frequency;
    node.Q.value = 0.6;
    node.connect(output);
    return node;
  }

  function loop(buffer, output) {
    const source = context.createBufferSource();
    const gain = context.createGain();
    gain.gain.value = 0;
    source.buffer = buffer;
    source.loop = true;
    source.connect(gain).connect(output);
    source.start();
    return { source, gain };
  }

  function stopCue(source) {
    const envelope = voices.get(source);
    envelope.gain.cancelAndHoldAtTime(context.currentTime);
    envelope.gain.linearRampToValueAtTime(0, context.currentTime + 0.01);
    source.stop(context.currentTime + 0.015);
    voices.delete(source);
  }

  // Short procedural cues keep interface feedback responsive without downloads.
  function burst(type, from, to, duration, volume) {
    if (voices.size >= 6) stopCue(voices.keys().next().value);
    const source = type === 'noise' ? context.createBufferSource() : context.createOscillator();
    const envelope = context.createGain();
    const shape = type === 'noise' ? filter('bandpass', from, envelope) : null;
    if (shape) source.buffer = noiseBuffer;
    else source.type = type;
    const frequency = shape ? shape.frequency : source.frequency;
    const now = context.currentTime;
    frequency.setValueAtTime(from, now);
    frequency.exponentialRampToValueAtTime(to, now + duration);
    envelope.gain.setValueAtTime(0, now);
    envelope.gain.linearRampToValueAtTime(volume, now + 0.005);
    envelope.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    source.connect(shape || envelope);
    envelope.connect(destination);
    voices.set(source, envelope);
    source.onended = () => {
      voices.delete(source);
      source.disconnect();
      shape?.disconnect();
      envelope.disconnect();
    };
    source.start();
    source.stop(now + duration + 0.01);
  }

  function cue(kind) {
    if (context.state !== 'running' || document.hidden) return;
    if (kind === 'hover') {
      if (context.currentTime - lastHover < 0.08) return;
      lastHover = context.currentTime;
      burst('noise', 1800, 1200, 0.035, 0.035);
    } else if (kind === 'shift') {
      burst('noise', 900, 350, 0.055, 0.07);
      burst('sine', 100, 65, 0.07, 0.06);
    } else if (kind === 'start') {
      burst('triangle', 240, 480, 0.16, 0.045);
      burst('noise', 450, 1800, 0.4, 0.13);
    } else if (kind === 'back') {
      burst('sine', 440, 260, 0.09, 0.035);
    } else {
      burst('triangle', 420, 620, 0.075, 0.04);
      burst('noise', 2400, 1200, 0.045, 0.04);
    }
  }

  function load([cruise, highLoad, tires]) {
    if (layers) return;
    const pan = context.createStereoPanner();
    pan.connect(destination);
    const engineFilter = filter('lowpass', 3500, pan);
    const roadFilter = filter('lowpass', 2500, pan);
    const windFilter = filter('bandpass', 700, destination);
    layers = {
      cruise: loop(cruise, engineFilter),
      load: loop(highLoad, engineFilter),
      tires: loop(tires, roadFilter),
      wind: loop(noiseBuffer, windFilter),
      pan, engineFilter, windFilter,
    };
  }

  function update(ride, audible) {
    if (!layers || context.state !== 'running') return;
    const now = context.currentTime;
    if (now - lastUpdate < 0.05) return;
    lastUpdate = now;
    const pace = clamp((ride.speed - 1) / 1.8);
    const boost = clamp(ride.boost);
    const nextGear = pace > 0.67 ? 2 : pace > 0.32 ? 1 : 0;
    if (nextGear > gear && ride.throttle > 0.5 && audible) {
      shiftUntil = now + 0.12;
      cue('shift');
    }
    gear = nextGear;
    const shift = now < shiftUntil ? 0.86 : 1;
    const load = clamp(0.08 + boost * 0.92);
    const moving = ride.active ? 1 : 0;
    const smooth = (param, value) => param.setTargetAtTime(value, now, 0.08);
    smooth(layers.cruise.source.playbackRate, (0.9 + pace * 0.65 - gear * 0.13) * shift);
    smooth(layers.load.source.playbackRate, (0.78 + pace * 0.45 - gear * 0.08) * shift);
    smooth(layers.cruise.gain.gain, moving * 0.65 * Math.cos(load * Math.PI / 2));
    smooth(layers.load.gain.gain, moving * 0.65 * Math.sin(load * Math.PI / 2));
    smooth(layers.tires.source.playbackRate, 0.9 + pace * 0.4);
    smooth(layers.tires.gain.gain, moving * (0.12 + pace * 0.24 + clamp(ride.roughness) * 0.06));
    smooth(layers.wind.gain.gain, moving * (0.035 + pace * 0.13));
    smooth(layers.windFilter.frequency, 700 + pace * 1300);
    smooth(layers.engineFilter.frequency, 3200 + boost * 2200);
    smooth(layers.pan.pan, clamp(ride.pan, -0.4, 0.4));
  }

  function stopCues() {
    for (const source of voices.keys()) stopCue(source);
  }

  return { load, update, cue, stopCues };
}
