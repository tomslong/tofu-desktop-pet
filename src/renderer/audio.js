/* Tiny synthesised sound kit. No audio files, no network. */
export class PetAudio {
  constructor(enabled = true) {
    this.enabled = Boolean(enabled);
    this.ctx = null;
    this.master = null;
  }

  setEnabled(value) {
    this.enabled = Boolean(value);
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(this.enabled ? 0.22 : 0, this.ctx.currentTime, 0.02);
    }
  }

  unlock() {
    if (!this.enabled) return null;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return null;
      this.ctx = new AudioCtx();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.22;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") this.ctx.resume().catch(() => {});
    return this.ctx;
  }

  tone(freq, duration = 0.08, options = {}) {
    if (!this.enabled) return;
    const ctx = this.unlock();
    if (!ctx) return;
    const { type = "square", volume = 0.06, delay = 0, slide = 0 } = options;
    const start = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), start + duration);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start(start);
    osc.stop(start + duration + 0.02);
  }

  noise(duration = 0.07, volume = 0.035) {
    if (!this.enabled) return;
    const ctx = this.unlock();
    if (!ctx) return;
    const frames = Math.floor(ctx.sampleRate * duration);
    const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i += 1) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
    }
    const src = ctx.createBufferSource();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 1400;
    gain.gain.value = volume;
    src.buffer = buffer;
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    src.start();
  }

  pet() {
    this.tone(660, 0.06, { type: "triangle", volume: 0.05 });
    this.tone(880, 0.09, { type: "triangle", volume: 0.045, delay: 0.055 });
  }

  feed() {
    this.noise(0.06, 0.05);
    this.tone(180, 0.08, { type: "square", volume: 0.035, slide: -70 });
    this.noise(0.05, 0.03);
  }

  play() {
    [523, 659, 784].forEach((freq, i) => {
      this.tone(freq, 0.07, { type: "square", volume: 0.035, delay: i * 0.055 });
    });
  }

  nap() {
    this.tone(392, 0.16, { type: "sine", volume: 0.05 });
    this.tone(262, 0.28, { type: "sine", volume: 0.04, delay: 0.14 });
  }

  done() {
    [523, 659, 784, 1046].forEach((freq, i) => {
      this.tone(freq, 0.1, { type: "triangle", volume: 0.04, delay: i * 0.07 });
    });
  }

  error() {
    this.tone(220, 0.12, { type: "sawtooth", volume: 0.028, slide: -70 });
    this.tone(147, 0.18, { type: "sawtooth", volume: 0.025, delay: 0.1 });
  }

  pop() {
    this.tone(980, 0.035, { type: "square", volume: 0.022 });
  }
}
