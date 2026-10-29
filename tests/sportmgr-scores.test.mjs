import assert from 'node:assert/strict';
import test from 'node:test';
import { freshScores, scoreNote } from '../scripts/sportmgr-lib.mjs';

const played = {
  id: 9,
  grade: 'A Grade',
  home: 'Ada',
  away: 'Bo',
  score: '3-1',
  court: '2',
  start: '10:00',
};

test('the first copy of a tournament sends no score notes', () => {
  assert.deepEqual(freshScores([], [played]), []);
});

test('a new or changed score is announced, and a blank result is not', () => {
  const stored = [
    { id: 9, score: '' },
    { id: 10, score: '3-0' },
  ];
  const matches = [
    played,
    { id: 10, score: '3-0', home: 'Chris', away: 'Di' },
    { id: 11, score: '', home: 'Eve', away: 'Fay' },
    { id: 12, score: '3-2', home: 'Gus', away: 'Hal', grade: 'B Grade', court: '', start: '' },
  ];
  const fresh = freshScores(stored, matches);
  assert.deepEqual(fresh.map((match) => match.id), [9, 12]);
});

test('a score note names the grade, the players and the score', () => {
  assert.equal(scoreNote(played), 'A Grade. Ada v Bo. 3-1. Court 2 at 10:00.');
});
