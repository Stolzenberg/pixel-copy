import { describe, expect, it } from 'vitest';
import { EMPTY, Game } from '../src/game';
import { generateLevel, levelParams, targetWinRate } from '../src/levelgen';
import { botPlay, randomWinRate } from '../src/solver';

describe('level generation', () => {
  it('is deterministic per level number', () => {
    const a = generateLevel(7);
    const b = generateLevel(7);
    expect(Array.from(a.grid)).toEqual(Array.from(b.grid));
    expect(a.columns).toEqual(b.columns);
  });

  it('gives every color exactly as much ammo as it has pixels', () => {
    for (let level = 1; level <= 40; level++) {
      const def = generateLevel(level);
      const pixels = new Array(def.palette.length).fill(0);
      for (const c of def.grid) if (c !== EMPTY) pixels[c]++;
      const ammo = new Array(def.palette.length).fill(0);
      for (const col of def.columns) for (const s of col) ammo[s.color] += s.ammo;
      expect(ammo).toEqual(pixels);
      expect(pixels.every((n) => n > 0)).toBe(true);
    }
  }, 60_000);

  it('produces levels the bot can solve, far beyond the difficulty plateau', () => {
    for (let level = 1; level <= 90; level++) {
      expect(botPlay(generateLevel(level)).won, `level ${level}`).toBe(true);
    }
    for (const level of [144, 500, 1234]) expect(botPlay(generateLevel(level)).won, `level ${level}`).toBe(true);
  }, 60_000);

  it('ramps difficulty up and then plateaus', () => {
    expect(levelParams(1).width).toBeLessThan(levelParams(20).width);
    expect(levelParams(1).colors).toBeLessThan(levelParams(20).colors);
    expect(levelParams(1000)).toEqual(levelParams(5000));
  });

  it('targets a sawtooth curve: harder within a biome, boss spikes, each biome harder than the last', () => {
    for (let b = 0; b < 6; b++) {
      const first = b * 10 + 1;
      expect(targetWinRate(first + 8)).toBeLessThan(targetWinRate(first));
      expect(targetWinRate(first + 9)).toBeLessThan(targetWinRate(first + 8));
      expect(targetWinRate(first + 5)).toBeGreaterThan(targetWinRate(first + 4)); // breather
      if (b > 0) expect(targetWinRate(first)).toBeLessThanOrEqual(targetWinRate(first - 10));
      if (b > 0) expect(targetWinRate(first)).toBeGreaterThan(targetWinRate(first - 1)); // relief after the boss
    }
    expect(targetWinRate(1)).toBeGreaterThan(0.9);
  });

  it('makes generated levels measurably harder over time', () => {
    const avgWinRate = (from: number) => {
      let sum = 0;
      for (let level = from; level < from + 10; level++) sum += randomWinRate(generateLevel(level), 40, 99);
      return sum / 10;
    };
    const early = avgWinRate(1);
    const mid = avgWinRate(21);
    const late = avgWinRate(51);
    expect(early).toBeGreaterThan(0.7);
    expect(mid).toBeLessThan(early - 0.1);
    expect(late).toBeLessThan(mid - 0.1);
    for (let level = 1; level <= 3; level++) expect(generateLevel(level).slots).toBe(5);
  }, 60_000);
});

describe('game rules', () => {
  const def = {
    level: 0,
    width: 2,
    height: 2,
    palette: ['#f00', '#00f'],
    grid: Int8Array.from([0, 1, 0, 1]),
    columns: [[{ color: 0, ammo: 2 }], [{ color: 1, ammo: 2 }]],
    slots: 1,
    beltCapacity: 2,
  };

  it('clears matching pixels while travelling around the belt', () => {
    const game = new Game(def);
    expect(game.launchFromQueue(0)).toBe(true);
    expect(game.launchFromQueue(1)).toBe(true);
    for (let i = 0; i < 40 && game.status === 'playing'; i++) game.tick();
    expect(game.status).toBe('won');
    expect(game.remaining).toBe(0);
  });

  it('parks shooters with ammo left and loses when no slot is free', () => {
    const game = new Game({ ...def, columns: [[{ color: 1, ammo: 2 }], [{ color: 1, ammo: 2 }]], grid: Int8Array.from([1, 1, 1, 1]), slots: 0 });
    game.launchFromQueue(0);
    game.launchFromQueue(1);
    for (let i = 0; i < 40 && game.status === 'playing'; i++) game.tick();
    expect(game.status).toBe('won');

    const lose = new Game({ ...def, grid: Int8Array.from([1, 1, 1, 1]), palette: ['#f00', '#00f'], columns: [[{ color: 0, ammo: 1 }], [{ color: 1, ammo: 4 }]], slots: 0 });
    lose.launchFromQueue(0);
    for (let i = 0; i < 40 && lose.status === 'playing'; i++) lose.tick();
    expect(lose.status).toBe('lost');
  });

  it('respects the belt capacity', () => {
    const game = new Game({ ...def, beltCapacity: 1 });
    expect(game.launchFromQueue(0)).toBe(true);
    expect(game.launchFromQueue(1)).toBe(false);
  });
});
