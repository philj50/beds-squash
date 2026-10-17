import assert from 'node:assert/strict';
import test from 'node:test';
import { choicesByDivision } from '../scripts/squashlevels-daily.mjs';

function rubber(division, home, away, id) {
  return {
    id,
    division,
    home_player: home,
    away_player: away,
    winner: 'home',
    playedOn: '2026-10-12',
    score: '11/5 11/7 11/9',
  };
}

function match(playerId, opponentId, playerLevel, opponentLevel) {
  return {
    playedOn: '2026-10-12',
    playerId,
    opponentId,
    playerLevelBefore: playerLevel,
    opponentLevelBefore: opponentLevel,
    playerLevelAfter: playerLevel,
    opponentLevelAfter: opponentLevel,
  };
}

test('each division gets its own match, and an upset is preferred', () => {
  const names = new Map([
    ['ann able', { playerId: '1' }],
    ['ben ball', { playerId: '2' }],
    ['cara cole', { playerId: '3' }],
    ['dan dale', { playerId: '4' }],
    ['eva east', { playerId: '5' }],
    ['fay ford', { playerId: '6' }],
  ]);
  const rubbers = [
    rubber('Division 1', 'Ann Able', 'Ben Ball', 1),
    rubber('Division 1', 'Cara Cole', 'Dan Dale', 2),
    rubber('Division 2', 'Eva East', 'Fay Ford', 3),
  ];
  const matches = [
    match('1', '2', 2000, 2010),
    match('3', '4', 1400, 1800),
    match('5', '6', 1800, 1600),
  ];
  const choices = choicesByDivision(rubbers, names, matches);
  assert.deepEqual(
    choices.map((choice) => [choice.rubber.division, choice.rubber.id, choice.upset]),
    [
      ['Division 1', 2, true],
      ['Division 2', 3, false],
    ],
  );
});
