/**
 * Pure, deterministic game simulation (no DOM). The renderer and the level
 * generator's solvability check both drive this same model.
 *
 * Rules (modelled after Pixel Flow):
 *  - A pixel image sits in the middle, surrounded by a conveyor belt.
 *  - Shooters wait in queue columns. Tapping the front shooter of a column puts it on the belt.
 *  - On the belt a shooter travels one lap around the image. Whenever it faces a row/column,
 *    it shoots the first pixel in that line if that pixel has the shooter's color.
 *  - Each shot uses one ammo. A shooter with no ammo left disappears.
 *  - A shooter that finishes its lap with ammo left parks in a waiting slot; from there it
 *    can be sent out again. If no slot is free, the level is lost.
 *  - The level is won when every pixel is cleared.
 */

export const EMPTY = -1;

/** Minimum distance (in belt cells) between two shooters on the belt. */
export const ENTRY_SPACING = 2;

export interface ShooterDef {
  color: number;
  ammo: number;
}

export interface LevelDef {
  level: number;
  width: number;
  height: number;
  palette: string[];
  /** Row-major color indices, EMPTY for holes. */
  grid: Int8Array;
  /** Queue columns, front shooter first. */
  columns: ShooterDef[][];
  slots: number;
  beltCapacity: number;
}

export type ShooterPlace = 'queue' | 'pending' | 'belt' | 'slot' | 'gone';

export interface Shooter {
  id: number;
  color: number;
  ammo: number;
  /** Position on the belt path (only meaningful while on the belt). */
  pos: number;
  place: ShooterPlace;
}

export type GameEvent =
  | { type: 'launch'; shooter: Shooter }
  | { type: 'enter'; shooter: Shooter }
  | { type: 'shot'; shooter: Shooter; cell: number; color: number }
  | { type: 'depleted'; shooter: Shooter }
  | { type: 'toSlot'; shooter: Shooter; slot: number }
  | { type: 'won' }
  | { type: 'lost'; shooter: Shooter };

export type GameStatus = 'playing' | 'won' | 'lost';

/** Direction a shooter faces at a path position. */
export enum Facing {
  None = 0,
  Up = 1,
  Left = 2,
  Down = 3,
  Right = 4,
}

/** Precomputed description of one belt path position. */
export interface PathStep {
  /** Grid coordinates of the belt cell (may be -1 or width/height, i.e. outside the image). */
  x: number;
  y: number;
  facing: Facing;
  /** Cells along the line of sight, nearest first. Empty for corners. */
  line: Int32Array;
}

/**
 * The belt runs one cell outside the image. Index 0 is the bottom-left corner (entry);
 * the belt then runs right along the bottom, up the right side, left along the top
 * and down the left side back to the entry.
 */
export function buildPath(w: number, h: number): PathStep[] {
  const steps: PathStep[] = [];
  const corner = (x: number, y: number) => steps.push({ x, y, facing: Facing.None, line: new Int32Array(0) });
  corner(-1, h);
  for (let x = 0; x < w; x++) {
    const line = new Int32Array(h);
    for (let i = 0; i < h; i++) line[i] = (h - 1 - i) * w + x;
    steps.push({ x, y: h, facing: Facing.Up, line });
  }
  corner(w, h);
  for (let y = h - 1; y >= 0; y--) {
    const line = new Int32Array(w);
    for (let i = 0; i < w; i++) line[i] = y * w + (w - 1 - i);
    steps.push({ x: w, y, facing: Facing.Left, line });
  }
  corner(w, -1);
  for (let x = w - 1; x >= 0; x--) {
    const line = new Int32Array(h);
    for (let i = 0; i < h; i++) line[i] = i * w + x;
    steps.push({ x, y: -1, facing: Facing.Down, line });
  }
  corner(-1, -1);
  for (let y = 0; y < h; y++) {
    const line = new Int32Array(w);
    for (let i = 0; i < w; i++) line[i] = y * w + i;
    steps.push({ x: -1, y, facing: Facing.Right, line });
  }
  return steps;
}

/** Marks every pixel that is the first non-empty pixel of some row/column seen from outside. */
export function exposedMask(grid: Int8Array, w: number, h: number): Uint8Array {
  const mask = new Uint8Array(w * h);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) if (grid[y * w + x] !== EMPTY) { mask[y * w + x] = 1; break; }
    for (let y = h - 1; y >= 0; y--) if (grid[y * w + x] !== EMPTY) { mask[y * w + x] = 1; break; }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) if (grid[y * w + x] !== EMPTY) { mask[y * w + x] = 1; break; }
    for (let x = w - 1; x >= 0; x--) if (grid[y * w + x] !== EMPTY) { mask[y * w + x] = 1; break; }
  }
  return mask;
}

/** Number of exposed pixels per color. */
export function exposedCounts(grid: Int8Array, w: number, h: number, colors: number): number[] {
  const mask = exposedMask(grid, w, h);
  const counts = new Array<number>(colors).fill(0);
  for (let i = 0; i < mask.length; i++) if (mask[i]) counts[grid[i]]++;
  return counts;
}

export class Game {
  readonly def: LevelDef;
  readonly width: number;
  readonly height: number;
  readonly path: PathStep[];
  readonly grid: Int8Array;
  readonly queues: Shooter[][];
  readonly slots: (Shooter | null)[];
  readonly belt: Shooter[] = [];
  readonly pending: Shooter[] = [];
  readonly shooters: Shooter[] = [];
  readonly totalPixels: number;
  remaining: number;
  status: GameStatus = 'playing';
  ticks = 0;
  events: GameEvent[] = [];

  constructor(def: LevelDef) {
    this.def = def;
    this.width = def.width;
    this.height = def.height;
    this.path = buildPath(def.width, def.height);
    this.grid = Int8Array.from(def.grid);
    let count = 0;
    for (const c of this.grid) if (c !== EMPTY) count++;
    this.totalPixels = count;
    this.remaining = count;
    let id = 0;
    this.queues = def.columns.map((col) =>
      col.map((s) => {
        const shooter: Shooter = { id: id++, color: s.color, ammo: s.ammo, pos: 0, place: 'queue' };
        this.shooters.push(shooter);
        return shooter;
      }),
    );
    this.slots = new Array(def.slots).fill(null);
  }

  get pathLength(): number {
    return this.path.length;
  }

  get beltLoad(): number {
    return this.belt.length + this.pending.length;
  }

  canLaunch(): boolean {
    return this.status === 'playing' && this.beltLoad < this.def.beltCapacity;
  }

  launchFromQueue(column: number): boolean {
    const queue = this.queues[column];
    if (!queue || queue.length === 0 || !this.canLaunch()) return false;
    this.launch(queue.shift()!);
    return true;
  }

  launchFromSlot(index: number): boolean {
    const shooter = this.slots[index];
    if (!shooter || !this.canLaunch()) return false;
    this.slots[index] = null;
    this.launch(shooter);
    return true;
  }

  private launch(shooter: Shooter): void {
    shooter.place = 'pending';
    this.pending.push(shooter);
    this.events.push({ type: 'launch', shooter });
  }

  /** First non-empty cell in the line of sight at path position `pos`, or -1. */
  targetAt(pos: number): number {
    const line = this.path[pos].line;
    for (let i = 0; i < line.length; i++) if (this.grid[line[i]] !== EMPTY) return line[i];
    return -1;
  }

  tick(): void {
    if (this.status !== 'playing') return;
    this.ticks++;
    const L = this.path.length;

    for (const s of [...this.belt]) {
      s.pos++;
      if (s.pos >= L) {
        this.removeFromBelt(s);
        const slot = this.slots.indexOf(null);
        if (slot < 0) {
          s.place = 'gone';
          this.status = 'lost';
          this.events.push({ type: 'lost', shooter: s });
          return;
        }
        this.slots[slot] = s;
        s.place = 'slot';
        s.pos = 0;
        this.events.push({ type: 'toSlot', shooter: s, slot });
        continue;
      }
      const cell = this.targetAt(s.pos);
      if (cell >= 0 && this.grid[cell] === s.color) {
        this.grid[cell] = EMPTY;
        s.ammo--;
        this.remaining--;
        this.events.push({ type: 'shot', shooter: s, cell, color: s.color });
        if (s.ammo <= 0) {
          this.removeFromBelt(s);
          s.place = 'gone';
          this.events.push({ type: 'depleted', shooter: s });
        }
      }
    }

    if (this.remaining === 0) {
      this.status = 'won';
      this.events.push({ type: 'won' });
      return;
    }

    // Shooters enter one at a time and keep a minimum distance so they never overlap.
    if (this.pending.length > 0 && this.belt.every((s) => s.pos >= ENTRY_SPACING)) {
      const next = this.pending.shift()!;
      next.pos = 0;
      next.place = 'belt';
      this.belt.push(next);
      this.events.push({ type: 'enter', shooter: next });
    }
  }

  private removeFromBelt(s: Shooter): void {
    const i = this.belt.indexOf(s);
    if (i >= 0) this.belt.splice(i, 1);
  }
}
