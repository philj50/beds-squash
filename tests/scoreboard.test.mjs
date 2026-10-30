import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  addPoint,
  cleanName,
  currentGame,
  freshMatch,
  gameWon,
  legalGame,
  legalMatch,
  matchWinner,
  scoreLine,
  undoPoint,
} from '../src/lib/scoreboard.ts';

function play(state, side, times) {
  let next = state;
  for (let i = 0; i < times; i += 1) next = addPoint(next, side);
  return next;
}

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

test('points build a game, then the next game starts at love', () => {
  let state = freshMatch();
  state = play(state, 'a', 11);
  assert.deepEqual(currentGame(state), { a: 0, b: 0 });
  assert.equal(scoreLine(state), '11-0');
  state = addPoint(state, 'b');
  assert.deepEqual(currentGame(state), { a: 0, b: 1 });
  assert.equal(scoreLine(state), '11-0, 0-1');
});

test('deuce needs two clear points', () => {
  let state = freshMatch();
  state = play(state, 'a', 10);
  state = play(state, 'b', 10);
  assert.equal(gameWon(currentGame(state)), false);
  state = addPoint(state, 'a');
  assert.deepEqual(currentGame(state), { a: 11, b: 10 });
  state = addPoint(state, 'a');
  assert.equal(scoreLine(state), '12-10');
  assert.deepEqual(currentGame(state), { a: 0, b: 0 });
});

test('undo reopens the game that just finished', () => {
  let state = play(freshMatch(), 'a', 11);
  state = undoPoint(state);
  assert.deepEqual(currentGame(state), { a: 10, b: 0 });
  assert.equal(scoreLine(state), '10-0');
  state = undoPoint(state);
  assert.deepEqual(currentGame(state), { a: 9, b: 0 });
});

test('best of five stops when one player has three games', () => {
  let state = freshMatch();
  state = play(state, 'a', 11);
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
  assert.equal(legalMatch([
    { a: 11, b: 0 },
    { a: 11, b: 0 },
    { a: 11, b: 0 },
    { a: 11, b: 0 },
  ]), null);
});

test('names keep an apostrophe and reject a blank or a duplicate shape', () => {
  assert.equal(cleanName("  James   O'Connor "), "James O'Connor");
  assert.equal(cleanName('A'), null);
  assert.equal(cleanName('Max2'), null);
});
