import type { Host, Scene } from '../host';
import { unlockedLevel } from '../progress';
import { Rng, hashSeed } from '../rng';
import { Biome, LEVELS_PER_BIOME, biome, biomeOfLevel, isBossLevel } from '../world';
import { EMOJI_FONT, FONT, Rect, drawButton, inside, roundRect, shade } from '../util';

/** World-space distance between two checkpoints. */
const SPACING = 118;
const NODE_R = 25;
const WALK_MS = 1000;

interface Point {
  x: number;
  y: number;
}

interface Decor {
  level: number;
  dx: number;
  dy: number;
  size: number;
  emoji: string;
}

/**
 * The overworld: an endless winding path that climbs upwards through themed biomes.
 * Every level is a checkpoint on the path; the player's avatar stands on the next open one.
 */
export class MapScene implements Scene {
  private readonly host: Host;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly unlocked: number;
  /** World y shown at the screen's anchor line. */
  private camY: number;
  private velocity = 0;
  private press: { x: number; y: number; lastY: number; lastT: number; dragging: boolean } | null = null;
  private walk: { from: number; to: number; start: number } | null = null;
  private toast: { text: string; at: number } | null = null;
  private decorCache = new Map<number, Decor[]>();
  private now = 0;
  private buttons = { play: { x: 0, y: 0, w: 0, h: 0 } as Rect, sound: { x: 0, y: 0, w: 0, h: 0 } as Rect };

  constructor(host: Host, walkFrom?: number) {
    this.host = host;
    this.ctx = host.ctx;
    this.unlocked = unlockedLevel();
    this.now = performance.now();
    if (walkFrom !== undefined && walkFrom + 1 === this.unlocked) {
      this.walk = { from: walkFrom, to: this.unlocked, start: this.now + 450 };
      this.camY = walkFrom * SPACING;
    } else {
      this.camY = this.unlocked * SPACING;
    }
    this.resize();
  }

  // -------------------------------------------------------------------------------------------
  // Geometry
  // -------------------------------------------------------------------------------------------

  private get anchorY(): number {
    return this.host.height * 0.56;
  }

  private nodeWorld(level: number): Point {
    const W = this.host.width;
    const amp = Math.min(W * 0.3, 150);
    const x = W / 2 + amp * (0.75 * Math.sin(level * 0.72) + 0.25 * Math.sin(level * 1.9 + 1));
    return { x, y: level * SPACING };
  }

  private toScreen(p: Point): Point {
    return { x: p.x, y: this.anchorY - (p.y - this.camY) };
  }

  private node(level: number): Point {
    return this.toScreen(this.nodeWorld(level));
  }

  private clampCamera(): void {
    const H = this.host.height;
    const min = SPACING - (H - this.anchorY) + 150;
    const max = (this.unlocked + 8) * SPACING;
    this.camY = Math.min(max, Math.max(min, this.camY));
  }

  resize(): void {
    const W = this.host.width;
    const H = this.host.height;
    const pw = Math.min(320, W - 40);
    this.buttons.play = { x: (W - pw) / 2, y: H - 86, w: pw, h: 62 };
    this.buttons.sound = { x: Math.min(W, 620 + (W - 620) / 2) - 14 - 38, y: 9, w: 38, h: 38 };
    if (W < 620) this.buttons.sound.x = W - 14 - 38;
    this.decorCache.clear();
    this.clampCamera();
  }

  // -------------------------------------------------------------------------------------------
  // Input
  // -------------------------------------------------------------------------------------------

  pointerDown(x: number, y: number): void {
    this.press = { x, y, lastY: y, lastT: performance.now(), dragging: false };
    this.velocity = 0;
  }

  pointerMove(_x: number, y: number): void {
    const p = this.press;
    if (!p) return;
    if (!p.dragging && Math.abs(y - p.y) > 8) p.dragging = true;
    if (p.dragging) {
      const t = performance.now();
      const dy = y - p.lastY;
      this.camY += dy;
      this.velocity = dy / Math.max(1, t - p.lastT);
      p.lastY = y;
      p.lastT = t;
      this.clampCamera();
    }
  }

  pointerUp(x: number, y: number): void {
    const p = this.press;
    this.press = null;
    if (!p) return;
    if (p.dragging) return;
    this.velocity = 0;
    this.tap(x, y);
  }

  wheel(dy: number): void {
    this.camY -= dy * 0.8;
    this.velocity = 0;
    this.clampCamera();
  }

  key(e: KeyboardEvent): void {
    if (e.key === 'Enter' || e.key === ' ') this.host.play(this.unlocked);
    else if (e.key === 'ArrowUp') this.camY += SPACING;
    else if (e.key === 'ArrowDown') this.camY -= SPACING;
    this.clampCamera();
  }

  private tap(x: number, y: number): void {
    if (inside(this.buttons.play, x, y)) return this.host.play(this.unlocked);
    if (inside(this.buttons.sound, x, y)) return this.host.toggleSound();
    const [lo, hi] = this.visibleLevels();
    for (let level = lo; level <= hi; level++) {
      const p = this.node(level);
      const r = (isBossLevel(level) ? NODE_R * 1.3 : NODE_R) + 10;
      if (Math.hypot(p.x - x, p.y - y) <= r) {
        if (level <= this.unlocked) this.host.play(level);
        else {
          this.toast = { text: `Schaffe zuerst Level ${this.unlocked}!`, at: this.now };
          this.host.sfx.denied();
        }
        return;
      }
    }
  }

  // -------------------------------------------------------------------------------------------
  // Frame
  // -------------------------------------------------------------------------------------------

  frame(dt: number): void {
    this.now = this.host.now;
    if (!this.press && Math.abs(this.velocity) > 0.01) {
      this.camY += this.velocity * dt;
      this.velocity *= Math.exp(-dt / 220);
      this.clampCamera();
    }
    const avatar = this.avatarWorld();
    if (this.walk) {
      // Camera follows the walking avatar.
      this.camY += (avatar.y - this.camY) * (1 - Math.exp(-dt / 160));
      if (this.now - this.walk.start >= WALK_MS) {
        this.walk = null;
        this.host.sfx.depleted();
      }
    }
    this.draw(avatar);
  }

  private visibleLevels(): [number, number] {
    const H = this.host.height;
    const top = this.camY + this.anchorY + SPACING;
    const bottom = this.camY - (H - this.anchorY) - SPACING;
    return [Math.max(1, Math.floor(bottom / SPACING)), Math.ceil(top / SPACING)];
  }

  private avatarWorld(): Point {
    if (!this.walk) return this.nodeWorld(this.unlocked);
    const t = Math.min(1, Math.max(0, (this.now - this.walk.start) / WALK_MS));
    const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
    const a = this.nodeWorld(this.walk.from);
    const b = this.nodeWorld(this.walk.to);
    return { x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e };
  }

  // -------------------------------------------------------------------------------------------
  // Drawing
  // -------------------------------------------------------------------------------------------

  private draw(avatar: Point): void {
    const { ctx } = this;
    const W = this.host.width;
    const H = this.host.height;
    const [lo, hi] = this.visibleLevels();

    this.drawGround(lo, hi, W, H);
    this.drawDecor(lo, hi);
    this.drawPath(lo, hi);
    this.drawBanners(lo, hi, W);
    for (let level = lo; level <= hi; level++) this.drawNode(level);
    this.drawAvatar(this.toScreen(avatar));

    // Top bar.
    const grad = ctx.createLinearGradient(0, 0, 0, 70);
    grad.addColorStop(0, 'rgba(10,12,30,0.75)');
    grad.addColorStop(1, 'rgba(10,12,30,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, 70);
    const left = W < 620 ? 14 : (W - 620) / 2 + 14;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = `900 24px ${FONT}`;
    const title = 'PIXEL FLOW';
    const colors = ['#ff4d5e', '#ff9f1c', '#ffd93d', '#5bd75b', '#2ec4f1', '#3a6df0', '#9b5de5', '#ff70c8'];
    let x = left;
    ctx.lineWidth = 5;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#121429';
    for (let i = 0; i < title.length; i++) {
      const ch = title[i];
      ctx.strokeText(ch, x, 28);
      ctx.fillStyle = ch === ' ' ? '#fff' : colors[i % colors.length];
      ctx.fillText(ch, x, 28);
      x += ctx.measureText(ch).width + 1;
    }
    drawButton(ctx, this.buttons.sound, this.host.sfx.muted ? '×' : '♪', false, 'rgba(18,20,41,0.8)');

    // Bottom play button.
    const b = this.buttons.play;
    const pulse = 1 + Math.sin(this.now / 300) * 0.02;
    const cur = biomeOfLevel(this.unlocked);
    ctx.save();
    ctx.translate(b.x + b.w / 2, b.y + b.h / 2);
    ctx.scale(pulse, pulse);
    ctx.fillStyle = '#2f9e44';
    roundRect(ctx, -b.w / 2, -b.h / 2 + 5, b.w, b.h, 22);
    ctx.fill();
    ctx.fillStyle = '#5bd75b';
    roundRect(ctx, -b.w / 2, -b.h / 2, b.w, b.h, 22);
    ctx.fill();
    ctx.fillStyle = '#121429';
    ctx.textAlign = 'center';
    ctx.font = `900 21px ${FONT}`;
    ctx.fillText(`▶  Level ${this.unlocked}`, 0, -7);
    ctx.font = `700 12px ${FONT}`;
    ctx.fillStyle = 'rgba(18,20,41,0.75)';
    ctx.fillText(`${cur.theme.icon} ${cur.name}`, 0, 15);
    ctx.restore();

    if (this.toast) {
      const t = (this.now - this.toast.at) / 1500;
      if (t >= 1) this.toast = null;
      else {
        ctx.globalAlpha = t < 0.8 ? 1 : (1 - t) / 0.2;
        ctx.font = `700 15px ${FONT}`;
        const w = ctx.measureText(this.toast.text).width + 28;
        ctx.fillStyle = '#ff4d5e';
        roundRect(ctx, W / 2 - w / 2, H - 132, w, 32, 16);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'center';
        ctx.fillText(this.toast.text, W / 2, H - 115);
        ctx.globalAlpha = 1;
      }
    }
  }

  private biomeRange(lo: number, hi: number): Biome[] {
    const out: Biome[] = [];
    const first = biomeOfLevel(lo).index;
    const last = biomeOfLevel(hi).index;
    for (let i = first; i <= last; i++) out.push(biome(i));
    return out;
  }

  private drawGround(lo: number, hi: number, W: number, H: number): void {
    const { ctx } = this;
    ctx.fillStyle = biomeOfLevel(lo).theme.ground[0];
    ctx.fillRect(0, 0, W, H);
    const biomes = this.biomeRange(Math.max(1, lo - 1), hi + 1);
    for (const b of biomes) {
      const top = this.toScreen({ x: 0, y: (b.lastLevel + 0.5) * SPACING }).y;
      const bottom = b.index === 0 ? H : this.toScreen({ x: 0, y: (b.firstLevel - 0.5) * SPACING }).y;
      ctx.fillStyle = b.theme.ground[0];
      ctx.fillRect(0, top, W, bottom - top);
      // Texture blobs.
      ctx.fillStyle = b.theme.ground[1];
      for (let level = Math.max(b.firstLevel, lo); level <= Math.min(b.lastLevel, hi); level++) {
        const rng = new Rng(hashSeed(level, 0x6a55));
        for (let i = 0; i < 5; i++) {
          const p = this.toScreen({ x: rng.range(0, W), y: level * SPACING + rng.range(-SPACING / 2, SPACING / 2) });
          ctx.beginPath();
          ctx.ellipse(p.x, p.y, rng.range(10, 30), rng.range(5, 12), 0, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    // Soft transitions between biomes.
    for (const b of biomes) {
      if (b.index === 0) continue;
      const prev = biome(b.index - 1);
      const y = this.toScreen({ x: 0, y: (b.firstLevel - 0.5) * SPACING }).y;
      const g = ctx.createLinearGradient(0, y + 50, 0, y - 50);
      g.addColorStop(0, prev.theme.ground[0]);
      g.addColorStop(1, b.theme.ground[0]);
      ctx.fillStyle = g;
      ctx.fillRect(0, y - 50, W, 100);
    }
  }

  private decorFor(level: number): Decor[] {
    let list = this.decorCache.get(level);
    if (list) return list;
    const W = this.host.width;
    const theme = biomeOfLevel(level).theme;
    const rng = new Rng(hashSeed(level, 0xdec0));
    const nx = this.nodeWorld(level).x;
    list = [];
    for (let i = 0; i < 3; i++) {
      let side = rng.chance(0.5) ? -1 : 1;
      const dist = 75 + rng.range(0, W * 0.3);
      if (nx + side * dist < 20 || nx + side * dist > W - 20) side = -side;
      const x = Math.min(W - 20, Math.max(20, nx + side * dist));
      list.push({ level, dx: x, dy: rng.range(-SPACING / 2, SPACING / 2), size: rng.range(22, 40), emoji: rng.pick(theme.decor) });
    }
    this.decorCache.set(level, list);
    return list;
  }

  private drawDecor(lo: number, hi: number): void {
    const { ctx } = this;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let level = lo; level <= hi; level++) {
      for (const d of this.decorFor(level)) {
        const p = this.toScreen({ x: d.dx, y: level * SPACING + d.dy });
        ctx.fillStyle = 'rgba(0,0,0,0.12)';
        ctx.beginPath();
        ctx.ellipse(p.x, p.y + d.size * 0.45, d.size * 0.4, d.size * 0.12, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.font = `${Math.round(d.size)}px ${EMOJI_FONT}`;
        // Chrome applies the fill color's alpha to color emoji, so reset it.
        ctx.fillStyle = '#000';
        ctx.fillText(d.emoji, p.x, p.y);
      }
    }
  }

  private drawPath(lo: number, hi: number): void {
    const { ctx } = this;
    const from = Math.max(1, lo - 1);
    const pts: Point[] = [];
    for (let l = from; l <= hi + 1; l++) pts.push(this.node(l));
    const mid = (a: Point, b: Point) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Each segment around node i is colored by node i's biome.
    const segment = (i: number) => {
      const level = from + i;
      const start = i === 0 && level === 1 ? pts[0] : mid(pts[Math.max(0, i - 1)], pts[i]);
      const end = i + 1 < pts.length ? mid(pts[i], pts[i + 1]) : pts[i];
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.quadraticCurveTo(pts[i].x, pts[i].y, end.x, end.y);
    };
    for (const [width, colorOf] of [
      [34, (l: number) => shade(biomeOfLevel(l).theme.path, -0.35)],
      [24, (l: number) => biomeOfLevel(l).theme.path],
    ] as const) {
      for (let i = 0; i < pts.length; i++) {
        segment(i);
        ctx.strokeStyle = colorOf(from + i);
        ctx.lineWidth = width;
        ctx.stroke();
      }
    }
    // Footsteps on the part of the path that's already done.
    ctx.setLineDash([2, 12]);
    ctx.lineWidth = 6;
    ctx.strokeStyle = 'rgba(90,60,30,0.35)';
    for (let i = 0; i < pts.length; i++) {
      if (from + i >= this.unlocked) break;
      segment(i);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  private drawNode(level: number): void {
    const { ctx } = this;
    const p = this.node(level);
    const b = biomeOfLevel(level);
    const boss = isBossLevel(level);
    const r = boss ? NODE_R * 1.3 : NODE_R;
    const done = level < this.unlocked;
    const current = level === this.unlocked;

    // Shadow + base.
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.ellipse(p.x, p.y + r * 0.55, r * 1.05, r * 0.45, 0, 0, Math.PI * 2);
    ctx.fill();

    if (current) {
      const pulse = (this.now % 1400) / 1400;
      ctx.strokeStyle = `rgba(255,255,255,${1 - pulse})`;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r + 6 + pulse * 14, 0, Math.PI * 2);
      ctx.stroke();
    }

    const fill = done ? b.theme.accent : current ? '#ffffff' : '#7d7f99';
    ctx.fillStyle = shade(done || current ? fill : '#7d7f99', -0.35);
    ctx.beginPath();
    ctx.arc(p.x, p.y + 4, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = done ? '#ffffff' : current ? b.theme.accent : 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `900 ${boss ? 20 : 17}px ${FONT}`;
    ctx.lineWidth = 4;
    ctx.strokeStyle = done ? 'rgba(18,20,41,0.6)' : 'transparent';
    if (done) ctx.strokeText(String(level), p.x, p.y + 1);
    ctx.fillStyle = done ? '#ffffff' : current ? '#121429' : 'rgba(255,255,255,0.75)';
    ctx.fillText(String(level), p.x, p.y + 1);

    if (done) {
      // Small check badge.
      ctx.fillStyle = '#5bd75b';
      ctx.beginPath();
      ctx.arc(p.x + r * 0.75, p.y - r * 0.7, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(p.x + r * 0.75 - 4, p.y - r * 0.7);
      ctx.lineTo(p.x + r * 0.75 - 1, p.y - r * 0.7 + 3);
      ctx.lineTo(p.x + r * 0.75 + 4, p.y - r * 0.7 - 3);
      ctx.stroke();
    }
    if (boss) {
      ctx.font = `22px ${EMOJI_FONT}`;
      ctx.fillStyle = '#000';
      ctx.fillText('👑', p.x, p.y - r - 10);
    }
  }

  private drawBanners(lo: number, hi: number, W: number): void {
    const { ctx } = this;
    for (const b of this.biomeRange(Math.max(1, lo - 1), hi + 1)) {
      const y = this.toScreen({ x: 0, y: (b.firstLevel - 0.5) * SPACING }).y;
      if (b.index === 0) continue;
      const w = Math.min(260, W - 40);
      const h = 46;
      const x = (W - w) / 2;
      const locked = b.firstLevel > this.unlocked;
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      roundRect(ctx, x, y - h / 2 + 4, w, h, 14);
      ctx.fill();
      ctx.fillStyle = locked ? shade(b.theme.accent, -0.45) : shade(b.theme.accent, -0.2);
      roundRect(ctx, x, y - h / 2, w, h, 14);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#fff';
      ctx.font = `900 16px ${FONT}`;
      ctx.fillText(`${b.theme.icon} ${b.name}`, W / 2, y - 6);
      ctx.font = `700 11px ${FONT}`;
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.fillText(
        `Welt ${b.index + 1} · ${b.theme.title} · Level ${b.firstLevel}–${b.firstLevel + LEVELS_PER_BIOME - 1}`,
        W / 2,
        y + 12,
      );
    }
    // First biome: sign at the start of the path.
    const first = biome(0);
    const start = this.toScreen({ x: 0, y: 0.45 * SPACING });
    if (start.y < this.host.height + 40) {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `900 16px ${FONT}`;
      ctx.lineWidth = 5;
      ctx.strokeStyle = 'rgba(18,20,41,0.7)';
      ctx.strokeText(`${first.theme.icon} ${first.name}`, W / 2, start.y);
      ctx.fillStyle = '#fff';
      ctx.fillText(`${first.theme.icon} ${first.name}`, W / 2, start.y);
    }
  }

  private drawAvatar(p: Point): void {
    const { ctx } = this;
    const walking = this.walk && this.now >= this.walk.start;
    const t = this.walk ? Math.min(1, Math.max(0, (this.now - this.walk.start) / WALK_MS)) : 0;
    const hop = walking ? Math.abs(Math.sin(t * Math.PI * 3)) * 16 : Math.abs(Math.sin(this.now / 350)) * 4;
    const size = 30;
    const x = p.x;
    const y = p.y - NODE_R - size / 2 - 4 - hop;

    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(p.x, p.y - NODE_R + 2, size * 0.45, size * 0.14, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#c99a00';
    roundRect(ctx, x - size / 2, y - size / 2 + 4, size, size, 9);
    ctx.fill();
    ctx.fillStyle = '#ffd93d';
    roundRect(ctx, x - size / 2, y - size / 2, size, size, 9);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    roundRect(ctx, x - size * 0.34, y - size * 0.4, size * 0.68, size * 0.18, 4);
    ctx.fill();
    // Eyes (blink every few seconds).
    const blink = this.now % 3200 < 120;
    ctx.fillStyle = '#121429';
    for (const ex of [-0.18, 0.18]) {
      if (blink) ctx.fillRect(x + ex * size - 3, y + 1, 6, 2);
      else {
        ctx.beginPath();
        ctx.arc(x + ex * size, y + 2, 3.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // Little flag on a stick.
    ctx.strokeStyle = '#5e3a22';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x + size / 2 + 2, y + size / 2);
    ctx.lineTo(x + size / 2 + 2, y - size / 2 - 10);
    ctx.stroke();
    ctx.fillStyle = '#ff4d5e';
    ctx.beginPath();
    ctx.moveTo(x + size / 2 + 3, y - size / 2 - 10);
    ctx.lineTo(x + size / 2 + 15, y - size / 2 - 5);
    ctx.lineTo(x + size / 2 + 3, y - size / 2);
    ctx.closePath();
    ctx.fill();
  }
}
