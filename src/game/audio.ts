// Tiny procedural WebAudio layer: sfx + ambient that muffles underwater.
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let filter: BiquadFilterNode | null = null;
let amb: GainNode | null = null;
let noise: AudioBuffer | null = null;

export function initAudio() {
  if (ctx || typeof window === "undefined") return;
  try {
    ctx = new AudioContext();
  } catch {
    return;
  }
  const len = ctx.sampleRate * 2;
  noise = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = noise.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    last = (last + 0.02 * w) / 1.02; // brown-ish
    d[i] = w * 0.5 + last * 3;
  }
  filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 18000;
  master = ctx.createGain();
  master.gain.value = 0.45;
  master.connect(filter);
  filter.connect(ctx.destination);
  const src = ctx.createBufferSource();
  src.buffer = noise;
  src.loop = true;
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 350;
  amb = ctx.createGain();
  amb.gain.value = 0.03;
  src.connect(lp).connect(amb).connect(filter);
  src.start();
}

export function setUnderwater(u: boolean) {
  if (!ctx || !filter || !amb) return;
  const t = ctx.currentTime;
  filter.frequency.setTargetAtTime(u ? 650 : 18000, t, 0.15);
  amb.gain.setTargetAtTime(u ? 0.4 : 0.03, t, 0.3);
}

type Kind = "splash" | "hit" | "break" | "place" | "boom" | "hiss";
export function sfx(kind: Kind, vol = 1) {
  if (!ctx || !master || !noise) return;
  const t = ctx.currentTime;
  const g = ctx.createGain();
  g.connect(master);
  const cfg = {
    splash: { f: 1100, type: "bandpass", dur: 0.45, v: 0.9 },
    hit: { f: 500, type: "lowpass", dur: 0.12, v: 1 },
    break: { f: 2500, type: "bandpass", dur: 0.1, v: 0.6 },
    place: { f: 900, type: "lowpass", dur: 0.06, v: 0.6 },
    boom: { f: 320, type: "lowpass", dur: 1.1, v: 1.6 },
    hiss: { f: 4000, type: "highpass", dur: 1.4, v: 0.25 },
  }[kind];
  const f = ctx.createBiquadFilter();
  f.type = cfg.type as BiquadFilterType;
  f.frequency.value = cfg.f;
  const src = ctx.createBufferSource();
  src.buffer = noise;
  src.connect(f).connect(g);
  g.gain.setValueAtTime(cfg.v * vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + cfg.dur);
  src.start(t, Math.random());
  src.stop(t + cfg.dur + 0.05);
  if (kind === "hit") {
    const o = ctx.createOscillator();
    o.type = "square";
    o.frequency.setValueAtTime(180, t);
    o.frequency.exponentialRampToValueAtTime(70, t + 0.12);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.15 * vol, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
    o.connect(og).connect(master);
    o.start(t);
    o.stop(t + 0.16);
  }
}
