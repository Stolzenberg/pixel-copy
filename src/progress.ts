import { storageGet, storageSet } from './util';

const KEY = 'pixelflow:level';

/** Highest level the player may play (all levels below it are completed). */
export function unlockedLevel(): number {
  const n = Number(storageGet(KEY));
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
}

/** Marks `level` as completed. Returns true if this unlocked a new level. */
export function completeLevel(level: number): boolean {
  if (level < unlockedLevel()) return false;
  storageSet(KEY, String(level + 1));
  return true;
}
