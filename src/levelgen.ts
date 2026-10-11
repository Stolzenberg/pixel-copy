import { EMPTY, LevelDef, ShooterDef, exposedMask } from './game';
import { Rng, hashSeed } from './rng';
import { botPlay } from './solver';
import { Sprite, Theme } from './themes';
import { biomeOfLevel } from './world';

/** Vivid, clearly distinguishable block colors. */
export const COLORS = [
  '#ff4d5e', // red
  '#ff9f1c', // orange
  '#ffd93d', // yellow
  '#5bd75b', // green
  '#2ec4f1', // cyan
  '#3a6df0', // blue
  '#9b5de5', // purple
  '#ff70c8', // pink
  '#a0673f', // brown
  '#f4f1e8', // white
];

export interface LevelParams {
  width: number;
  height: number;
  colors: number;
  columns: number;
  slots: number;
  beltCapacity: number;
  /** 0..1, how much the queue order deviates from the "natural" clearing order. */
  shuffle: number;
}

/** Difficulty curve. Grows quickly at first, then plateaus so levels stay playable forever. */
export function levelParams(level: number): LevelParams {
  const n = Math.max(1, Math.floor(level));
  const size = Math.min(10 + Math.floor((n - 1) / 3), 24);
  return {
    width: size,
    height: size,
    colors: Math.min(3 + Math.floor((n - 1) / 4), 7),
    columns: n < 3 ? 2 : n < 10 ? 3 : 4,
    slots: 5,
    beltCapacity: 5,
    shuffle: Math.min(0.08 + n * 0.015, 0.45),
  };
}

// ---------------------------------------------------------------------------------------------
// Image generators. Each returns a w*h grid filled with color indices 0..k-1.
// ---------------------------------------------------------------------------------------------

type ImageGen = (w: number, h: number, k: number, rng: Rng) => Int8Array;

const rings: ImageGen = (w, h, k, rng) => {
  const g = new Int8Array(w * h);
  const cx = (w - 1) / 2 + rng.range(-w / 6, w / 6);
  const cy = (h - 1) / 2 + rng.range(-h / 6, h / 6);
  const metric = rng.int(0, 2);
  const band = rng.range(1.3, Math.max(1.6, Math.min(w, h) / (k * 1.1)));
  const offset = rng.int(0, k - 1);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = Math.abs(x - cx);
      const dy = Math.abs(y - cy);
      const d = metric === 0 ? Math.hypot(dx, dy) : metric === 1 ? dx + dy : Math.max(dx, dy);
      g[y * w + x] = (Math.floor(d / band) + offset) % k;
    }
  }
  return g;
};

const voronoi: ImageGen = (w, h, k, rng) => {
  const g = new Int8Array(w * h);
  const symmetric = rng.chance(0.5);
  const n = k + rng.int(1, k + 2);
  const seeds = Array.from({ length: n }, (_, i) => ({
    x: rng.range(0, symmetric ? w / 2 : w),
    y: rng.range(0, h),
    c: i < k ? i : rng.int(0, k - 1),
  }));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sx = symmetric ? Math.min(x, w - 1 - x) : x;
      let best = 0;
      let bestD = Infinity;
      for (let i = 0; i < seeds.length; i++) {
        const d = (seeds[i].x - sx) ** 2 + (seeds[i].y - y) ** 2;
        if (d < bestD) { bestD = d; best = i; }
      }
      g[y * w + x] = seeds[best].c;
    }
  }
  return g;
};

const landscape: ImageGen = (w, h, k, rng) => {
  const g = new Int8Array(w * h);
  const layers = Math.max(2, k - (k >= 3 && rng.chance(0.6) ? 1 : 0));
  const hasSun = layers < k;
  const bounds = Array.from({ length: layers - 1 }, (_, i) => ({
    base: (h * (i + 1)) / layers + rng.range(-h / 10, h / 10),
    amp: rng.range(0.6, h / 7),
    freq: rng.range(0.25, 0.9),
    phase: rng.range(0, Math.PI * 2),
    amp2: rng.range(0, h / 14),
    freq2: rng.range(0.9, 1.8),
  }));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let layer = 0;
      for (const b of bounds) {
        const by = b.base + b.amp * Math.sin(x * b.freq + b.phase) + b.amp2 * Math.sin(x * b.freq2);
        if (y > by) layer++;
      }
      g[y * w + x] = layer;
    }
  }
  if (hasSun) {
    const r = rng.range(Math.min(w, h) / 7, Math.min(w, h) / 4.5);
    const sx = rng.range(r, w - r);
    const sy = rng.range(r * 0.8, h / 3);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) if (Math.hypot(x - sx, y - sy) <= r) g[y * w + x] = k - 1;
    }
  }
  return g;
};

const sprite: ImageGen = (w, h, k, rng) => {
  let body = new Uint8Array(w * h);
  for (let attempt = 0; attempt < 20; attempt++) {
    body = new Uint8Array(w * h);
    const half = Math.ceil(w / 2);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < half; x++) {
        const fill = rng.chance(0.52 + 0.2 * (x / half));
        if (fill) {
          body[y * w + x] = 1;
          body[y * w + (w - 1 - x)] = 1;
        }
      }
    }
    // Cellular automaton smoothing for blobby, organic sprites.
    for (let it = 0; it < 2; it++) {
      const next = new Uint8Array(w * h);
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          let n = 0;
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy) n += body[(y + dy) * w + x + dx];
          next[y * w + x] = n >= 5 || (body[y * w + x] && n >= 4) ? 1 : 0;
        }
      }
      body = next;
    }
    let count = 0;
    for (const b of body) count += b;
    if (count > w * h * 0.25) break;
  }
  const g = new Int8Array(w * h);
  for (let i = 0; i < g.length; i++) g[i] = body[i] ? 1 : 0;
  if (k >= 3) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!body[y * w + x]) continue;
        const edge = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
          const nx = x + dx;
          const ny = y + dy;
          return nx < 0 || ny < 0 || nx >= w || ny >= h || !body[ny * w + nx];
        });
        if (edge) g[y * w + x] = 2;
      }
    }
  }
  for (let c = 3; c < k; c++) {
    const spots = rng.int(1, 3);
    for (let s = 0; s < spots; s++) {
      const size = rng.int(1, Math.max(1, Math.floor(w / 8)));
      const sx = rng.int(1, Math.floor(w / 2) - size);
      const sy = rng.int(1, h - 1 - size);
      for (let y = sy; y <= sy + size; y++) {
        for (let x = sx; x <= sx + size; x++) {
          for (const xx of [x, w - 1 - x]) {
            if (y < h && xx >= 0 && xx < w && body[y * w + xx]) g[y * w + xx] = c;
          }
        }
      }
    }
  }
  return g;
};

const shapes: ImageGen = (w, h, k, rng) => {
  const g = new Int8Array(w * h);
  const stripe = rng.int(2, Math.max(2, Math.floor(w / 4)));
  const bgColors = k >= 4 ? 2 : 1;
  const kind = rng.int(0, 3);
  const scale = rng.range(0.75, 0.95);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // Normalised coordinates in [-1, 1], y pointing up.
      const nx = ((x + 0.5) / w) * 2 - 1;
      const ny = -(((y + 0.5) / h) * 2 - 1);
      const px = nx / scale;
      const py = ny / scale;
      let inside: number; // <= 0 inside, larger = further out
      if (kind === 0) {
        // heart
        const hx = px * 1.25;
        const hy = py * 1.25 + 0.15;
        inside = (hx * hx + hy * hy - 1) ** 3 - hx * hx * hy ** 3;
      } else if (kind === 1) {
        // flower / star
        const r = Math.hypot(px, py);
        const a = Math.atan2(py, px);
        const petals = 5;
        inside = r - (0.62 + 0.33 * Math.cos(petals * a + Math.PI / 2));
      } else if (kind === 2) {
        inside = Math.hypot(px, py) - 0.9;
      } else {
        inside = Math.abs(px) + Math.abs(py) - 1;
      }
      let c: number;
      if (inside <= 0) {
        c = bgColors;
        const inner = k - bgColors;
        if (inner > 1) {
          const depth = kind === 0 ? Math.hypot(px, py + 0.1) : kind === 3 ? Math.abs(px) + Math.abs(py) : Math.hypot(px, py);
          c = bgColors + Math.min(inner - 1, Math.floor(depth * inner));
        }
      } else {
        c = Math.floor((x + y) / stripe) % bgColors;
      }
      g[y * w + x] = c;
    }
  }
  return g;
};

const patterns: ImageGen = (w, h, k, rng) => {
  const g = new Int8Array(w * h);
  const b = rng.int(2, Math.max(2, Math.floor(Math.min(w, h) / 3)));
  const mode = rng.int(0, 3);
  const p = rng.int(2, 5);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v: number;
      if (mode === 0) v = Math.floor((x + y) / b);
      else if (mode === 1) v = Math.floor(x / b) + Math.floor(y / b);
      else if (mode === 2) v = Math.floor((y + Math.abs((x % (2 * p)) - p)) / b);
      else v = Math.floor(Math.max(Math.abs(x - (w - 1) / 2), 0) / b) + Math.floor(y / b);
      g[y * w + x] = v % k;
    }
  }
  return g;
};

const GENERATORS: ImageGen[] = [rings, voronoi, landscape, sprite, shapes, patterns];

/** Removes unused colors so every palette entry is actually present in the image. */
function compact(grid: Int8Array, k: number): { grid: Int8Array; used: number[] } {
  const counts = new Array<number>(k).fill(0);
  for (const c of grid) if (c !== EMPTY) counts[c]++;
  const used = counts.map((n, c) => (n > 0 ? c : -1)).filter((c) => c >= 0);
  const remap = new Array<number>(k).fill(-1);
  used.forEach((c, i) => (remap[c] = i));
  return { grid: grid.map((c) => (c === EMPTY ? EMPTY : remap[c])) as Int8Array, used };
}

export function generateImage(w: number, h: number, k: number, rng: Rng): { grid: Int8Array; colors: number } {
  for (let attempt = 0; attempt < 10; attempt++) {
    const gen = rng.pick(GENERATORS);
    const raw = gen(w, h, k, rng);
    const { grid, used } = compact(raw, k);
    // Accept slightly fewer colors than requested, but never a boring single-color image.
    if (used.length >= Math.max(2, k - 1)) return { grid, colors: used.length };
  }
  const grid = patterns(w, h, k, rng);
  const { grid: g, used } = compact(grid, k);
  return { grid: g, colors: used.length };
}

// ---------------------------------------------------------------------------------------------
// Shooter generation
// ---------------------------------------------------------------------------------------------

/**
 * Builds a shooter sequence by "peeling" the image from the outside in: repeatedly pick a color
 * that is currently reachable and remove a chunk of it. Following this sequence is a natural
 * way to solve the level, which keeps generated levels fair.
 */
function peelSequence(grid: Int8Array, w: number, h: number, colors: number, rng: Rng): ShooterDef[] {
  const g = Int8Array.from(grid);
  let total = 0;
  for (const c of g) if (c !== EMPTY) total++;
  const avgChunk = Math.max(5, Math.round(total / (colors * rng.range(2.2, 3.4)) / 5) * 5);
  const seq: ShooterDef[] = [];

  while (total > 0) {
    const mask = exposedMask(g, w, h);
    const exposed = new Array<number>(colors).fill(0);
    for (let i = 0; i < mask.length; i++) if (mask[i]) exposed[g[i]]++;
    // Weighted pick favouring colors with lots of reachable pixels.
    const weights = exposed.map((n) => n ** 1.5);
    const sum = weights.reduce((a, b) => a + b, 0);
    let r = rng.range(0, sum);
    let color = 0;
    for (let c = 0; c < colors; c++) {
      r -= weights[c];
      if (r <= 0 && weights[c] > 0) { color = c; break; }
      if (weights[c] > 0) color = c;
    }
    const target = Math.max(5, Math.round((avgChunk * rng.range(0.6, 1.5)) / 5) * 5);
    let removed = 0;
    for (let round = 0; round < 3 && removed < target; round++) {
      const m = round === 0 ? mask : exposedMask(g, w, h);
      let any = false;
      for (let i = 0; i < m.length && removed < target; i++) {
        if (m[i] && g[i] === color) {
          g[i] = EMPTY;
          removed++;
          any = true;
        }
      }
      if (!any) break;
    }
    total -= removed;
    const last = seq[seq.length - 1];
    if (last && last.color === color && last.ammo + removed <= avgChunk * 1.6) last.ammo += removed;
    else seq.push({ color, ammo: removed });
  }
  // Fold tiny leftovers into an earlier shooter of the same color for rounder ammo numbers.
  for (let i = seq.length - 1; i > 0; i--) {
    if (seq[i].ammo >= 4) continue;
    for (let j = i - 1; j >= 0; j--) {
      if (seq[j].color === seq[i].color) {
        seq[j].ammo += seq[i].ammo;
        seq.splice(i, 1);
        break;
      }
    }
  }
  return seq;
}

/** Light shuffling so the natural order isn't always the obvious one. */
function perturb(seq: ShooterDef[], amount: number, rng: Rng): ShooterDef[] {
  const out = seq.map((s) => ({ ...s }));
  for (let i = 0; i < out.length - 1; i++) {
    if (rng.chance(amount)) {
      const j = Math.min(out.length - 1, i + rng.int(1, 2));
      [out[i], out[j]] = [out[j], out[i]];
    }
  }
  return out;
}

/** Deals a sequence onto columns while preserving the relative order inside each column. */
function distribute(seq: ShooterDef[], columns: number, rng: Rng): ShooterDef[][] {
  const cols: ShooterDef[][] = Array.from({ length: columns }, () => []);
  seq.forEach((s, i) => {
    // The first few shooters go round robin so no column starts empty.
    const c = i < columns ? i : rng.int(0, columns - 1);
    cols[c].push(s);
  });
  return cols.filter((c) => c.length > 0);
}

// ---------------------------------------------------------------------------------------------
// Themed images: hand-made pixel-art sprites, scaled up and placed on a patterned background.
// ---------------------------------------------------------------------------------------------

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function colorDistance(a: string, b: string): number {
  const [r1, g1, b1] = rgb(a);
  const [r2, g2, b2] = rgb(b);
  return Math.hypot(r1 - r2, g1 - g2, b1 - b2);
}

interface Image {
  width: number;
  height: number;
  grid: Int8Array;
  palette: string[];
  title: string;
}

function spriteImage(sprite: Sprite, theme: Theme, level: number, params: LevelParams, rng: Rng): Image {
  const sw = sprite.rows[0].length;
  const sh = sprite.rows.length;
  const pad = level <= 2 ? 0 : rng.int(0, level < 12 ? 1 : 2);
  const scale = Math.max(1, (params.width - 2 * pad) / Math.max(sw, sh));
  const iw = Math.round(sw * scale);
  const ih = Math.round(sh * scale);
  const width = iw + 2 * pad;
  const height = ih + 2 * pad;
  const mirror = rng.chance(0.4);

  // Sprite colors in a stable order.
  const chars = Object.keys(sprite.colors);
  const palette = chars.map((c) => sprite.colors[c]);

  // Background: empty (transparent) on easy levels, otherwise 1-2 theme colors in a pattern.
  const empty = level <= 3 || rng.chance(level < 15 ? 0.25 : 0.12);
  const candidates = rng
    .shuffle([...theme.backgrounds])
    .filter((c) => palette.every((p) => colorDistance(p, c) >= 70));
  const maxBg = Math.min(level < 8 ? 1 : 2, 7 - palette.length, candidates.length);
  const bgCount = empty ? 0 : Math.max(0, Math.min(maxBg, rng.int(1, 2)));
  const bg = candidates.slice(0, bgCount).map((c) => palette.push(c) - 1);
  const pattern = rng.int(0, 3);
  const period = rng.int(2, 4);

  const grid = new Int8Array(width * height).fill(EMPTY);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let c = EMPTY;
      const sx = Math.floor((x - pad) / scale);
      const sy = Math.floor((y - pad) / scale);
      if (x >= pad && y >= pad && sx < sw && sy < sh && x - pad < iw && y - pad < ih) {
        const ch = sprite.rows[sy][mirror ? sw - 1 - sx : sx];
        if (ch !== '.') c = chars.indexOf(ch);
      }
      if (c === EMPTY && bg.length > 0) {
        let v = 0;
        if (bg.length > 1) {
          if (pattern === 0) v = Math.floor(y / period);
          else if (pattern === 1) v = Math.floor((x + y) / period);
          else if (pattern === 2) v = Math.floor(x / period) + Math.floor(y / period);
          else v = Math.floor(Math.max(Math.abs(x - width / 2), Math.abs(y - height / 2)) / period);
        }
        c = bg[v % bg.length];
      }
      grid[y * width + x] = c;
    }
  }
  const { grid: compacted, used } = compact(grid, palette.length);
  return { width, height, grid: compacted, palette: used.map((i) => palette[i]), title: sprite.name };
}

function abstractImage(params: LevelParams, rng: Rng): Image {
  const width = params.width;
  const height = Math.max(6, params.height - rng.int(0, 2));
  const { grid, colors } = generateImage(width, height, params.colors, rng);
  const palette = rng.shuffle([...COLORS]).slice(0, colors);
  return { width, height, grid, palette, title: 'Kunstwerk' };
}

/** Which sprite a level of a biome shows: walks through a shuffled list so motifs rarely repeat. */
function pickSprite(theme: Theme, level: number): Sprite {
  const b = biomeOfLevel(level);
  const order = new Rng(hashSeed(b.index, 0x5b17e)).shuffle(theme.sprites.map((_, i) => i));
  return theme.sprites[order[(level - b.firstLevel) % order.length]];
}

function makeImage(level: number, params: LevelParams, rng: Rng, attempt: number): Image {
  const theme = biomeOfLevel(level).theme;
  if (theme.sprites.length === 0) return abstractImage(params, rng);
  const sprite = attempt === 0 ? pickSprite(theme, level) : rng.pick(theme.sprites);
  return spriteImage(sprite, theme, level, params, rng);
}

const cache = new Map<number, LevelDef>();

/** Deterministically generates level `level` (1-based). Levels count up forever. */
export function generateLevel(level: number): LevelDef {
  const cached = cache.get(level);
  if (cached) return cached;
  const params = levelParams(level);
  const rng = new Rng(hashSeed(level, 0x9e3779b9));

  let fallback: LevelDef | null = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    const { width, height, grid, palette, title } = makeImage(level, params, rng, attempt);
    const colors = palette.length;
    const seq = peelSequence(grid, width, height, colors, rng);

    for (let arrangement = 0; arrangement < 4; arrangement++) {
      const shuffle = params.shuffle * (1 - arrangement / 4);
      const def: LevelDef = {
        level,
        title,
        width,
        height,
        palette,
        grid,
        columns: distribute(perturb(seq, shuffle, rng), params.columns, rng),
        slots: params.slots,
        beltCapacity: params.beltCapacity,
      };
      if (botPlay(def).won) {
        cache.set(level, def);
        return def;
      }
      fallback ??= { ...def, columns: distribute(seq, params.columns, rng) };
    }
  }

  // Extremely rare: give the player extra waiting slots until the bot can solve it.
  const def = fallback!;
  for (let extra = 1; extra <= 6; extra++) {
    const relaxed = { ...def, slots: def.slots + extra };
    if (botPlay(relaxed).won) {
      cache.set(level, relaxed);
      return relaxed;
    }
  }
  const relaxed = { ...def, slots: def.slots + 6 };
  cache.set(level, relaxed);
  return relaxed;
}
