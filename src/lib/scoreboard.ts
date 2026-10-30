/**
 * PAR scoring for one singles match, from the World Squash singles rules (2024).
 *
 * A rally winner scores one point and serves next (rule 2.1). Games are to 11,
 * and from 10-all a player must lead by two (rule 2.2). Second-division matches
 * use the same rule to 15. A match is the best of five.
 *
 * The first server is the one who won the spin (rule 5.1). At the start of each
 * game, and after hand-out, that server chooses the service box. This board
 * starts them on the right. While the same player keeps the serve, the box
 * changes side (rule 5.2). A let is served again from the same box (rule 5.3).
 * Hand-out is a change of server.
 */

export const GAME_TARGET = 11;
export const GAMES_TO_WIN = 3;
export type GameTarget = 11 | 15;

export function gameTarget(state: { target?: number } | null | undefined): GameTarget {
  return state?.target === 15 ? 15 : 11;
}

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
  /** 11 is the usual game. 15 is the second-division game. Missing means 11. */
  target?: GameTarget;
};

export function freshMatch(server: Player = 'a', target: GameTarget = 11): ScoreState {
  return { games: [[]], server, box: 'R', choosing: true, target };
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

export function gameWon(game: Game, target: GameTarget = 11): boolean {
  const high = Math.max(game.a, game.b);
  return high >= target && Math.abs(game.a - game.b) >= 2;
}

/** A finished game that stops on the first winning point. */
export function legalGame(game: Game, target: GameTarget = 11): boolean {
  if (!gameWon(game, target)) return false;
  const high = Math.max(game.a, game.b);
  const low = Math.min(game.a, game.b);
  if (high === target) return low <= target - 2;
  return low === high - 2;
}

export function finishedGames(state: ScoreState): Game[] {
  const target = gameTarget(state);
  return state.games.map(scoreOf).filter((game) => gameWon(game, target));
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
  if (gameWon(score, gameTarget(state)) && last.length) return state;
  last.push({
    winner: 'let',
    server: state.server,
    box: state.box,
    choosing: state.choosing,
    a: score.a,
    b: score.b,
    handOut: false,
  });
  return { games, server: state.server, box: state.box, choosing: false, target: gameTarget(state) };
}

export function addPoint(state: ScoreState, winner: Player): ScoreState {
  if (matchWinner(state)) return state;
  const games = cloneGames(state.games);
  if (!games.length) games.push([]);
  const last = games[games.length - 1];
  const score = scoreOf(last);
  const target = gameTarget(state);
  if (gameWon(score, target) && last.length) return state;
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
  if (gameWon(next, target)) {
    const carried: ScoreState = { games, server: state.server, box: state.box, choosing: false, target };
    const won = gamesWon(carried);
    const leader = next.a > next.b ? 'a' : 'b';
    const taken = leader === 'a' ? won.a : won.b;
    if (taken >= GAMES_TO_WIN) {
      return { games, server: leader, box: state.box, choosing: false, target };
    }
    games.push([]);
    return { games, server: leader, box: 'R', choosing: true, target };
  }
  if (handOut) return { games, server: winner, box: 'R', choosing: true, target };
  return { games, server: state.server, box: otherBox(state.box), choosing: false, target };
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
  if (!last?.length) return freshMatch(state.server, gameTarget(state));
  const rally = last.pop()!;
  if (!last.length && games.length > 1) games.pop();
  if (!games.length) games.push([]);
  return { games, server: rally.server, box: rally.box, choosing: rally.choosing, target: gameTarget(state) };
}

export function hasRallies(state: ScoreState): boolean {
  return state.games.some((rallies) => rallies.length > 0);
}

export function scoreLine(state: ScoreState): string {
  const parts = finishedGames(state).map((game) => `${game.a}-${game.b}`);
  const current = currentGame(state);
  if (!gameWon(current, gameTarget(state)) && (current.a > 0 || current.b > 0)) parts.push(`${current.a}-${current.b}`);
  return parts.join(', ');
}

export function legalMatch(games: Game[], target: GameTarget = 11): Player | null {
  if (games.length < GAMES_TO_WIN || games.length > GAMES_TO_WIN * 2 - 1) return null;
  let a = 0;
  let b = 0;
  for (let i = 0; i < games.length; i += 1) {
    const game = games[i];
    if (!legalGame(game, target)) return null;
    if (game.a > game.b) a += 1;
    else b += 1;
    const decided = a >= GAMES_TO_WIN || b >= GAMES_TO_WIN;
    if (decided && i < games.length - 1) return null;
  }
  if (a >= GAMES_TO_WIN) return 'a';
  if (b >= GAMES_TO_WIN) return 'b';
  return null;
}

function deuceAlready(rallies: Rally[], target: GameTarget): boolean {
  const mark = target - 1;
  let seen = 0;
  for (const rally of rallies) {
    if (rally.a === mark && rally.b === mark && rally.winner !== 'let') seen += 1;
  }
  return seen > 1;
}

function deuceCall(target: GameTarget): string {
  const word = target === 15 ? 'Fourteen' : 'Ten';
  return `${word} all. A player must win by two.`;
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
  const target = gameTarget(state);
  const deuce = target - 1;
  if (score.a === deuce && score.b === deuce && !deuceAlready(live, target)) note = 'ten-all';
  else if (!gameWon(score, target)) {
    const games = gamesWon(state);
    for (const player of ['a', 'b'] as const) {
      const next = player === 'a' ? { a: score.a + 1, b: score.b } : { a: score.a, b: score.b + 1 };
      if (!gameWon(next, target)) continue;
      const held = player === 'a' ? games.a : games.b;
      note = held + 1 >= GAMES_TO_WIN ? 'match-ball' : 'game-ball';
      break;
    }
  }
  return { server: serverPoints, receiver: receiverPoints, handOut: rally.handOut, let: false, stroke: Boolean(rally.stroke), note };
}

function spokenPoint(n: number) {
  return n === 0 ? 'love' : String(n);
}

/** Server's score first. Level scores are "7 all", and 0–0 is "love all". */
function spokenPair(server: number | string, receiver: number | string) {
  const left = String(server);
  const right = String(receiver);
  if (left === right) return left === '0' ? 'love all' : `${left} all`;
  const say = (n: string) => (n === '0' ? 'love' : n);
  return `${say(left)}, ${say(right)}`;
}

function firstName(full: string) {
  const cleaned = full.trim().replace(/\s+/g, ' ');
  return cleaned ? cleaned.split(' ')[0] : '';
}

/** Games in hand, from the named player's side. "Sam, 1 game to love." */
function gamesInHand(name: string, mine: number, theirs: number) {
  const word = mine === 1 ? 'game' : 'games';
  if (mine === theirs) return `${mine} ${mine === 1 ? 'game' : 'games'} all`;
  if (theirs === 0) return `${name}, ${mine} ${word} to love`;
  return `${name}, ${mine} ${word} to ${theirs}`;
}

/** A short line for the browser to read aloud. The server's score comes first, with first names. */
export function spokenMark(state: ScoreState, names: { a: string; b: string }, breakPhase: 'play' | 'next' | 'rest' | 'done'): string {
  const a = firstName(names.a) || 'Player';
  const b = firstName(names.b) || 'Player';
  const named = (side: Player) => (side === 'a' ? a : b);
  const server = named(state.server);
  const winner = matchWinner(state);
  if (winner) {
    const who = named(winner);
    const games = finishedGames(state)
      .map((game) => {
        const high = Math.max(game.a, game.b);
        const low = Math.min(game.a, game.b);
        return `${spokenPoint(high)}, ${spokenPoint(low)}`;
      })
      .join('. ');
    const held = gamesWon(state);
    const mine = winner === 'a' ? held.a : held.b;
    const theirs = winner === 'a' ? held.b : held.a;
    const tally = gamesInHand(who, mine, theirs);
    return games ? `${who} wins the match. ${games}. ${tally}.` : `${who} wins the match. ${tally}.`;
  }
  if (breakPhase === 'next' || breakPhase === 'rest') {
    const games = finishedGames(state);
    const last = games[games.length - 1];
    if (!last) return `${server} to serve, love all.`;
    const leader: Player = last.a > last.b ? 'a' : 'b';
    const who = named(leader);
    const high = Math.max(last.a, last.b);
    const low = Math.min(last.a, last.b);
    const held = gamesWon(state);
    const mine = leader === 'a' ? held.a : held.b;
    const theirs = leader === 'a' ? held.b : held.a;
    return `${who} wins ${spokenPoint(high)}, ${spokenPoint(low)}. ${gamesInHand(who, mine, theirs)}. ${server} to serve, love all.`;
  }
  const called = markerCall(state);
  if (!called) {
    if (finishedGames(state).length) return `${server} to serve, love all.`;
    return `${a} versus ${b}. ${server} to serve, love all.`;
  }
  const score = spokenPair(called.server, called.receiver);
  if (called.let) return `Yes let. ${score}.`;
  if (called.note === 'ten-all') return deuceCall(gameTarget(state));
  const rally = currentRallies(state)[currentRallies(state).length - 1];
  const strokeTo = called.stroke && rally && rally.winner !== 'let' ? `Stroke to ${named(rally.winner)}` : called.stroke ? 'Stroke' : '';
  const lead = [strokeTo, called.handOut ? 'Hand out' : '', called.note === 'match-ball' ? 'Match ball' : called.note === 'game-ball' ? 'Game ball' : '']
    .filter(Boolean)
    .join('. ');
  if (called.handOut) return `${lead}. ${score}. ${server}.`;
  return lead ? `${lead}. ${score}.` : `${score}.`;
}

/** A score with no point-by-point history: first names, then the score. */
export function spokenPublicLine(playerA: string, playerB: string, score: string): string {
  const a = firstName(playerA);
  const b = firstName(playerB);
  const intro = a && b ? `${a} versus ${b}. ` : '';
  const trimmed = score.replace(/[–—]/g, '-').trim();
  if (!trimmed || trimmed === '0-0') return `${intro}Love all.`;
  return `${intro}${spokenScoreLine(trimmed)}`;
}

export type LiveClock = {
  line: string;
  /** Finished games, as mm:ss. */
  times: string[];
  /** The game on court, as mm:ss. Empty between games. */
  clock: string;
  /** Increases when the next game actually starts, so a watcher can say the score again. */
  restart: number;
  /** The marker's call, so a public watcher can hear it without the point history. */
  call: string;
};

/** The public score, finished times, the live clock, the restart count, and the words to say. */
export function packLiveScore(line: string, times: string[], clock: string, restart: number, call = ''): string {
  const score = line.trim() || '0-0';
  const spoken = call.replace(/\s+/g, ' ').trim();
  const withTimes = `${score}||${times.join(',')}||${clock}||${restart}||${spoken}`;
  if (withTimes.length <= 120) return withTimes;
  const bare = `${score}||||${clock}||${restart}||`;
  const room = 120 - bare.length;
  if (room <= 0) return score.slice(0, 120);
  return `${bare}${spoken.slice(0, room)}`;
}

export function unpackLiveScore(raw: string): LiveClock {
  const parts = (raw || '').split('||');
  if (parts.length < 4) return { line: (raw || '0-0').trim() || '0-0', times: [], clock: '', restart: 0, call: '' };
  const restart = Number(parts[3]);
  return {
    line: parts[0].trim() || '0-0',
    times: parts[1] ? parts[1].split(',').map((part) => part.trim()).filter(Boolean) : [],
    clock: parts[2].trim(),
    restart: Number.isFinite(restart) ? restart : 0,
    call: (parts[4] || '').trim(),
  };
}

/** Turns a score line such as 11-0, 4-2 into words. */
export function spokenScoreLine(score: string): string {
  const parts = score
    .split(',')
    .map((part) => {
      const bits = part.trim().split('-');
      if (bits.length !== 2) return part.trim();
      return spokenPair(bits[0], bits[1]);
    })
    .filter(Boolean);
  return parts.length ? `${parts.join('. ')}.` : '';
}

/** A live match drops off the site after an hour with no score. */
export const LIVE_IDLE_MS = 60 * 60 * 1000;

export function liveMatchCurrent(updatedAt: string, now = Date.now()): boolean {
  const then = new Date(updatedAt).getTime();
  return !Number.isNaN(then) && now - then <= LIVE_IDLE_MS;
}
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
  return {
    games,
    server: value.server,
    box: value.box,
    choosing: Boolean(value.choosing),
    target: value.target === 15 ? 15 : 11,
  };
}
