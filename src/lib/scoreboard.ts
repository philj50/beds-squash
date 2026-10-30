/**
 * PAR scoring for one singles match, from the World Squash singles rules (2024).
 *
 * A rally winner scores one point and serves next (rule 2.1). Games are to 11,
 * and from 10-all a player must lead by two (rule 2.2). A match is the best of five.
 *
 * The first server is the one who won the spin (rule 5.1). At the start of each
 * game, and after hand-out, that server chooses the service box. This board
 * starts them on the right. While the same player keeps the serve, the box
 * changes side (rule 5.2). A let is served again from the same box (rule 5.3).
 * Hand-out is a change of server.
 */

export const GAME_TARGET = 11;
export const GAMES_TO_WIN = 3;

export type Player = 'a' | 'b';
export type Side = Player;
export type Box = 'R' | 'L';

export type Game = { a: number; b: number };

export type Rally = {
  winner: Player | 'let';
  server: Player;
  box: Box;
  choosing: boolean;
  a: number;
  b: number;
  handOut: boolean;
  /** A stroke awards the point. A let has no score. */
  stroke?: boolean;
};

export type ScoreState = {
  games: Rally[][];
  server: Player;
  box: Box;
  choosing: boolean;
};

export function freshMatch(server: Player = 'a'): ScoreState {
  return { games: [[]], server, box: 'R', choosing: true };
}

export function otherBox(box: Box): Box {
  return box === 'R' ? 'L' : 'R';
}

export function otherPlayer(player: Player): Player {
  return player === 'a' ? 'b' : 'a';
}

export function scoreOf(rallies: Rally[]): Game {
  let a = 0;
  let b = 0;
  for (const rally of rallies) {
    if (rally.winner === 'a') a += 1;
    else if (rally.winner === 'b') b += 1;
  }
  return { a, b };
}

export function gameWon(game: Game): boolean {
  const high = Math.max(game.a, game.b);
  return high >= GAME_TARGET && Math.abs(game.a - game.b) >= 2;
}

/** A finished game that stops on the first winning point. */
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

export function matchWinner(state: ScoreState): Player | null {
  const games = gamesWon(state);
  if (games.a >= GAMES_TO_WIN) return 'a';
  if (games.b >= GAMES_TO_WIN) return 'b';
  return null;
}

/** The game on court. After a game, and before the next rally, this is 0–0. */
export function currentGame(state: ScoreState): Game {
  const last = state.games[state.games.length - 1] ?? [];
  return scoreOf(last);
}

export function currentRallies(state: ScoreState): Rally[] {
  return state.games[state.games.length - 1] ?? [];
}

/** The winner of the game serves the next one. The box can be changed until the first rally. */
export function canChooseServer(state: ScoreState): boolean {
  if (matchWinner(state)) return false;
  return currentRallies(state).length === 0;
}

function cloneGames(games: Rally[][]): Rally[][] {
  return games.map((rallies) => rallies.map((rally) => ({ ...rally })));
}

export function setBox(state: ScoreState, box: Box): ScoreState {
  if (matchWinner(state) || (box !== 'R' && box !== 'L') || state.box === box) return state;
  return { ...state, box };
}

export function setServer(state: ScoreState, server: Player): ScoreState {
  if (!canChooseServer(state) || state.server === server) return state;
  return { ...state, server };
}

export function addLet(state: ScoreState): ScoreState {
  if (matchWinner(state)) return state;
  const games = cloneGames(state.games);
  if (!games.length) games.push([]);
  const last = games[games.length - 1];
  const score = scoreOf(last);
  if (gameWon(score) && last.length) return state;
  last.push({
    winner: 'let',
    server: state.server,
    box: state.box,
    choosing: state.choosing,
    a: score.a,
    b: score.b,
    handOut: false,
  });
  return { games, server: state.server, box: state.box, choosing: false };
}

export function addPoint(state: ScoreState, winner: Player): ScoreState {
  if (matchWinner(state)) return state;
  const games = cloneGames(state.games);
  if (!games.length) games.push([]);
  const last = games[games.length - 1];
  const score = scoreOf(last);
  if (gameWon(score) && last.length) return state;
  const next = {
    a: score.a + (winner === 'a' ? 1 : 0),
    b: score.b + (winner === 'b' ? 1 : 0),
  };
  const handOut = winner !== state.server;
  last.push({
    winner,
    server: state.server,
    box: state.box,
    choosing: state.choosing,
    a: next.a,
    b: next.b,
    handOut,
  });
  if (gameWon(next)) {
    const won = gamesWon({ games, server: state.server, box: state.box, choosing: false });
    const leader = next.a > next.b ? 'a' : 'b';
    const taken = leader === 'a' ? won.a : won.b;
    if (taken >= GAMES_TO_WIN) {
      return { games, server: leader, box: state.box, choosing: false };
    }
    games.push([]);
    return { games, server: leader, box: 'R', choosing: true };
  }
  if (handOut) return { games, server: winner, box: 'R', choosing: true };
  return { games, server: state.server, box: otherBox(state.box), choosing: false };
}

/** A stroke is a point, awarded to the player named, and it is marked as a stroke. */
export function addStroke(state: ScoreState, winner: Player): ScoreState {
  if (matchWinner(state)) return state;
  const next = addPoint(state, winner);
  if (next === state) return state;
  const games = cloneGames(next.games);
  for (let i = games.length - 1; i >= 0; i -= 1) {
    const rally = games[i][games[i].length - 1];
    if (!rally) continue;
    if (rally.winner === winner) rally.stroke = true;
    break;
  }
  return { ...next, games };
}

export function undoPoint(state: ScoreState): ScoreState {
  const games = cloneGames(state.games);
  if (games.length > 1 && games[games.length - 1].length === 0) games.pop();
  const last = games[games.length - 1];
  if (!last?.length) return freshMatch(state.server);
  const rally = last.pop()!;
  if (!last.length && games.length > 1) games.pop();
  if (!games.length) games.push([]);
  return { games, server: rally.server, box: rally.box, choosing: rally.choosing };
}

export function hasRallies(state: ScoreState): boolean {
  return state.games.some((rallies) => rallies.length > 0);
}

export function scoreLine(state: ScoreState): string {
  const parts = finishedGames(state).map((game) => `${game.a}-${game.b}`);
  const current = currentGame(state);
  if (!gameWon(current) && (current.a > 0 || current.b > 0)) parts.push(`${current.a}-${current.b}`);
  return parts.join(', ');
}

export function legalMatch(games: Game[]): Player | null {
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

function tenAllAlready(rallies: Rally[]): boolean {
  let seen = 0;
  for (const rally of rallies) {
    if (rally.a === 10 && rally.b === 10 && rally.winner !== 'let') seen += 1;
  }
  return seen > 1;
}

export type ScoreNote = '' | 'ten-all' | 'game-ball' | 'match-ball';

export type StemMark = {
  side: Player;
  text: string;
  box: Box;
  kind: 'point' | 'let' | 'stroke';
};

/** One game as a vertical score sheet: each player's points sit on their own side of the line. */
export function gameStem(rallies: Rally[]): { score: Game; rows: StemMark[] } {
  const rows: StemMark[] = [];
  for (const rally of rallies) {
    if (rally.winner === 'let') {
      rows.push({ side: rally.server, text: 'YL', box: rally.box, kind: 'let' });
      continue;
    }
    rows.push({
      side: rally.winner,
      text: String(rally.winner === 'a' ? rally.a : rally.b),
      box: rally.box,
      kind: rally.stroke ? 'stroke' : 'point',
    });
  }
  return { score: scoreOf(rallies), rows };
}

/** The mark to call after the last rally. The server's score comes first. */
export function markerCall(state: ScoreState): { server: number; receiver: number; handOut: boolean; let: boolean; stroke: boolean; note: ScoreNote } | null {
  const live = currentRallies(state);
  if (!live.length) return null;
  const rally = live[live.length - 1];
  if (!rally) return null;
  const serverPoints = state.server === 'a' ? currentGame(state).a : currentGame(state).b;
  const receiverPoints = state.server === 'a' ? currentGame(state).b : currentGame(state).a;
  if (rally.winner === 'let') {
    const served = rally.server === 'a' ? rally.a : rally.b;
    const received = rally.server === 'a' ? rally.b : rally.a;
    return { server: served, receiver: received, handOut: false, let: true, stroke: false, note: '' };
  }
  let note: ScoreNote = '';
  const score = currentGame(state);
  if (score.a === 10 && score.b === 10 && !tenAllAlready(live)) note = 'ten-all';
  else if (!gameWon(score)) {
    const games = gamesWon(state);
    for (const player of ['a', 'b'] as const) {
      const next = player === 'a' ? { a: score.a + 1, b: score.b } : { a: score.a, b: score.b + 1 };
      if (!gameWon(next)) continue;
      const held = player === 'a' ? games.a : games.b;
      note = held + 1 >= GAMES_TO_WIN ? 'match-ball' : 'game-ball';
      break;
    }
  }
  return { server: serverPoints, receiver: receiverPoints, handOut: rally.handOut, let: false, stroke: Boolean(rally.stroke), note };
}

/** First name and the surname initial, for anyone who is not signed in. */
export function publicPlayerName(fullName: string): string {
  const cleaned = fullName.trim().replace(/\s+/g, ' ');
  if (!cleaned) return '';
  const parts = cleaned.split(' ');
  if (parts.length < 2) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1].charAt(0).toUpperCase()}`;
}

export function cleanName(raw: string): string | null {
  const clean = raw.trim().replace(/\s+/g, ' ');
  if (clean.length < 2 || clean.length > 80) return null;
  if (!/^[A-Za-z][A-Za-z .'-]*$/.test(clean)) return null;
  return clean;
}

export function restoreMatch(raw: unknown): ScoreState | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Partial<ScoreState>;
  if (value.server !== 'a' && value.server !== 'b') return null;
  if (value.box !== 'R' && value.box !== 'L') return null;
  if (!Array.isArray(value.games)) return null;
  const games: Rally[][] = [];
  for (const game of value.games) {
    if (!Array.isArray(game)) return null;
    const rallies: Rally[] = [];
    for (const rally of game) {
      if (!rally || typeof rally !== 'object') return null;
      const row = rally as Partial<Rally>;
      if (row.winner !== 'a' && row.winner !== 'b' && row.winner !== 'let') return null;
      if (row.server !== 'a' && row.server !== 'b') return null;
      if (row.box !== 'R' && row.box !== 'L') return null;
      if (typeof row.a !== 'number' || typeof row.b !== 'number') return null;
      rallies.push({
        winner: row.winner,
        server: row.server,
        box: row.box,
        choosing: Boolean(row.choosing),
        a: row.a,
        b: row.b,
        handOut: Boolean(row.handOut),
        stroke: row.winner !== 'let' && Boolean(row.stroke),
      });
    }
    games.push(rallies);
  }
  if (!games.length) games.push([]);
  return { games, server: value.server, box: value.box, choosing: Boolean(value.choosing) };
}
