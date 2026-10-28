/**
 * Fully synthesized horror soundscape (WebAudio, no audio files needed).
 * Browsers only allow audio after a user gesture – call unlock() from a
 * pointer/key handler, or launch Chrome with
 * --autoplay-policy=no-user-gesture-required for unattended kiosks.
 */
export class HorrorAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private ambient: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private heartbeatTimer = 0;
  private whisperTimer = 0;
  private people = 0;
  private enabled = true;
  private muted = false;
  private volume = 0.6;

  get unlocked() {
    return !!this.ctx && this.ctx.state === "running";
  }

  unlock() {
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
      } catch {
        return;
      }
      this.build();
    }
    if (this.ctx.state === "suspended") this.ctx.resume().catch(() => {});
  }

  configure(enabled: boolean, muted: boolean, volume: number) {
    this.enabled = enabled;
    this.muted = muted;
    this.volume = volume;
    this.applyVolume();
  }

  private applyVolume() {
    if (!this.ctx || !this.master) return;
    const v = this.enabled && !this.muted ? this.volume : 0;
    this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.15);
  }

  private get live() {
    return !!this.ctx && this.ctx.state === "running" && this.enabled && !this.muted;
  }

  private build() {
    const ctx = this.ctx!;
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();
    this.master.connect(comp).connect(ctx.destination);

    // noise buffer
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    // ambient drone
    this.ambient = ctx.createGain();
    this.ambient.gain.value = 0.22;
    this.ambient.connect(this.master);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 220;
    lp.connect(this.ambient);
    for (const [f, type] of [
      [43.6, "sawtooth"],
      [46.2, "sawtooth"],
      [65.4, "triangle"],
    ] as [number, OscillatorType][]) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = 0.18;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.05 + Math.random() * 0.1;
      const lfoG = ctx.createGain();
      lfoG.gain.value = 0.1;
      lfo.connect(lfoG).connect(g.gain);
      o.connect(g).connect(lp);
      o.start();
      lfo.start();
    }
    // wind
    const wind = ctx.createBufferSource();
    wind.buffer = this.noise;
    wind.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 500;
    bp.Q.value = 0.8;
    const wlfo = ctx.createOscillator();
    wlfo.frequency.value = 0.08;
    const wlfoG = ctx.createGain();
    wlfoG.gain.value = 300;
    wlfo.connect(wlfoG).connect(bp.frequency);
    const wg = ctx.createGain();
    wg.gain.value = 0.12;
    wind.connect(bp).connect(wg).connect(this.ambient);
    wind.start();
    wlfo.start();

    this.applyVolume();
    this.scheduleWhispers();
  }

  setPeople(n: number) {
    const before = this.people;
    this.people = n;
    if (n > 0 && before === 0) this.startHeartbeat();
    if (n === 0) window.clearTimeout(this.heartbeatTimer);
    if (this.ctx && this.ambient) this.ambient.gain.setTargetAtTime(n > 0 ? 0.32 : 0.2, this.ctx.currentTime, 1.5);
  }

  private startHeartbeat() {
    window.clearTimeout(this.heartbeatTimer);
    const beat = () => {
      if (this.people === 0) return;
      this.thump(0);
      this.thump(0.22);
      this.heartbeatTimer = window.setTimeout(beat, 1100 - Math.min(400, this.people * 120));
    };
    beat();
  }

  private thump(delay: number) {
    if (!this.live) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(70, t);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.18);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.35, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
    o.connect(g).connect(this.master!);
    o.start(t);
    o.stop(t + 0.3);
  }

  private scheduleWhispers() {
    window.clearTimeout(this.whisperTimer);
    this.whisperTimer = window.setTimeout(() => {
      this.whisper();
      this.scheduleWhispers();
    }, 6000 + Math.random() * 12000);
  }

  private noiseBurst(freq: number, q: number, dur: number, gain: number, sweepTo?: number, delay = 0) {
    if (!this.live || !this.noise) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.Q.value = q;
    f.frequency.setValueAtTime(freq, t);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + dur * 0.3);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.random() * 2 - 1;
    src.connect(f).connect(g).connect(pan).connect(this.master!);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }

  whisper() {
    for (let i = 0; i < 5; i++) this.noiseBurst(2200 + Math.random() * 2500, 6, 0.25 + Math.random() * 0.3, 0.07, undefined, i * 0.18 + Math.random() * 0.1);
  }

  whoosh() {
    this.noiseBurst(300, 1.5, 1.1, 0.5, 2400);
  }

  exitWhoosh() {
    this.noiseBurst(1800, 1.2, 1.2, 0.35, 200);
  }

  /** dissonant string-like stinger for ghost spawns */
  stinger(intensity = 1) {
    if (!this.live) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const base = 220 * Math.pow(2, Math.floor(Math.random() * 5) / 12);
    for (const r of [1, 1.06, 1.414, 1.5]) {
      const o = ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.setValueAtTime(base * r, t);
      o.frequency.linearRampToValueAtTime(base * r * 0.97, t + 1.6);
      const f = ctx.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.value = 1800;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.05 * intensity, t + 0.05);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
      o.connect(f).connect(g).connect(this.master!);
      o.start(t);
      o.stop(t + 1.7);
    }
  }

  zap() {
    if (!this.live) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = "square";
    o.frequency.setValueAtTime(1600, t);
    o.frequency.exponentialRampToValueAtTime(60, t + 0.35);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.12, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
    o.connect(g).connect(this.master!);
    o.start(t);
    o.stop(t + 0.45);
    this.noiseBurst(4000, 0.7, 0.3, 0.25);
  }

  thunder() {
    if (!this.live || !this.noise) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.setValueAtTime(900, t);
    f.frequency.exponentialRampToValueAtTime(80, t + 2.5);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.6, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.8);
    src.connect(f).connect(g).connect(this.master!);
    src.start(t);
    src.stop(t + 3);
  }

  caw() {
    if (!this.live) return;
    const ctx = this.ctx!;
    for (let i = 0; i < 2; i++) {
      const t = ctx.currentTime + i * 0.38 + Math.random() * 0.05;
      const o = ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.setValueAtTime(520, t);
      o.frequency.exponentialRampToValueAtTime(360, t + 0.25);
      const f = ctx.createBiquadFilter();
      f.type = "bandpass";
      f.frequency.value = 1300;
      f.Q.value = 3;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.18, t + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
      o.connect(f).connect(g).connect(this.master!);
      o.start(t);
      o.stop(t + 0.3);
    }
  }

  flutter() {
    for (let i = 0; i < 8; i++) this.noiseBurst(900, 2, 0.06, 0.12, undefined, i * 0.07);
  }

  dispose() {
    window.clearTimeout(this.heartbeatTimer);
    window.clearTimeout(this.whisperTimer);
    this.ctx?.close().catch(() => {});
    this.ctx = null;
  }
}
