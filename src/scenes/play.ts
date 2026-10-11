import { EMPTY, Facing, Game, GameEvent, Shooter } from '../game';
import type { Host, Scene } from '../host';
import { generateLevel } from '../levelgen';
import { completeLevel } from '../progress';
import { Biome, biomeOfLevel } from '../world';
import { FONT, Rect, drawButton, inside, roundRect, shade, storageGet, storageSet } from '../util';

/** Milliseconds per simulation step at normal speed. */
const TICK_MS = 70;
const STORAGE_FAST = 'pixelflow:fast';

const THEME = {
  panel: '#262b52',
  panelLight: '#323867',
  board: '#454d80',
  belt: '#0d0f22',
  beltLine: '#3b4277',
  text: '#f5f6ff',
  textDim: '#aab0dd',
  accent: '#ffd93d',
  danger: '#ff4d5e',
  good: '#5bd75b',
  dark: '#121429',
};

interface Layout {
  width: number;
  height: number;
  cell: number;
  boardX: number;
  boardY: number;
  beltW: number;
  gap: number;
  /** Rectangle the belt's center line runs along. */
  belt: Rect;
  shooterSize: number;
  beltShooterSize: number;
  capacity: Rect;
  slots: Rect[];
  columns: Rect[];
  queueRows: number;
  queueStep: number;
  hud: Rect;
  buttons: { map: Rect; speed: Rect; sound: Rect; restart: Rect };
}

interface Visual {
  x: number;
  y: number;
  shake: number;
  pop: number;
}

interface Projectile {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  start: number;
  dur: number;
  color: string;
}

interface Dying {
  cell: number;
  color: string;
  hitAt: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  color: string;
}

interface Ring {
  x: number;
  y: number;
  start: number;
  color: string;
}

type Overlay = { kind: 'won' | 'lost'; at: number } | null;

const FACING_ANGLE: Record<Facing, number> = {
  [Facing.None]: 0,
  [Facing.Up]: -Math.PI / 2,
  [Facing.Left]: Math.PI,
  [Facing.Down]: Math.PI / 2,
  [Facing.Right]: 0,
};

export class PlayScene implements Scene {
  private readonly host: Host;
  private readonly ctx: CanvasRenderingContext2D;
  private game!: Game;
  private level: number;
  private biome: Biome;
  private layout!: Layout;
  private visuals = new Map<number, Visual>();
  private projectiles: Projectile[] = [];
  private dying: Dying[] = [];
  private particles: Particle[] = [];
  private rings: Ring[] = [];
  private overlay: Overlay = null;
  private overlayButtons: { rect: Rect; action: () => void }[] = [];
  private acc = 0;
  private now = 0;
  private fast = false;
  private levelStart = 0;
  private launches = 0;
  private toast: { text: string; at: number } | null = null;

  constructor(host: Host, level: number) {
    this.host = host;
    this.ctx = host.ctx;
    this.level = level;
    this.biome = biomeOfLevel(level);
    this.fast = storageGet(STORAGE_FAST) === '1';
    this.startLevel(level);
    this.resize();
  }

  private get sfx() {
    return this.host.sfx;
  }

  // -------------------------------------------------------------------------------------------
  // Level lifecycle
  // -------------------------------------------------------------------------------------------

  private startLevel(level: number): void {
    this.level = level;
    this.biome = biomeOfLevel(level);
    this.game = new Game(generateLevel(level));
    this.visuals.clear();
    this.projectiles = [];
    this.dying = [];
    this.particles = [];
    this.rings = [];
    this.overlay = null;
    this.overlayButtons = [];
    this.acc = 0;
    this.launches = 0;
    this.levelStart = performance.now();
    if (this.layout) this.layout = this.computeLayout();
  }

  private restart(): void {
    this.startLevel(this.level);
  }

  // -------------------------------------------------------------------------------------------
  // Layout
  // -------------------------------------------------------------------------------------------

  resize(): void {
    this.layout = this.computeLayout();
  }

  private computeLayout(): Layout {
    const W = this.host.width;
    const H = this.host.height;
    const g = this.game;
    const pad = 14;
    const hudH = 56;
    const landscape = W >= H * 1.15 && W >= 720;
    const contentW = Math.min(W, landscape ? 1280 : 620);
    const x0 = (W - contentW) / 2;
    const nSlots = g.slots.length;
    const nCols = g.queues.length;

    let S: number;
    let boardArea: Rect;
    let panel: Rect;
    if (landscape) {
      const panelW = Math.min(Math.max(contentW * 0.34, 300), 440);
      S = Math.min(Math.max(Math.min(panelW / 6.3, H / 9.5), 34), 68);
      boardArea = { x: x0 + pad, y: hudH + 6, w: contentW - panelW - pad * 3, h: H - hudH - 6 - pad };
      panel = { x: x0 + contentW - panelW - pad, y: hudH + 10, w: panelW, h: H - hudH - 10 - pad };
    } else {
      S = Math.min(Math.max(Math.min(contentW / 6.6, H / 12.5), 30), 62);
      const panelH = 22 + (S + 18) + S * 1.12 * 2 + S + 30;
      boardArea = { x: x0 + pad, y: hudH + 4, w: contentW - pad * 2, h: H - hudH - 4 - panelH - pad };
      panel = { x: x0 + pad, y: boardArea.y + boardArea.h + 4, w: contentW - pad * 2, h: panelH };
    }

    const beltW = Math.min(Math.max(S * 0.62, 22), 40);
    const gap = 6;
    const ring = 2 * (gap + beltW);
    const cell = Math.max(4, Math.min((boardArea.w - ring) / g.width, (boardArea.h - ring) / g.height, 42));
    const boardW = cell * g.width;
    const boardH = cell * g.height;
    const boardX = boardArea.x + (boardArea.w - boardW) / 2;
    let boardY = boardArea.y + (boardArea.h - boardH) / 2;
    if (!landscape) {
      // Keep board and controls together and center the whole stack vertically.
      const slack = Math.max(0, boardArea.h - boardH - ring);
      boardY = boardArea.y + ring / 2 + slack / 2;
      panel.y = boardArea.y + boardH + ring + slack / 2 + 4;
    }
    const off = gap + beltW / 2;
    const belt = { x: boardX - off, y: boardY - off, w: boardW + off * 2, h: boardH + off * 2 };

    // Panel: capacity indicator, waiting slots, queue columns.
    let y = panel.y;
    const capacity = { x: panel.x, y, w: panel.w, h: 22 };
    y += 26;
    const slotSize = Math.min(S, (panel.w - (nSlots - 1) * 8) / nSlots);
    const slotsW = nSlots * slotSize + (nSlots - 1) * 8;
    const slots = Array.from({ length: nSlots }, (_, i) => ({
      x: panel.x + (panel.w - slotsW) / 2 + i * (slotSize + 8),
      y,
      w: slotSize,
      h: slotSize,
    }));
    y += slotSize + 18;
    const queueStep = S * 1.12;
    const colW = Math.min(S * 1.5, panel.w / nCols);
    const colsW = colW * nCols;
    const queueH = panel.y + panel.h - y;
    const queueRows = Math.max(2, Math.min(landscape ? 7 : 3, Math.floor((queueH - S - 24) / queueStep) + 1));
    const columns = Array.from({ length: nCols }, (_, i) => ({
      x: panel.x + (panel.w - colsW) / 2 + i * colW,
      y,
      w: colW,
      h: queueH,
    }));

    const bs = 38;
    const by = (hudH - bs) / 2;
    const right = x0 + contentW - pad;
    return {
      width: W,
      height: H,
      cell,
      boardX,
      boardY,
      beltW,
      gap,
      belt,
      shooterSize: S,
      beltShooterSize: Math.min(beltW * 0.88, S),
      capacity,
      slots,
      columns,
      queueRows,
      queueStep,
      hud: { x: x0 + pad, y: 0, w: contentW - pad * 2, h: hudH },
      buttons: {
        restart: { x: right - bs, y: by, w: bs, h: bs },
        sound: { x: right - bs * 2 - 8, y: by, w: bs, h: bs },
        speed: { x: right - bs * 3 - 16, y: by, w: bs, h: bs },
        map: { x: x0 + pad, y: by, w: bs, h: bs },
      },
    };
  }

  /** Screen position of a (fractional) belt path position. */
  private pathPoint(pos: number): { x: number; y: number } {
    const L = this.game.pathLength;
    const i0 = ((Math.floor(pos) % L) + L) % L;
    const i1 = (i0 + 1) % L;
    const f = pos - Math.floor(pos);
    const a = this.stepPoint(i0);
    const b = this.stepPoint(i1);
    return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
  }

  private stepPoint(i: number): { x: number; y: number } {
    const { belt, cell, boardX, boardY } = this.layout;
    const step = this.game.path[i];
    const x = step.x < 0 ? belt.x : step.x >= this.game.width ? belt.x + belt.w : boardX + (step.x + 0.5) * cell;
    const y = step.y < 0 ? belt.y : step.y >= this.game.height ? belt.y + belt.h : boardY + (step.y + 0.5) * cell;
    return { x, y };
  }

  private cellCenter(cell: number): { x: number; y: number } {
    const { cell: cs, boardX, boardY } = this.layout;
    const x = cell % this.game.width;
    const y = Math.floor(cell / this.game.width);
    return { x: boardX + (x + 0.5) * cs, y: boardY + (y + 0.5) * cs };
  }

  private queuePoint(column: number, index: number): { x: number; y: number } {
    const col = this.layout.columns[column];
    const S = this.layout.shooterSize;
    return { x: col.x + col.w / 2, y: col.y + S / 2 + Math.min(index, this.layout.queueRows) * this.layout.queueStep };
  }

  private targetPoint(s: Shooter, alpha: number): { x: number; y: number } {
    switch (s.place) {
      case 'belt':
        return this.pathPoint(s.pos + (this.game.status === 'playing' ? alpha : 0));
      case 'pending':
        return this.stepPoint(0);
      case 'slot': {
        const i = this.game.slots.indexOf(s);
        const r = this.layout.slots[i];
        return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
      }
      case 'queue': {
        for (let c = 0; c < this.game.queues.length; c++) {
          const i = this.game.queues[c].indexOf(s);
          if (i >= 0) return this.queuePoint(c, i);
        }
        return { x: 0, y: 0 };
      }
      default: {
        const v = this.visuals.get(s.id);
        return v ? { x: v.x, y: v.y } : { x: 0, y: 0 };
      }
    }
  }

  private visual(s: Shooter): Visual {
    let v = this.visuals.get(s.id);
    if (!v) {
      const p = this.targetPoint(s, 0);
      v = { x: p.x, y: p.y, shake: 0, pop: 0 };
      this.visuals.set(s.id, v);
    }
    return v;
  }

  // -------------------------------------------------------------------------------------------
  // Input
  // -------------------------------------------------------------------------------------------

  pointerDown(x: number, y: number): void {
    const L = this.layout;
    if (this.overlay) {
      if (this.now < this.overlay.at) return;
      for (const b of this.overlayButtons) if (inside(b.rect, x, y)) return b.action();
      return;
    }
    if (inside(L.buttons.map, x, y)) return this.host.showMap();
    if (inside(L.buttons.restart, x, y)) return this.restart();
    if (inside(L.buttons.sound, x, y)) return this.host.toggleSound();
    if (inside(L.buttons.speed, x, y)) return this.toggleSpeed();

    for (let i = 0; i < L.slots.length; i++) {
      if (inside(L.slots[i], x, y)) return this.tapSlot(i);
    }
    for (let c = 0; c < L.columns.length; c++) {
      if (inside(L.columns[c], x, y)) return this.tapColumn(c);
    }
  }

  key(e: KeyboardEvent): void {
    if (this.overlay) {
      if ((e.key === 'Enter' || e.key === ' ') && this.now >= this.overlay.at) this.overlayButtons[0]?.action();
      else if (e.key === 'Escape') this.host.showMap();
      return;
    }
    if (e.key === 'Escape') return this.host.showMap();
    const n = Number(e.key);
    if (n >= 1 && n <= 9 && n <= this.game.queues.length) this.tapColumn(n - 1);
    else if (e.key === 'r' || e.key === 'R') this.restart();
    else if (e.key === 'f' || e.key === 'F') this.toggleSpeed();
  }

  private toggleSpeed(): void {
    this.fast = !this.fast;
    storageSet(STORAGE_FAST, this.fast ? '1' : '0');
  }

  private tapColumn(c: number): void {
    const front = this.game.queues[c]?.[0];
    if (!front) return;
    if (this.game.launchFromQueue(c)) {
      this.launches++;
      return;
    }
    this.deny(front);
  }

  private tapSlot(i: number): void {
    const s = this.game.slots[i];
    if (!s) return;
    if (this.game.launchFromSlot(i)) {
      this.launches++;
      return;
    }
    this.deny(s);
  }

  private deny(s: Shooter): void {
    this.visual(s).shake = 1;
    this.sfx.denied();
    if (this.game.beltLoad >= this.game.def.beltCapacity) this.toast = { text: 'Das Band ist voll!', at: this.now };
  }

  // -------------------------------------------------------------------------------------------
  // Simulation + events
  // -------------------------------------------------------------------------------------------

  frame(dt: number): void {
    this.now = this.host.now;

    if (this.game.status === 'playing') {
      const tickMs = this.fast ? TICK_MS / 2 : TICK_MS;
      this.acc += dt;
      let steps = 0;
      while (this.acc >= tickMs && steps < 8 && this.game.status === 'playing') {
        this.game.tick();
        this.handleEvents(this.game.events);
        this.game.events = [];
        this.acc -= tickMs;
        steps++;
      }
      if (steps === 8) this.acc = 0;
    }
    // Launch events happen on input, outside of ticks.
    if (this.game.events.length) {
      this.handleEvents(this.game.events);
      this.game.events = [];
    }

    this.update(dt);
    this.draw();
  }

  private handleEvents(events: GameEvent[]): void {
    const palette = this.game.def.palette;
    for (const ev of events) {
      switch (ev.type) {
        case 'launch':
          this.sfx.launch();
          break;
        case 'shot': {
          const from = this.visual(ev.shooter);
          const to = this.cellCenter(ev.cell);
          const dur = 90 + Math.hypot(to.x - from.x, to.y - from.y) * 0.35;
          const color = palette[ev.color];
          this.projectiles.push({ x0: from.x, y0: from.y, x1: to.x, y1: to.y, start: this.now, dur, color });
          this.dying.push({ cell: ev.cell, color, hitAt: this.now + dur });
          this.visual(ev.shooter).pop = 1;
          this.sfx.shot(ev.color);
          break;
        }
        case 'depleted': {
          const v = this.visual(ev.shooter);
          this.burst(v.x, v.y, palette[ev.shooter.color], 14, this.layout.beltShooterSize * 0.18);
          this.rings.push({ x: v.x, y: v.y, start: this.now, color: palette[ev.shooter.color] });
          this.sfx.depleted();
          break;
        }
        case 'toSlot':
          this.sfx.park();
          break;
        case 'won':
          completeLevel(this.level);
          this.overlay = { kind: 'won', at: this.now + 900 };
          setTimeout(() => this.sfx.win(), 450);
          break;
        case 'lost': {
          const v = this.visual(ev.shooter);
          v.shake = 1.5;
          this.overlay = { kind: 'lost', at: this.now + 700 };
          this.sfx.lose();
          break;
        }
        case 'enter':
          break;
      }
    }
  }

  private burst(x: number, y: number, color: string, count: number, size: number): void {
    for (let i = 0; i < count && this.particles.length < 800; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 60 + Math.random() * 180;
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 60,
        life: 0,
        max: 0.45 + Math.random() * 0.35,
        size: size * (0.6 + Math.random() * 0.8),
        color,
      });
    }
  }

  private update(dt: number): void {
    const s = dt / 1000;
    const alpha = this.game.status === 'playing' ? this.acc / (this.fast ? TICK_MS / 2 : TICK_MS) : 0;
    const follow = 1 - Math.exp(-s * 16);
    for (const sh of this.game.shooters) {
      if (sh.place === 'gone') continue;
      const v = this.visual(sh);
      const p = this.targetPoint(sh, alpha);
      const d = Math.hypot(p.x - v.x, p.y - v.y);
      // Snap while riding the belt so shooters line up exactly with the rows they shoot.
      if (sh.place === 'belt' && d < this.layout.cell * 1.5) {
        v.x = p.x;
        v.y = p.y;
      } else {
        v.x += (p.x - v.x) * follow;
        v.y += (p.y - v.y) * follow;
      }
      v.shake = Math.max(0, v.shake - s * 2.5);
      v.pop = Math.max(0, v.pop - s * 6);
    }

    // Pixels that got hit burst into particles.
    const cs = this.layout.cell;
    for (const d of this.dying) {
      if (d.hitAt <= this.now && d.hitAt > 0) {
        const c = this.cellCenter(d.cell);
        this.burst(c.x, c.y, d.color, 3, Math.max(2, cs * 0.3));
        d.hitAt = -this.now; // negative: remembers when it was hit
      }
    }
    this.dying = this.dying.filter((d) => d.hitAt > 0 || this.now + d.hitAt < 180);
    this.projectiles = this.projectiles.filter((p) => this.now - p.start < p.dur);
    this.rings = this.rings.filter((r) => this.now - r.start < 400);

    for (const p of this.particles) {
      p.life += s;
      p.vy += 520 * s;
      p.x += p.vx * s;
      p.y += p.vy * s;
    }
    this.particles = this.particles.filter((p) => p.life < p.max);
  }

  // -------------------------------------------------------------------------------------------
  // Drawing
  // -------------------------------------------------------------------------------------------

  private draw(): void {
    const { ctx, layout: L } = this;
    const bg = ctx.createLinearGradient(0, 0, 0, L.height);
    bg.addColorStop(0, this.biome.theme.sky[0]);
    bg.addColorStop(1, this.biome.theme.sky[1]);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, L.width, L.height);

    this.drawHud();
    this.drawBelt();
    this.drawBoard();
    this.drawProjectiles();
    this.drawBeltShooters();
    this.drawEffects();
    if (!(this.level === 1 && this.launches === 0)) this.drawCapacity();
    this.drawSlots();
    this.drawQueues();
    this.drawHints();
    this.drawOverlay();
  }

  private drawHud(): void {
    const { ctx, layout: L, game } = this;
    const h = L.hud;
    const left = L.buttons.map.x + L.buttons.map.w + 10;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillStyle = THEME.text;
    ctx.font = `800 20px ${FONT}`;
    ctx.fillText(`Level ${this.level}`, left, h.h / 2 - 7);
    ctx.fillStyle = THEME.textDim;
    ctx.font = `600 11px ${FONT}`;
    ctx.fillText(`${this.biome.theme.icon} ${this.biome.name}`, left, h.h / 2 + 12);
    ctx.font = `800 20px ${FONT}`;
    const labelW = Math.max(ctx.measureText(`Level ${this.level}`).width, 70);

    // Progress bar.
    const bx = left + labelW + 14;
    const bw = L.buttons.speed.x - 14 - bx;
    if (bw > 40) {
      const by = h.h / 2 - 9;
      ctx.fillStyle = THEME.panel;
      roundRect(ctx, bx, by, bw, 12, 6);
      ctx.fill();
      const progress = 1 - game.remaining / game.totalPixels;
      if (progress > 0) {
        ctx.fillStyle = THEME.good;
        roundRect(ctx, bx, by, Math.max(12, bw * progress), 12, 6);
        ctx.fill();
      }
      ctx.fillStyle = THEME.textDim;
      ctx.font = `600 11px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.fillText(`${game.remaining} Pixel übrig`, bx + bw / 2, by + 24);
    }

    drawButton(ctx, L.buttons.map, '◀', false, THEME.panel);
    drawButton(ctx, L.buttons.speed, this.fast ? '»' : '›', this.fast, THEME.panel);
    drawButton(ctx, L.buttons.sound, this.sfx.muted ? '×' : '♪', false, THEME.panel);
    drawButton(ctx, L.buttons.restart, '↻', false, THEME.panel);
  }

  private drawBelt(): void {
    const { ctx, layout: L } = this;
    const b = L.belt;
    const r = L.beltW * 0.6;
    const path = () => {
      // Same direction as the shooters travel: right along the bottom, up, left along the top, down.
      ctx.beginPath();
      ctx.moveTo(b.x + r, b.y + b.h);
      ctx.arcTo(b.x + b.w, b.y + b.h, b.x + b.w, b.y, r);
      ctx.arcTo(b.x + b.w, b.y, b.x, b.y, r);
      ctx.arcTo(b.x, b.y, b.x, b.y + b.h, r);
      ctx.arcTo(b.x, b.y + b.h, b.x + b.w, b.y + b.h, r);
      ctx.closePath();
    };
    ctx.lineJoin = 'round';
    ctx.lineCap = 'butt';
    path();
    ctx.strokeStyle = THEME.belt;
    ctx.lineWidth = L.beltW;
    ctx.stroke();
    // Moving tread marks.
    path();
    ctx.setLineDash([L.beltW * 0.18, L.beltW * 0.42]);
    const speed = (L.cell / (this.fast ? TICK_MS / 2 : TICK_MS)) * 1000;
    ctx.lineDashOffset = this.game.status === 'playing' ? -((this.now / 1000) * speed) % (L.beltW * 0.6) : 0;
    ctx.strokeStyle = THEME.beltLine;
    ctx.lineWidth = L.beltW * 0.7;
    ctx.stroke();
    ctx.setLineDash([]);

    // Entry marker.
    const e = this.stepPoint(0);
    ctx.fillStyle = THEME.accent;
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.arc(e.x, e.y, L.beltW * 0.18, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  private drawBoard(): void {
    const { ctx, layout: L, game } = this;
    const cs = L.cell;
    const palette = game.def.palette;
    ctx.fillStyle = THEME.board;
    roundRect(ctx, L.boardX - 4, L.boardY - 4, cs * game.width + 8, cs * game.height + 8, 8);
    ctx.fill();

    const gapPx = cs >= 9 ? 1 : 0;
    const bevel = cs >= 10;
    for (let y = 0; y < game.height; y++) {
      for (let x = 0; x < game.width; x++) {
        const c = game.grid[y * game.width + x];
        const px = L.boardX + x * cs;
        const py = L.boardY + y * cs;
        if (c === EMPTY) {
          ctx.fillStyle = 'rgba(0,0,0,0.18)';
          ctx.fillRect(px + gapPx, py + gapPx, cs - gapPx * 2, cs - gapPx * 2);
          continue;
        }
        this.drawPixel(px, py, cs, palette[c], gapPx, bevel);
      }
    }
    // Pixels with an incoming bullet stay visible until they're hit, then shrink away.
    for (const d of this.dying) {
      const x = d.cell % game.width;
      const y = Math.floor(d.cell / game.width);
      const px = L.boardX + x * cs;
      const py = L.boardY + y * cs;
      if (d.hitAt > 0) {
        this.drawPixel(px, py, cs, d.color, gapPx, bevel);
      } else {
        const t = Math.min(1, (this.now + d.hitAt) / 180);
        const scale = 1 - t;
        ctx.globalAlpha = 1 - t * 0.5;
        this.drawPixel(px + (cs * (1 - scale)) / 2, py + (cs * (1 - scale)) / 2, cs * scale, '#ffffff', 0, false);
        ctx.globalAlpha = 1;
      }
    }
  }

  private drawPixel(px: number, py: number, size: number, color: string, gapPx: number, bevel: boolean): void {
    const { ctx } = this;
    ctx.fillStyle = color;
    ctx.fillRect(px + gapPx, py + gapPx, size - gapPx * 2, size - gapPx * 2);
    if (bevel) {
      const b = Math.max(1, size * 0.14);
      ctx.fillStyle = 'rgba(255,255,255,0.28)';
      ctx.fillRect(px + gapPx, py + gapPx, size - gapPx * 2, b);
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.fillRect(px + gapPx, py + size - gapPx - b, size - gapPx * 2, b);
    }
  }

  private drawProjectiles(): void {
    const { ctx } = this;
    for (const p of this.projectiles) {
      const t = Math.min(1, (this.now - p.start) / p.dur);
      const x = p.x0 + (p.x1 - p.x0) * t;
      const y = p.y0 + (p.y1 - p.y0) * t;
      const tx = p.x0 + (p.x1 - p.x0) * Math.max(0, t - 0.25);
      const ty = p.y0 + (p.y1 - p.y0) * Math.max(0, t - 0.25);
      ctx.strokeStyle = p.color;
      ctx.lineWidth = Math.max(2, this.layout.cell * 0.28);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(x, y);
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(x, y, Math.max(1.5, this.layout.cell * 0.16), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawBeltShooters(): void {
    const { game, layout: L } = this;
    const palette = game.def.palette;
    const cx = L.boardX + (L.cell * game.width) / 2;
    const cy = L.boardY + (L.cell * game.height) / 2;
    for (const s of [...game.pending, ...game.belt]) {
      const v = this.visual(s);
      let angle: number;
      const step = game.path[s.pos];
      if (s.place === 'belt' && step.facing !== Facing.None) angle = FACING_ANGLE[step.facing];
      else angle = Math.atan2(cy - v.y, cx - v.x);
      this.drawShooter(v, L.beltShooterSize * (1 + v.pop * 0.12), palette[s.color], s.ammo, angle, false);
    }
  }

  private drawShooter(v: Visual, size: number, color: string, ammo: number, angle: number | null, dim: boolean): void {
    const { ctx } = this;
    const shake = v.shake > 0 ? Math.sin(this.now / 18) * v.shake * size * 0.12 : 0;
    const x = v.x + shake;
    const y = v.y;
    const r = size * 0.24;
    ctx.save();
    if (dim) ctx.globalAlpha = 0.55;
    if (angle !== null) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle);
      ctx.fillStyle = shade(color, -0.45);
      roundRect(ctx, size * 0.28, -size * 0.13, size * 0.36, size * 0.26, size * 0.06);
      ctx.fill();
      ctx.restore();
    }
    ctx.fillStyle = shade(color, -0.4);
    roundRect(ctx, x - size / 2, y - size / 2 + size * 0.07, size, size, r);
    ctx.fill();
    ctx.fillStyle = color;
    roundRect(ctx, x - size / 2, y - size / 2, size, size * 0.93, r);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    roundRect(ctx, x - size * 0.36, y - size * 0.42, size * 0.72, size * 0.2, r * 0.5);
    ctx.fill();

    const fs = Math.max(9, size * (ammo >= 100 ? 0.36 : 0.46));
    ctx.font = `900 ${fs}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(2, size * 0.1);
    ctx.strokeStyle = 'rgba(15,17,40,0.85)';
    ctx.strokeText(String(ammo), x, y + size * 0.03);
    ctx.fillStyle = '#fff';
    ctx.fillText(String(ammo), x, y + size * 0.03);
    ctx.restore();
  }

  private drawEffects(): void {
    const { ctx } = this;
    for (const p of this.particles) {
      ctx.globalAlpha = Math.max(0, 1 - p.life / p.max);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;
    for (const r of this.rings) {
      const t = (this.now - r.start) / 400;
      ctx.globalAlpha = 1 - t;
      ctx.strokeStyle = r.color;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(r.x, r.y, this.layout.beltShooterSize * (0.4 + t * 0.9), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  private drawCapacity(): void {
    const { ctx, layout: L, game } = this;
    const cap = game.def.beltCapacity;
    const load = game.beltLoad;
    const r = L.capacity;
    const dot = 10;
    const gap = 6;
    const label = 'Band';
    ctx.font = `700 13px ${FONT}`;
    const lw = ctx.measureText(label).width + 10;
    const total = lw + cap * dot + (cap - 1) * gap;
    let x = r.x + (r.w - total) / 2;
    const y = r.y + r.h / 2;
    ctx.fillStyle = THEME.textDim;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x, y);
    x += lw;
    for (let i = 0; i < cap; i++) {
      ctx.fillStyle = i < load ? (load >= cap ? THEME.danger : THEME.accent) : THEME.panelLight;
      ctx.beginPath();
      ctx.arc(x + dot / 2, y, dot / 2, 0, Math.PI * 2);
      ctx.fill();
      x += dot + gap;
    }
  }

  private drawSlots(): void {
    const { ctx, layout: L, game } = this;
    const palette = game.def.palette;
    const free = game.slots.filter((s) => !s).length;
    L.slots.forEach((r, i) => {
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      roundRect(ctx, r.x, r.y, r.w, r.h, r.w * 0.24);
      ctx.fill();
      ctx.strokeStyle = free <= 1 && game.status === 'playing' ? 'rgba(255,77,94,0.7)' : THEME.panelLight;
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
      const s = game.slots[i];
      if (s) this.drawShooter(this.visual(s), r.w * 0.86, palette[s.color], s.ammo, null, false);
    });
  }

  private drawQueues(): void {
    const { ctx, layout: L, game } = this;
    const palette = game.def.palette;
    const S = L.shooterSize;
    game.queues.forEach((q, c) => {
      const col = L.columns[c];
      ctx.fillStyle = 'rgba(255,255,255,0.04)';
      roundRect(ctx, col.x + 4, col.y - 6, col.w - 8, Math.min(col.h, L.queueStep * (L.queueRows - 1) + S + 34), 14);
      ctx.fill();
      // Draw back to front so the front shooter is on top.
      const visible = Math.min(q.length, L.queueRows);
      for (let i = visible - 1; i >= 0; i--) {
        const s = q[i];
        this.drawShooter(this.visual(s), S * (i === 0 ? 1 : 0.86), palette[s.color], s.ammo, i === 0 ? -Math.PI / 2 : null, i > 0);
      }
      if (q.length > L.queueRows) {
        const p = this.queuePoint(c, L.queueRows);
        ctx.fillStyle = THEME.textDim;
        ctx.font = `700 13px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`+${q.length - L.queueRows}`, p.x, p.y - S * 0.25);
      }
    });
  }

  private drawHints(): void {
    const { ctx, layout: L } = this;
    const pulse = 0.6 + 0.4 * Math.sin(this.now / 250);
    if (this.level === 1 && this.launches === 0 && !this.overlay) {
      ctx.fillStyle = THEME.accent;
      ctx.globalAlpha = pulse;
      ctx.font = `700 15px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Tippe auf einen Shooter!', L.capacity.x + L.capacity.w / 2, L.capacity.y + L.capacity.h / 2);
      ctx.globalAlpha = 1;
    }
    const sinceStart = this.now - this.levelStart;
    if (sinceStart < 1400) {
      const t = sinceStart / 1400;
      ctx.globalAlpha = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
      const cx = L.boardX + (L.cell * this.game.width) / 2;
      const cy = L.boardY + (L.cell * this.game.height) / 2;
      ctx.fillStyle = 'rgba(10,12,30,0.7)';
      roundRect(ctx, cx - 110, cy - 34, 220, 68, 18);
      ctx.fill();
      ctx.fillStyle = THEME.text;
      ctx.font = `900 32px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`Level ${this.level}`, cx, cy + 2);
      ctx.globalAlpha = 1;
    }
    if (this.toast) {
      const t = (this.now - this.toast.at) / 1200;
      if (t >= 1) {
        this.toast = null;
      } else {
        ctx.globalAlpha = t < 0.8 ? 1 : (1 - t) / 0.2;
        ctx.font = `700 15px ${FONT}`;
        const w = ctx.measureText(this.toast.text).width + 28;
        const x = L.width / 2;
        const y = L.boardY + (L.cell * this.game.height) / 2;
        ctx.fillStyle = THEME.danger;
        roundRect(ctx, x - w / 2, y - 16, w, 32, 16);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(this.toast.text, x, y + 1);
        ctx.globalAlpha = 1;
      }
    }
  }

  private drawOverlay(): void {
    const o = this.overlay;
    this.overlayButtons = [];
    if (!o || this.now < o.at) return;
    const { ctx, layout: L } = this;
    const t = Math.min(1, (this.now - o.at) / 250);
    ctx.globalAlpha = t;
    ctx.fillStyle = 'rgba(8,9,22,0.72)';
    ctx.fillRect(0, 0, L.width, L.height);

    const won = o.kind === 'won';
    const w = Math.min(340, L.width - 40);
    const h = won ? 220 : 280;
    const x = (L.width - w) / 2;
    const y = (L.height - h) / 2 + (1 - t) * 30;
    ctx.fillStyle = THEME.panel;
    roundRect(ctx, x, y, w, h, 24);
    ctx.fill();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = won ? THEME.accent : THEME.danger;
    ctx.font = `900 30px ${FONT}`;
    ctx.fillText(won ? 'Geschafft!' : 'Kein Platz mehr!', x + w / 2, y + 50);
    ctx.fillStyle = THEME.textDim;
    ctx.font = `600 15px ${FONT}`;
    const title = this.game.def.title;
    ctx.fillText(
      won ? (title ? `„${title}“ ist fertig!` : `Level ${this.level} ist komplett.`) : 'Alle Warteplätze waren belegt.',
      x + w / 2,
      y + 92,
    );

    const buttons: { label: string; color: string; action: () => void }[] = won
      ? [{ label: 'Weiter', color: THEME.good, action: () => this.host.showMap(this.level) }]
      : [
          { label: 'Nochmal versuchen', color: THEME.accent, action: () => this.restart() },
          { label: 'Zur Karte', color: THEME.panelLight, action: () => this.host.showMap() },
        ];
    let by = y + 132;
    for (const b of buttons) {
      const rect = { x: x + 32, y: by, w: w - 64, h: 52 };
      ctx.fillStyle = b.color;
      roundRect(ctx, rect.x, rect.y, rect.w, rect.h, 18);
      ctx.fill();
      ctx.fillStyle = b.color === THEME.panelLight ? THEME.text : THEME.dark;
      ctx.font = `900 19px ${FONT}`;
      ctx.fillText(b.label, rect.x + rect.w / 2, rect.y + rect.h / 2 + 1);
      this.overlayButtons.push({ rect, action: b.action });
      by += 64;
    }
    ctx.globalAlpha = 1;
  }
}
