import { Game, LevelDef, Shooter, exposedCounts } from './game';
import { Rng, hashSeed } from './rng';

/**
 * A simple greedy bot used by the level generator to make sure each generated level
 * can actually be beaten. It sends out the shooter whose color currently has the most
 * reachable pixels (minus the ammo of that color already travelling on the belt).
 */
export function decide(game: Game): void {
  const colors = game.def.palette.length;
  while (game.canLaunch()) {
    const exposed = exposedCounts(game.grid, game.width, game.height, colors);
    const inFlight = new Array<number>(colors).fill(0);
    for (const s of game.belt) inFlight[s.color] += s.ammo;
    for (const s of game.pending) inFlight[s.color] += s.ammo;

    let best: { kind: 'slot' | 'queue'; index: number; score: number } | null = null;
    const consider = (kind: 'slot' | 'queue', index: number, s: Shooter) => {
      // Prefer parked shooters slightly: launching them frees a slot.
      const score = exposed[s.color] - inFlight[s.color] + (kind === 'slot' ? 0.5 : 0);
      if (!best || score > best.score) best = { kind, index, score };
    };
    game.slots.forEach((s, i) => s && consider('slot', i, s));
    game.queues.forEach((q, i) => q.length && consider('queue', i, q[0]));
    const choice = best as { kind: 'slot' | 'queue'; index: number; score: number } | null;
    if (!choice) return;

    if (choice.score > 0.5) {
      launch(game, choice.kind, choice.index);
      continue;
    }
    // Nothing useful right now. If the belt is idle we must cycle a queued shooter to dig deeper.
    if (game.beltLoad === 0) {
      const q = game.queues.findIndex((col) => col.length > 0);
      if (q >= 0) game.launchFromQueue(q);
      else launch(game, choice.kind, choice.index);
    }
    return;
  }
}

function launch(game: Game, kind: 'slot' | 'queue', index: number): void {
  if (kind === 'slot') game.launchFromSlot(index);
  else game.launchFromQueue(index);
}

export interface BotResult {
  won: boolean;
  ticks: number;
}

export function botPlay(def: LevelDef, maxTicks = 40000): BotResult {
  const game = new Game(def);
  while (game.status === 'playing' && game.ticks < maxTicks) {
    decide(game);
    game.tick();
    game.events.length = 0;
  }
  return { won: game.status === 'won', ticks: game.ticks };
}

/**
 * One playthrough by a player who taps blindly: whenever there is room on the belt it sometimes
 * launches a random queue front or parked shooter. Used to measure how forgiving a level is.
 */
function randomPlay(def: LevelDef, rng: Rng, maxTicks: number): boolean {
  const game = new Game(def);
  const options: { slot: boolean; index: number }[] = [];
  while (game.status === 'playing' && game.ticks < maxTicks) {
    if (game.canLaunch() && rng.chance(0.3)) {
      options.length = 0;
      game.queues.forEach((q, index) => q.length && options.push({ slot: false, index }));
      game.slots.forEach((s, index) => s && options.push({ slot: true, index }));
      if (options.length) {
        const o = rng.pick(options);
        if (o.slot) game.launchFromSlot(o.index);
        else game.launchFromQueue(o.index);
      }
    }
    game.tick();
    game.events.length = 0;
  }
  return game.status === 'won';
}

/**
 * Share of blind random playthroughs that win (0..1). This is the generator's difficulty
 * measure: 1 means you cannot lose, small values mean every tap has to be planned.
 */
export function randomWinRate(def: LevelDef, plays = 40, seed = 1): number {
  const rng = new Rng(hashSeed(def.level, seed));
  let wins = 0;
  for (let i = 0; i < plays; i++) if (randomPlay(def, rng, 8000)) wins++;
  return wins / plays;
}
