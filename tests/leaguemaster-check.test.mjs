import assert from 'node:assert/strict';
import test from 'node:test';
import { compareDivision, parseLmFixtures, parseLmTable } from '../scripts/check-leaguemaster.mjs';

const fixtureHtml = `
<table>
  <tr class="monthrow"><td colspan="8">October</td></tr>
  <tr class="fDoneRow">
    <td>1</td><td>Mon 12/10/26 19:00</td><td>Biggleswade 1</td><td>Club Towers 2</td>
    <td></td><td><b>8-17</b></td><td><b>2-3</b></td>
    <td><a href="/showmatch?fixtureid=1227&divid=1">View</a></td>
  </tr>
  <tr class="sRow">
    <td>2</td><td>Mon 19/10/26 19:15</td><td>Open University 1</td><td>David Lloyd 1</td>
    <td></td><td></td><td></td>
    <td><a href="/showmatch?fixtureid=1230&divid=1">View</a></td>
  </tr>
</table>`;

const tableHtml = `
<tr class="firstRow"><td>1</td><td><a href="/showteam?teamid=2">Club Towers 2</a></td><td></td><td>1</td><td>1</td><td>0</td><td>0</td><td>17</td><td>8</td><td>0</td><td>17</td></tr>
<tr class="secondRow"><td>2</td><td><a href="/showteam?teamid=9">Biggleswade 1</a></td><td></td><td>1</td><td>0</td><td>1</td><td>0</td><td>8</td><td>17</td><td>0</td><td>8</td></tr>`;

test('a League Master fixture keeps the result and leaves the rubbers column out of it', () => {
  const fixtures = parseLmFixtures(fixtureHtml);
  assert.deepEqual(fixtures, [
    {
      id: '1227',
      when: '12/10/26 19:00',
      home: 'Biggleswade 1',
      away: 'Club Towers 2',
      result: [8, 17],
      status: 'played',
    },
    {
      id: '1230',
      when: '19/10/26 19:15',
      home: 'Open University 1',
      away: 'David Lloyd 1',
      result: null,
      status: 'scheduled',
    },
  ]);
  const table = parseLmTable(tableHtml);
  assert.equal(table[0].name, 'Club Towers 2');
  assert.equal(table[0].total, 17);
  assert.equal(table[1].f, 8);
});

test('Division fixtures and the table match, and a wrong result is reported', () => {
  const lm = parseLmFixtures(fixtureHtml);
  const beds = lm.map((fixture) => ({ ...fixture }));
  assert.deepEqual(compareDivision(lm, beds), []);

  beds[0] = { ...beds[0], result: [9, 16] };
  const differences = compareDivision(lm, beds);
  assert.ok(differences.some((line) => line.includes('fixture 1227 result 9-16')));
  assert.ok(differences.some((line) => line.includes('Club Towers 2 total')));
});
