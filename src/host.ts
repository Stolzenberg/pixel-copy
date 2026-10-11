import { Sfx } from './audio';
import { MapScene } from './scenes/map';
import { PlayScene } from './scenes/play';
import { storageGet, storageSet } from './util';

export interface Scene {
  resize(): void;
  /** Advance by `dt` milliseconds and draw the scene. */
  frame(dt: number): void;
  pointerDown(x: number, y: number): void;
  pointerMove?(x: number, y: number): void;
  pointerUp?(x: number, y: number): void;
  wheel?(dy: number): void;
  key(e: KeyboardEvent): void;
}

const STORAGE_MUTED = 'pixelflow:muted';

/** Owns the canvas, the main loop and input, and switches between the map and level scenes. */
export class Host {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  readonly sfx = new Sfx();
  width = 0;
  height = 0;
  dpr = 1;
  now = 0;
  private scene!: Scene;
  private last = 0;
  private fadeStart = -Infinity;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D wird nicht unterstützt');
    this.ctx = ctx;
    this.sfx.muted = storageGet(STORAGE_MUTED) === '1';
    this.measure();

    window.addEventListener('resize', () => {
      this.measure();
      this.scene.resize();
    });
    canvas.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.sfx.unlock();
      canvas.setPointerCapture?.(e.pointerId);
      this.scene.pointerDown(e.clientX, e.clientY);
    });
    canvas.addEventListener('pointermove', (e) => this.scene.pointerMove?.(e.clientX, e.clientY));
    canvas.addEventListener('pointerup', (e) => this.scene.pointerUp?.(e.clientX, e.clientY));
    canvas.addEventListener('pointercancel', (e) => this.scene.pointerUp?.(e.clientX, e.clientY));
    canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.scene.wheel?.(e.deltaY);
      },
      { passive: false },
    );
    window.addEventListener('keydown', (e) => {
      this.sfx.unlock();
      if (e.key === 'm' || e.key === 'M') this.toggleSound();
      else this.scene.key(e);
    });

    const fromUrl = Number(new URLSearchParams(location.search).get('level'));
    if (Number.isFinite(fromUrl) && fromUrl >= 1) this.play(Math.floor(fromUrl));
    else this.showMap();
    requestAnimationFrame((t) => this.frame(t));
  }

  showMap(walkFrom?: number): void {
    this.switchTo(new MapScene(this, walkFrom));
  }

  play(level: number): void {
    this.switchTo(new PlayScene(this, level));
  }

  toggleSound(): void {
    this.sfx.muted = !this.sfx.muted;
    storageSet(STORAGE_MUTED, this.sfx.muted ? '1' : '0');
  }

  private switchTo(scene: Scene): void {
    this.scene = scene;
    this.fadeStart = performance.now();
  }

  private measure(): void {
    this.dpr = Math.min(window.devicePixelRatio || 1, 3);
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;
  }

  private frame(t: number): void {
    const dt = Math.min(t - (this.last || t), 100);
    this.last = t;
    this.now = performance.now();
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.scene.frame(dt);
    // Short fade-in after every scene change.
    const f = (this.now - this.fadeStart) / 300;
    if (f < 1) {
      this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      this.ctx.fillStyle = `rgba(8,9,22,${1 - f})`;
      this.ctx.fillRect(0, 0, this.width, this.height);
    }
    requestAnimationFrame((tt) => this.frame(tt));
  }
}
