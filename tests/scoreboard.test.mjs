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
  matchWinner,
  publicPlayerName,
  restoreMatch,
  scoreLine,
  setBox,
  setServer,
  undoPoint,
} from '../src/lib/scoreboard.ts';

function play(state, side, times) {
  let next = state;
  for (let i = 0; i < times; i += 1) next = addPoint(next, side);
  return next;
}

test('a public name is the first name and the surname initial', () => {
  assert.equal(publicPlayerName('Alex Hart'), 'Alex H');
  assert.equal(publicPlayerName("James O'Connor"), 'James O');
  assert.equal(publicPlayerName('Mary Ann Smith'), 'Mary S');
  assert.equal(publicPlayerName('Alex'), 'Alex');
  assert.equal(publicPlayerName('  Sam   Haigh '), 'Sam H');
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
