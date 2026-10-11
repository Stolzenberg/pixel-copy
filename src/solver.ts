import { Game, LevelDef, Shooter, exposedCounts } from './game';

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
