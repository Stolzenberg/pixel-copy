import { describe, expect, it } from 'vitest';
import { THEMES } from '../src/themes';
import { LEVELS_PER_BIOME, biome, biomeOfLevel, isBossLevel } from '../src/world';

describe('overworld', () => {
  it('starts in the animal biome', () => {
    expect(biomeOfLevel(1).theme.id).toBe('animals');
    expect(biomeOfLevel(LEVELS_PER_BIOME).index).toBe(0);
    expect(biomeOfLevel(LEVELS_PER_BIOME + 1).index).toBe(1);
  });

  it('never repeats a theme in two neighbouring biomes and uses every theme', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      seen.add(biome(i).theme.id);
      if (i > 0) expect(biome(i).theme.id).not.toBe(biome(i - 1).theme.id);
    }
    expect(seen.size).toBe(THEMES.length);
  });

  it('marks the last level of each biome as a boss level', () => {
    expect(isBossLevel(10)).toBe(true);
    expect(isBossLevel(11)).toBe(false);
  });
});

describe('themes', () => {
  it('has well-formed sprites', () => {
    for (const theme of THEMES) {
      for (const sprite of theme.sprites) {
        const w = sprite.rows[0].length;
        for (const row of sprite.rows) {
          expect(row.length, `${sprite.name}`).toBe(w);
          for (const ch of row) if (ch !== '.') expect(sprite.colors[ch], `${sprite.name}: ${ch}`).toBeDefined();
        }
        expect(Object.keys(sprite.colors).length).toBeLessThanOrEqual(7);
      }
    }
  });
});
