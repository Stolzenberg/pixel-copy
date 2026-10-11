/** Tiny synthesized sound effects (no asset files needed). */
export class Sfx {
  private ctx: AudioContext | null = null;
  private lastShot = 0;
  muted = false;

  /** Must be called from a user gesture so browsers allow audio. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    try {
      this.ctx = new AudioContext();
    } catch {
      this.ctx = null;
    }
  }

  private tone(freq: number, dur: number, type: OscillatorType, gain: number, delay = 0, slideTo?: number): void {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  shot(color: number): void {
    const now = performance.now();
    if (now - this.lastShot < 35) return;
    this.lastShot = now;
    this.tone(520 + color * 70 + Math.random() * 40, 0.07, 'square', 0.03);
  }

  launch(): void {
    this.tone(300, 0.12, 'triangle', 0.08, 0, 600);
  }

  park(): void {
    this.tone(500, 0.12, 'triangle', 0.06, 0, 260);
  }

  depleted(): void {
    this.tone(880, 0.1, 'sine', 0.06);
    this.tone(1320, 0.12, 'sine', 0.05, 0.06);
  }

  denied(): void {
    this.tone(160, 0.15, 'sawtooth', 0.05);
  }

  win(): void {
    [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.22, 'triangle', 0.09, i * 0.11));
  }

  lose(): void {
    [392, 330, 262, 196].forEach((f, i) => this.tone(f, 0.25, 'sawtooth', 0.05, i * 0.13));
  }
}
