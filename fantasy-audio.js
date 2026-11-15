// Sound for the three-worlds scene (fantasy.html?scene=worlds). It plays the opening app's own audio set
// (worlds-opening/audio, a copy of dev-game/opening/audio) with the opening's mix levels:
//   desert: menu track as the music bed, sand tyres       day: woodland music + forest ambience, moss tyres
//   night: glowing-night music + night-forest ambience    engine: idle / cruise / load loops by speed and throttle
// A world switch crossfades music and ambience with the reveal's progress and plays the transition cue.
const BASE = '/worlds-opening/audio/';
const FILES = {menu: 'dune-rush-menu.mp3', cruise: 'bike-cruise.wav', load: 'bike-load.wav', sand: 'sand-tires.wav',
  idle: 'roots/bike-idle.wav', moss: 'roots/tires-moss.wav', start: 'roots/bike-start.wav', stop: 'roots/bike-stop.wav', brake: 'roots/brake-soft.wav',
  forestDay: 'roots/forest-day.mp3', forestNight: 'roots/forest-night.mp3', musicDay: 'roots/woodland-day.mp3', musicNight: 'roots/glowing-night.mp3',
  toDay: 'roots/transition-to-day.wav', toNight: 'roots/transition-to-night.wav'};
// The bike sounds different in each world: engine pitch (base + per unit speed), engine brightness (low-pass Hz, base + per
// unit throttle), engine level, and how much sand tyre, moss tyre and wind is heard. A switch crossfades between them.
const BIKE = {
  desert: {rate: [0.98, 0.42], filt: [3200, 2200], gain: 0.62, sand: 0.34, moss: 0.00, wind: 0.14},      // raw and bright, sand under the tyres
  day:    {rate: [0.85, 0.30], filt: [2300, 1700], gain: 0.50, sand: 0.08, moss: 0.34, wind: 0.06},      // softer, on moss
  night:  {rate: [0.72, 0.22], filt: [1300, 900],  gain: 0.44, sand: 0.00, moss: 0.50, wind: 0.03},      // deep and muffled
};
// Worlds with their own vehicle sound (runs/new-worlds-2026-11-15/audio: ElevenLabs takes, one picked per role by measurement,
// made seamless and level-matched). Each has music, a cruise loop, a load loop and a surface loop in worlds/<dir>/.
// rate: engine pitch (base + per unit of revs); filt: engine low-pass (base + per unit throttle); gain: engine level;
// idle: level and pitch of the cruise loop at a standstill; surf: surface level at speed; wind: wind level.
const SETS = {
  winter:    {dir: 'winter',      rate: [0.80, 0.42], filt: [2600, 2400], gain: 0.52, idle: [0.45, 0.62], surf: 0.55, wind: 0.16},      // snowmobile on packed snow
  cyberpunk: {dir: 'cyberpunk',   rate: [0.78, 0.62], filt: [5200, 3200], gain: 0.44, idle: [0.18, 0.55], surf: 0.34, wind: 0.09},      // electric: nearly silent at rest, whine with speed
  ghibli:    {dir: 'countryside', rate: [0.84, 0.36], filt: [2400, 1800], gain: 0.50, idle: [0.50, 0.66], surf: 0.42, wind: 0.06},      // vintage single on a dirt lane
};
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, Number.isFinite(v) ? v : 0));

export function createAudio({onState = () => {}, worlds = ['desert', 'day', 'night']} = {}) {
  const skip = worlds.includes('desert') ? [] : ['menu', 'sand'];      // the desert's music and tyre sound are not loaded when it is not in the game
  const sets = Object.keys(SETS).filter(k => worlds.includes(k)), files = {...FILES}, dest = {};
  for (const k of sets) for (const [role, ext, to] of [['music', 'mp3', 'musicFilter'], ['cruise', 'wav', 'engine'], ['load', 'wav', 'engine'], ['surface', 'wav', 'tyres']]) {
    files[role + '_' + k] = 'worlds/' + SETS[k].dir + '/' + role + '.' + ext; dest[role + '_' + k] = to; }
  const AC = window.AudioContext || window.webkitAudioContext;
  let ctx = null, enabled = true, loading = false, last = 0, wasMoving = false, engineStarted = false;
  const buf = {}, loop = {}, node = {}, failed = [];
  const state = () => ({supported: !!AC, enabled, running: ctx?.state === 'running', loaded: Object.keys(buf).length, total: Object.keys(files).length - skip.length, failed});

  function init() {
    ctx = new AC();
    node.master = ctx.createGain(); node.master.gain.value = 0; node.master.connect(ctx.destination);
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -8; comp.knee.value = 8; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.15; comp.connect(node.master);
    node.meter = ctx.createAnalyser(); node.meter.fftSize = 2048; node.master.connect(node.meter);      // for levels(): is anything actually sounding
    for (const [k, v] of [['music', 0.36], ['ambience', 0.7], ['effects', 0.75]])      // music bus: 0.5 until 2026-11-15, lowered about 3 dB at the user's request
    { node[k] = ctx.createGain(); node[k].gain.value = v; node[k].connect(comp); }
    const filter = (type, f, dest) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = 0.6; b.connect(dest); return b; };
    node.engine = filter('lowpass', 3500, node.effects); node.tyres = filter('lowpass', 2500, node.effects); node.wind = filter('bandpass', 700, node.effects);
    node.musicGain = ctx.createGain(); node.musicGain.gain.value = 0.55; node.musicGain.connect(node.music);
    node.musicFilter = filter('lowpass', 5500, node.musicGain);
    const noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    mkLoop('windNoise', noise, node.wind);
    node.noiseBuf = noise; node.scrape = filter('bandpass', 1700, node.effects); mkLoop('scrapeNoise', noise, node.scrape);      // tyres scrubbing at the edge
    ctx.addEventListener('statechange', () => onState(state()));
  }
  function mkLoop(name, buffer, dest) {
    const source = ctx.createBufferSource(), gain = ctx.createGain(); gain.gain.value = 0;
    source.buffer = buffer; source.loop = true; source.connect(gain).connect(dest); source.start();
    loop[name] = {source, gain};
  }
  const DEST = {menu: 'music', musicDay: 'musicFilter', musicNight: 'musicFilter', forestDay: 'ambience', forestNight: 'ambience',
    cruise: 'engine', load: 'engine', idle: 'engine', sand: 'tyres', moss: 'tyres'};
  // Two files at a time, each retried: the local server refuses connections when many downloads start together.
  async function load() {
    if (loading) return; loading = true;
    const queue = Object.entries(files).filter(([name]) => !skip.includes(name)), pause = ms => new Promise(r => setTimeout(r, ms));
    const worker = async () => {
      for (let job; (job = queue.shift());) {
        const [name, file] = job;
        for (let attempt = 0; ; attempt++) {
          try {
            const r = await fetch(BASE + file); if (!r.ok) throw new Error(r.status + ' ' + file);
            buf[name] = await ctx.decodeAudioData(await r.arrayBuffer());
            if (DEST[name] || dest[name]) mkLoop(name, buf[name], node[DEST[name] || dest[name]]);
            break;
          } catch (e) { if (attempt >= 3) { failed.push(file); console.warn('sound not loaded:', file, e); break; } await pause(500 * (attempt + 1)); }
        }
        onState(state());
      }
    };
    await Promise.all([worker(), worker()]);
  }
  function one(name, gain) {
    if (!buf[name] || ctx?.state !== 'running' || !enabled) return;
    const s = ctx.createBufferSource(), g = ctx.createGain(); s.buffer = buf[name]; g.gain.value = gain;
    s.connect(g).connect(node.effects); s.onended = () => { s.disconnect(); g.disconnect(); }; s.start();
  }
  // Needs a user gesture the first time (or one carried over from the opening page's Start button).
  // start(false) only opens the audio output (do it right away, while the Start click still counts); the files load on start().
  async function start(loadNow = true) {
    if (!AC) return state();
    if (!ctx) init();
    if (enabled && ctx.state !== 'running') { try { await ctx.resume(); } catch {} }
    if (ctx.state === 'running') { node.master.gain.setTargetAtTime(enabled ? 0.8 : 0, ctx.currentTime, 0.05); if (loadNow) load(); }
    onState(state()); return state();
  }
  function setEnabled(on) {
    enabled = !!on;
    if (!ctx) { if (enabled) start(); return; }
    if (enabled) start(); else { node.master.gain.setTargetAtTime(0, ctx.currentTime, 0.04); setTimeout(() => { if (!enabled) ctx.suspend().catch(() => {}); }, 200); }
    onState(state());
  }
  document.addEventListener('visibilitychange', () => { if (!ctx) return; if (document.hidden) ctx.suspend().catch(() => {}); else if (enabled) start(); });

  // s: {speed m/s, throttle 0..1, rpm 0..1 (engine revs in the current gear; without it the pitch follows speed), scrub 0..1
  // (tyres sliding at the edge), active (riding view), from, to, p (world switch progress, 1 when settled)}
  function update(s) {
    if (!ctx || ctx.state !== 'running' || !enabled) return;
    const t = ctx.currentTime; if (t - last < 0.05) return; last = t;
    const set = (name, v, tc = 0.1) => loop[name]?.gain.gain.setTargetAtTime(v, t, tc), rate = (name, v) => loop[name]?.source.playbackRate.setTargetAtTime(v, t, 0.1);
    const moving = s.from !== s.to && s.p < 1, q = moving ? clamp(s.p) : 1;
    const lin = id => (s.to === id ? q : 0) + (moving && s.from === id ? 1 - q : 0);                        // tyres and engine colour: straight crossfade
    const out = Math.cos(Math.min(1, q * 2) * Math.PI / 2), inn = Math.sin(Math.max(0, q * 2 - 1) * Math.PI / 2);
    const mus = id => moving ? (s.to === id ? inn : s.from === id ? out : 0) : +(s.to === id);              // music: the old bed leaves before the new one arrives
    const on = s.active ? 1 : 0, e = clamp(Math.abs(s.speed || 0) / 9), thr = clamp(s.throttle), wn = lin('night');
    const rev = s.rpm == null ? e : clamp(s.rpm), fast = clamp(Math.abs(s.speed || 0) / 28), scrub = clamp(s.scrub);
    const W = {desert: lin('desert'), day: lin('day'), night: wn}, bike = k => BIKE.desert[k] * W.desert + BIKE.day[k] * W.day + BIKE.night[k] * W.night, bike2 = (k, i) => BIKE.desert[k][i] * W.desert + BIKE.day[k][i] * W.day + BIKE.night[k][i] * W.night;
    const G = bike('gain'), r0 = bike2('rate', 0), r1 = bike2('rate', 1);
    if (on && !engineStarted && buf.start) { engineStarted = true; one('start', 0.5); }
    if (wasMoving && e < 0.03) { one('brake', 0.3); wasMoving = false; } else if (e > 0.3) wasMoving = true;
    set('idle', on * G * (1 - Math.min(1, e * 4))); rate('idle', Math.max(0.4, r0 / 0.85));
    set('cruise', on * G * Math.min(1, e * 4) * (1 - thr * 0.5)); rate('cruise', Math.max(0.4, r0 + rev * r1 * 1.25));
    set('load', on * G * 0.9 * thr * Math.min(1, e * 3)); rate('load', Math.max(0.4, r0 + thr * 0.2 + rev * r1 * 0.7));
    set('sand', on * (e + scrub * 0.8) * bike('sand')); rate('sand', 0.9 + e * 0.35 + fast * 0.3);
    set('moss', on * (e + scrub * 0.8) * bike('moss')); rate('moss', 0.85 + e * 0.3 + fast * 0.3);
    // worlds with their own vehicle: its cruise loop also serves as the idle (lower and quieter), its load loop comes in with
    // throttle, its surface loop with speed; the shared loops above are silent there because their weights are zero
    let windSet = 0, f0 = bike2('filt', 0), f1 = bike2('filt', 1);
    for (const k of sets) {
      const w = lin(k), c = SETS[k], go = Math.min(1, e * 4);
      set('cruise_' + k, on * w * c.gain * (c.idle[0] * (1 - go) + go * (1 - thr * 0.5)));
      rate('cruise_' + k, (c.rate[0] + rev * c.rate[1] * 1.25) * (c.idle[1] + (1 - c.idle[1]) * go));
      set('load_' + k, on * w * c.gain * 0.9 * thr * Math.min(1, e * 3)); rate('load_' + k, c.rate[0] + thr * 0.2 + rev * c.rate[1] * 0.7);
      set('surface_' + k, on * w * (e + scrub * 0.8) * c.surf); rate('surface_' + k, 0.9 + e * 0.3 + fast * 0.3);
      set('music_' + k, mus(k), 0.06);
      windSet += w * c.wind; f0 += w * c.filt[0]; f1 += w * c.filt[1];
    }
    set('windNoise', on * Math.max(e, fast * 2.6) * (bike('wind') + windSet)); set('scrapeNoise', on * scrub * 0.22, 0.05);
    node.wind.frequency.setTargetAtTime(650 + e * 900 + fast * 1500, t, 0.1); node.engine.frequency.setTargetAtTime(Math.max(600, f0 + thr * f1), t, 0.1);
    set('menu', 0.75 * mus('desert') * (1 - e * 0.35), 0.06);
    set('musicDay', mus('day'), 0.06); set('musicNight', mus('night'), 0.06);
    node.musicGain.gain.setTargetAtTime(e > 0.03 ? 0.75 : 0.55, t, 1.2); node.musicFilter.frequency.setTargetAtTime(5500 + e * 8500, t, 1.2);
    set('forestDay', lin('day'), 0.06); set('forestNight', wn, 0.06);
  }
  const cue = to => one(to === 'night' || to === 'cyberpunk' ? 'toNight' : 'toDay', 0.45);
  // A stone hit: a short low thud (filtered noise and a falling tone), strength 0..1. Made here, no sound file.
  function hit(strength) {
    if (!ctx || ctx.state !== 'running' || !enabled || !node.noiseBuf) return;
    const t = ctx.currentTime, k = clamp(strength, 0.15, 1), src = ctx.createBufferSource(), lp = ctx.createBiquadFilter(), g = ctx.createGain(), osc = ctx.createOscillator(), og = ctx.createGain();
    src.buffer = node.noiseBuf; lp.type = 'lowpass'; lp.frequency.value = 500 + 900 * k;
    g.gain.setValueAtTime(0.9 * k, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.12 + 0.2 * k);
    osc.frequency.setValueAtTime(95, t); osc.frequency.exponentialRampToValueAtTime(42, t + 0.2); og.gain.setValueAtTime(0.7 * k, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    src.connect(lp).connect(g).connect(node.effects); osc.connect(og).connect(node.effects);
    src.start(t, Math.random()); src.stop(t + 0.4); osc.start(t); osc.stop(t + 0.3);
    src.onended = () => { src.disconnect(); lp.disconnect(); g.disconnect(); osc.disconnect(); og.disconnect(); };
  }
  // What is sounding right now: each loop's gain, the engine pitch and brightness, and the output level (RMS of the last 2048 samples).
  function levels() {
    if (!ctx) return null;
    const r = v => Math.round(v * 1000) / 1000, out = {};
    for (const [k, l] of Object.entries(loop)) out[k] = r(l.gain.gain.value);
    const d = new Float32Array(node.meter.fftSize); node.meter.getFloatTimeDomainData(d);
    return {gains: out, enginePitch: r(loop.cruise?.source.playbackRate.value ?? 0), engineLowpassHz: Math.round(node.engine.frequency.value), outputRms: r(Math.sqrt(d.reduce((a, v) => a + v * v, 0) / d.length))};
  }
  return {start, setEnabled, update, cue, hit, state, levels, get enabled() { return enabled; }};
}
