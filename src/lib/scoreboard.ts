/** PAR to 11, win by two, best of five. The point history is kept so Undo can reopen a game. */

export const GAME_TARGET = 11;
export const GAMES_TO_WIN = 3;

export type Side = 'a' | 'b';

export type Game = { a: number; b: number };

export type ScoreState = {
  games: Side[][];
};

export function freshMatch(): ScoreState {
  return { games: [[]] };
}

export function scoreOf(points: Side[]): Game {
  let a = 0;
  let b = 0;
  for (const point of points) {
    if (point === 'a') a += 1;
    else b += 1;
  }
  return { a, b };
}

export function gameWon(game: Game): boolean {
  const high = Math.max(game.a, game.b);
  return high >= GAME_TARGET && Math.abs(game.a - game.b) >= 2;
}

/** A finished game that could actually be played: it stops on the first winning point. */
export function legalGame(game: Game): boolean {
  if (!gameWon(game)) return false;
  const high = Math.max(game.a, game.b);
  const low = Math.min(game.a, game.b);
  if (high === GAME_TARGET) return low <= GAME_TARGET - 2;
  return low === high - 2;
}

export function finishedGames(state: ScoreState): Game[] {
  return state.games.map(scoreOf).filter(gameWon);
}

export function gamesWon(state: ScoreState): Game {
  let a = 0;
  let b = 0;
  for (const game of finishedGames(state)) {
    if (game.a > game.b) a += 1;
    else b += 1;
  }
  return { a, b };
}

export function matchWinner(state: ScoreState): Side | null {
  const games = gamesWon(state);
  if (games.a >= GAMES_TO_WIN) return 'a';
  if (games.b >= GAMES_TO_WIN) return 'b';
  return null;
}

/** The game on court now. After a game, and before the next point, this is 0–0. */
export function currentGame(state: ScoreState): Game {
  const last = state.games[state.games.length - 1] ?? [];
  const game = scoreOf(last);
  if (gameWon(game) && !matchWinner(state)) return { a: 0, b: 0 };
  return game;
}

export function addPoint(state: ScoreState, side: Side): ScoreState {
  if (matchWinner(state)) return state;
  const games = state.games.map((points) => [...points]);
  if (!games.length) games.push([]);
  const last = games[games.length - 1];
  if (gameWon(scoreOf(last))) games.push([side]);
  else last.push(side);
  return { games };
}

export function undoPoint(state: ScoreState): ScoreState {
  const games = state.games.map((points) => [...points]);
  if (!games.length) return freshMatch();
  const last = games[games.length - 1];
  if (last.length) {
    last.pop();
    if (!last.length && games.length > 1) games.pop();
    return { games: games.length ? games : [[]] };
  }
  if (games.length > 1) {
    games.pop();
    games[games.length - 1].pop();
    return { games };
  }
  return freshMatch();
}

export function hasPoints(state: ScoreState): boolean {
  return state.games.some((points) => points.length > 0);
}

export function scoreLine(state: ScoreState): string {
  const parts = finishedGames(state).map((game) => `${game.a}-${game.b}`);
  const last = state.games[state.games.length - 1] ?? [];
  const current = scoreOf(last);
  if (!gameWon(current) && (current.a > 0 || current.b > 0)) parts.push(`${current.a}-${current.b}`);
  return parts.join(', ');
}

/** Best of five that ends when one player reaches three games, every game a legal PAR result. */
export function legalMatch(games: Game[]): Side | null {
  if (games.length < GAMES_TO_WIN || games.length > GAMES_TO_WIN * 2 - 1) return null;
  let a = 0;
  let b = 0;
  for (let i = 0; i < games.length; i += 1) {
    const game = games[i];
    if (!legalGame(game)) return null;
    if (game.a > game.b) a += 1;
    else b += 1;
    const decided = a >= GAMES_TO_WIN || b >= GAMES_TO_WIN;
    if (decided && i < games.length - 1) return null;
  }
  if (a >= GAMES_TO_WIN) return 'a';
  if (b >= GAMES_TO_WIN) return 'b';
  return null;
}

export function cleanName(raw: string): string | null {
  const clean = raw.trim().replace(/\s+/g, ' ');
  if (clean.length < 2 || clean.length > 80) return null;
  if (!/^[A-Za-z][A-Za-z .'-]*$/.test(clean)) return null;
  return clean;
}
