import { Rng, hashSeed } from './rng';
import { THEMES, Theme } from './themes';

/** Levels per biome. The last level of each biome is a bigger "boss" checkpoint. */
export const LEVELS_PER_BIOME = 10;

export interface Biome {
  index: number;
  theme: Theme;
  name: string;
  firstLevel: number;
  lastLevel: number;
}

const ROMAN = ['', '', ' II', ' III', ' IV', ' V', ' VI', ' VII', ' VIII', ' IX', ' X'];

/**
 * Theme order: themes are dealt in shuffled "decks" so every theme shows up once before any
 * repeats, and the same theme never appears twice in a row. The first biome is always animals.
 */
function deck(d: number): number[] {
  const order = new Rng(hashSeed(d, 0xb10e)).shuffle(THEMES.map((_, i) => i));
  if (d === 0) {
    const animals = THEMES.findIndex((t) => t.id === 'animals');
    order.splice(order.indexOf(animals), 1);
    order.unshift(animals);
  } else {
    const prev = deck(d - 1);
    if (order[0] === prev[prev.length - 1]) [order[0], order[1]] = [order[1], order[0]];
  }
  return order;
}

const deckCache = new Map<number, number[]>();
const biomeCache = new Map<number, Biome>();

function cachedDeck(d: number): number[] {
  let order = deckCache.get(d);
  if (!order) {
    order = deck(d);
    deckCache.set(d, order);
  }
  return order;
}

export function biome(index: number): Biome {
  const cached = biomeCache.get(index);
  if (cached) return cached;
  const T = THEMES.length;
  const d = Math.floor(index / T);
  const theme = THEMES[cachedDeck(d)[index % T]];
  // Each time a theme comes around again it gets the next name; after all names, numbered ones.
  const names = theme.names;
  const round = Math.floor(d / names.length);
  const name = names[d % names.length] + (round > 0 ? ROMAN[Math.min(10, round + 1)] : '');
  const firstLevel = index * LEVELS_PER_BIOME + 1;
  const b: Biome = { index, theme, name, firstLevel, lastLevel: firstLevel + LEVELS_PER_BIOME - 1 };
  biomeCache.set(index, b);
  return b;
}

export function biomeOfLevel(level: number): Biome {
  return biome(Math.floor((Math.max(1, level) - 1) / LEVELS_PER_BIOME));
}

export function isBossLevel(level: number): boolean {
  return level % LEVELS_PER_BIOME === 0;
}
