import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  addLet,
  addPoint,
  addStroke,
  cleanName,
  currentGame,
  freshMatch,
  gameStem,
  gameWon,
  legalGame,
  legalMatch,
  markerCall,
  liveMatchCurrent,
  matchWinner,
  publicPlayerName,
  restoreMatch,
  scoreLine,
  spokenMark,
  packLiveScore,
  spokenPublicLine,
  spokenScoreLine,
  unpackLiveScore,
  setBox,
  setServer,
  undoPoint,
} from '../src/lib/scoreboard.ts';

function play(state, side, times) {
  let next = state;
  for (let i = 0; i < times; i += 1) next = addPoint(next, side);
  return next;
}

test('the spoken score uses first names and puts the server first', () => {
  const names = { a: 'Phil Jenkins', b: 'Sam Cole' };
  let state = freshMatch();
  assert.equal(spokenMark(state, names, 'play'), 'Phil versus Sam. Phil to serve, love all.');
  state = setServer(state, 'b');
  assert.equal(spokenMark(state, names, 'play'), 'Phil versus Sam. Sam to serve, love all.');
  state = setServer(state, 'a');
  state = addPoint(state, 'a');
  assert.equal(spokenMark(state, names, 'play'), '1, love.');
  state = addPoint(state, 'a');
  assert.equal(spokenMark(state, names, 'play'), '2, love.');
  state = addLet(state);
  assert.equal(spokenMark(state, names, 'play'), 'Yes let. 2, love.');
  state = addPoint(state, 'b');
  assert.equal(spokenMark(state, names, 'play'), 'Hand out. 1, 2. Sam.');
  state = freshMatch();
  state = play(state, 'a', 7);
  state = play(state, 'b', 7);
  assert.equal(spokenMark(state, names, 'play'), '7 all.');
  state = addLet(state);
  assert.equal(spokenMark(state, names, 'play'), 'Yes let. 7 all.');
  state = freshMatch();
  state = addStroke(state, 'a');
  assert.equal(spokenMark(state, names, 'play'), 'Stroke to Phil. 1, love.');
  state = freshMatch();
  state = addStroke(state, 'b');
  assert.equal(spokenMark(state, names, 'play'), 'Stroke to Sam. Hand out. 1, love. Sam.');
  state = freshMatch();
  state = play(state, 'a', 11);
  assert.equal(
    spokenMark(state, names, 'next'),
    'Phil wins 11, love. Phil, 1 game to love. Phil to serve, love all.',
  );
  state = play(state, 'a', 11);
  state = play(state, 'a', 11);
  assert.equal(
    spokenMark(state, names, 'play'),
    'Phil wins the match. 11, love. 11, love. 11, love. Phil, 3 games to love.',
  );
  assert.equal(spokenScoreLine('11-0, 4-2'), '11, love. 4, 2.');
  assert.equal(spokenScoreLine('11-8, 7-7'), '11, 8. 7 all.');
  assert.equal(spokenPublicLine('Phil Jenkins', 'Sam Cole', '0-0'), 'Phil versus Sam. Love all.');
  assert.equal(spokenPublicLine('Phil Jenkins', 'Sam Cole', '11-8, 4-2'), 'Phil versus Sam. 11, 8. 4, 2.');
});

test('a shared score carries the game times and the restart', () => {
  const packed = packLiveScore('11-8, 4-2', ['12:04', '03:10'], '01:02', 2);
  const live = unpackLiveScore(packed);
  assert.equal(live.line, '11-8, 4-2');
  assert.deepEqual(live.times, ['12:04', '03:10']);
  assert.equal(live.clock, '01:02');
  assert.equal(live.restart, 2);
  assert.equal(live.call, '');
  const said = packLiveScore('4-2', ['12:04'], '01:02', 0, 'Stroke to Sam. Hand out. 1, love. Sam.');
  assert.equal(unpackLiveScore(said).call, 'Stroke to Sam. Hand out. 1, love. Sam.');
  assert.equal(unpackLiveScore('11-8').line, '11-8');
  assert.equal(unpackLiveScore('11-8').restart, 0);
  assert.equal(unpackLiveScore('11-8').call, '');
});

test('a live match stays up for an hour', () => {
  const now = Date.parse('2026-10-30T15:00:00Z');
  assert.equal(liveMatchCurrent('2026-10-30T14:10:00Z', now), true);
  assert.equal(liveMatchCurrent('2026-10-30T13:50:00Z', now), false);
});

test('a public name is the first name and the surname initial', () => {
  assert.equal(publicPlayerName('Alex Hart'), 'Alex H');
  assert.equal(publicPlayerName("James O'Connor"), 'James O');
  assert.equal(publicPlayerName('Mary Ann Smith'), 'Mary S');
  assert.equal(publicPlayerName('Alex'), 'Alex');
  assert.equal(publicPlayerName('  Sam   Haigh '), 'Sam H');
});

test('PAR 15 is won at 15 with a two-point lead, and 14-all is called once', () => {
  assert.equal(gameWon({ a: 15, b: 13 }, 15), true);
  assert.equal(gameWon({ a: 15, b: 14 }, 15), false);
  assert.equal(gameWon({ a: 11, b: 9 }, 15), false);
  assert.equal(legalGame({ a: 15, b: 0 }, 15), true);
  assert.equal(legalGame({ a: 17, b: 15 }, 15), true);
  let state = freshMatch('a', 15);
  state = play(state, 'a', 14);
  state = play(state, 'b', 14);
  assert.equal(markerCall(state).note, 'ten-all');
  assert.equal(spokenMark(state, { a: 'Phil Jenkins', b: 'Sam Cole' }, 'play'), 'Fourteen all. A player must win by two.');
  state = play(state, 'a', 2);
  assert.equal(state.games[0].at(-1).a, 16);
  assert.equal(state.games[0].at(-1).b, 14);
  assert.equal(state.games.length, 2);
  assert.equal(state.target, 15);
  const saved = restoreMatch(state);
  assert.equal(saved.target, 15);
});

test('a game ends at 11 with a two-point lead', () => {
  assert.equal(gameWon({ a: 11, b: 9 }), true);
  assert.equal(gameWon({ a: 11, b: 10 }), false);
  assert.equal(gameWon({ a: 10, b: 10 }), false);
  assert.equal(gameWon({ a: 12, b: 10 }), true);
  assert.equal(legalGame({ a: 11, b: 0 }), true);
  assert.equal(legalGame({ a: 15, b: 0 }), false);
  assert.equal(legalGame({ a: 13, b: 10 }), false);
  assert.equal(legalGame({ a: 13, b: 11 }), true);
});

test('the first serve is from the right and changes side when the server continues', () => {
  let state = freshMatch();
  assert.equal(state.box, 'R');
  assert.equal(state.server, 'a');
  state = addPoint(state, 'a');
  assert.equal(state.server, 'a');
  assert.equal(state.box, 'L');
  assert.equal(state.choosing, false);
  const rally = state.games[0][0];
  assert.equal(rally.box, 'R');
  assert.equal(rally.handOut, false);
  assert.deepEqual(currentGame(state), { a: 1, b: 0 });
});

test('the opening box can be the left, and that choice is what the rally records', () => {
  let state = setBox(freshMatch(), 'L');
  state = addPoint(state, 'a');
  assert.equal(state.games[0][0].box, 'L');
  assert.equal(state.box, 'R');
});

test('hand out gives the serve to the other player, from the right', () => {
  let state = addPoint(freshMatch(), 'a');
  state = addPoint(state, 'b');
  assert.equal(state.server, 'b');
  assert.equal(state.box, 'R');
  assert.equal(state.choosing, true);
  const handOut = state.games[0][1];
  assert.equal(handOut.handOut, true);
  assert.equal(handOut.box, 'L');
  assert.deepEqual(currentGame(state), { a: 1, b: 1 });
  state = setBox(state, 'L');
  state = addPoint(state, 'b');
  assert.equal(state.server, 'b');
  assert.equal(state.box, 'R');
  assert.equal(state.games[0][2].box, 'L');
});

test('a stroke is a point on the sheet, and a let stays on the server side', () => {
  let state = addStroke(freshMatch(), 'b');
  assert.equal(state.games[0][0].stroke, true);
  assert.equal(state.games[0][0].handOut, true);
  assert.equal(markerCall(state).stroke, true);
  assert.deepEqual(currentGame(state), { a: 0, b: 1 });
  state = addLet(state);
  const stem = gameStem(state.games[0]);
  assert.deepEqual(stem.rows.map((row) => `${row.side}:${row.text}:${row.kind}`), ['b:1:stroke', 'b:YL:let']);
  const saved = restoreMatch(state);
  assert.equal(saved.games[0][0].stroke, true);
  assert.equal(saved.games[0][1].stroke, false);
});

test('a let keeps the same server and the same box', () => {
  let state = addPoint(freshMatch(), 'a');
  assert.equal(state.box, 'L');
  state = addLet(state);
  assert.equal(state.server, 'a');
  assert.equal(state.box, 'L');
  assert.deepEqual(currentGame(state), { a: 1, b: 0 });
  assert.equal(state.games[0][1].winner, 'let');
  const call = markerCall(state);
  assert.equal(call.let, true);
  assert.deepEqual([call.server, call.receiver], [1, 0]);
});

test('the call puts the server score first and says hand out', () => {
  let state = addPoint(freshMatch(), 'b');
  const call = markerCall(state);
  assert.equal(call.handOut, true);
  assert.deepEqual([call.server, call.receiver], [1, 0]);
});

test('10-all is called once, then the leader has game ball', () => {
  let state = freshMatch();
  state = play(state, 'a', 10);
  state = play(state, 'b', 10);
  assert.equal(markerCall(state).note, 'ten-all');
  state = addPoint(state, 'a');
  assert.equal(markerCall(state).note, 'game-ball');
  assert.equal(gameWon(currentGame(state)), false);
});

test('undo puts the serve back on the box it came from', () => {
  let state = play(freshMatch(), 'a', 2);
  assert.equal(state.box, 'R');
  state = undoPoint(state);
  assert.equal(state.server, 'a');
  assert.equal(state.box, 'L');
  assert.deepEqual(currentGame(state), { a: 1, b: 0 });
  state = undoPoint(play(freshMatch(), 'a', 11));
  assert.deepEqual(currentGame(state), { a: 10, b: 0 });
  assert.equal(state.box, 'R');
});

test('the winner of a game serves the next one from the right', () => {
  let state = play(freshMatch(), 'b', 11);
  assert.deepEqual(currentGame(state), { a: 0, b: 0 });
  assert.equal(state.server, 'b');
  assert.equal(state.box, 'R');
  assert.equal(state.choosing, true);
  assert.equal(scoreLine(state), '0-11');
  state = setServer(state, 'a');
  assert.equal(state.server, 'a');
  state = addPoint(state, 'a');
  assert.equal(setServer(state, 'b').server, 'a');
});

test('deuce needs two clear points and the match stops at three games', () => {
  let state = freshMatch();
  state = play(state, 'a', 10);
  state = play(state, 'b', 10);
  state = addPoint(state, 'a');
  state = addPoint(state, 'a');
  assert.equal(scoreLine(state), '12-10');
  state = play(freshMatch(), 'a', 11);
  state = play(state, 'b', 11);
  state = play(state, 'a', 11);
  state = play(state, 'a', 11);
  assert.equal(matchWinner(state), 'a');
  assert.equal(scoreLine(state), '11-0, 0-11, 11-0, 11-0');
  const frozen = addPoint(state, 'b');
  assert.equal(scoreLine(frozen), scoreLine(state));
  assert.equal(legalMatch([
    { a: 11, b: 0 },
    { a: 0, b: 11 },
    { a: 11, b: 0 },
    { a: 11, b: 0 },
  ]), 'a');
});

test('a saved match can be opened again with its serve history', () => {
  const played = addPoint(setBox(freshMatch(), 'L'), 'a');
  const restored = restoreMatch(played);
  assert.equal(restored.games[0][0].box, 'L');
  assert.equal(restored.box, 'R');
  assert.equal(restoreMatch({ server: 'a' }), null);
});

test('names keep an apostrophe and reject a blank', () => {
  assert.equal(cleanName("  James   O'Connor "), "James O'Connor");
  assert.equal(cleanName('A'), null);
  assert.equal(cleanName('Max2'), null);
});
