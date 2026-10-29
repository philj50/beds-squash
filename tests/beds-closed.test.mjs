import assert from 'node:assert/strict';
import test from 'node:test';
import { entriesFromTable, planClosedEntries, rowsFromSheet, summary, welcomeText } from '../scripts/beds-closed-lib.mjs';
import { OUTBOUND_TO, buildMessage } from '../scripts/outbound-mail.mjs';

test('every outbound message is addressed to the test inbox', () => {
  assert.equal(OUTBOUND_TO, 'dulltown@gmail.com');
  const message = buildMessage({ from: 'dulltown@gmail.com', subject: 'Hello Ada', text: 'A password is in here.' });
  assert.match(message, /^To: dulltown@gmail.com$/m);
  assert.doesNotMatch(message, /To: (?!dulltown@gmail.com\b)\S+@/);
  assert.equal(buildMessage.length, 1);
});

test('a spreadsheet row becomes a tag, a new login, a skip, or a look', () => {
  const table = rowsFromSheet(
    '<sst><si><t>Grade</t></si><si><t>Forename</t></si><si><t>Surname</t></si><si><t>Email</t></si><si><t>Telephone</t></si><si><t>PaymentStatus</t></si><si><t>Steven</t></si><si><t>Davies</t></si><si><t>steven@example.test</t></si><si><t>07000000000</t></si><si><t>New</t></si><si><t>Player</t></si><si><t>new@example.test</t></si><si><t>No</t></si><si><t>Mail</t></si><si><t>Two</t></si><si><t>Mails</t></si><si><t>a@example.test</t></si><si><t>b@example.test</t></si><si><t>Pat</t></si><si><t>Different</t></si><si><t>smgr@example.test</t></si><si><t>Succeeded</t></si><si><t>Late</t></si><si><t>Payer</t></si><si><t>late@example.test</t></si><si><t>Mens A</t></si></sst>',
    [
      row('A1', 's', 0, 'B1', 's', 1, 'C1', 's', 2, 'D1', 's', 3, 'E1', 's', 4, 'F1', 's', 5),
      row('A2', 's', 26, 'B2', 's', 6, 'C2', 's', 7, 'D2', 's', 8, 'E2', 's', 9, 'F2', 's', 22),
      row('A3', 's', 0, 'B3', 's', 6, 'C3', 's', 7, 'D3', 's', 8, 'F3', 'inline', ''),
      row('A4', 's', 0, 'B4', 's', 10, 'C4', 's', 11, 'D4', 's', 12, 'F4', 's', 22),
      row('A5', 's', 0, 'B5', 's', 13, 'C5', 's', 14),
      row('A6', 's', 0, 'B6', 's', 15, 'C6', 's', 16, 'D6', 's', 17, 'F6', 's', 22),
      row('A7', 's', 0, 'B7', 's', 15, 'C7', 's', 16, 'D7', 's', 18, 'F7', 's', 22),
      row('A8', 's', 0, 'B8', 's', 19, 'C8', 's', 20, 'D8', 's', 21, 'F8', 's', 22),
      row('A9', 's', 0, 'B9', 's', 23, 'C9', 's', 24, 'D9', 's', 25),
    ].join(''),
  );
  const entries = entriesFromTable(table);
  assert.equal(entries[0].grade, 'Mens A');
  const actions = planClosedEntries(entries, [
    { id: '1', email: 'Steven@example.test', display_name: 'Steven Davies' },
    { id: '2', email: 'other@example.test', display_name: 'Pat Different' },
  ], [{ profile_id: '1', person_name: 'Steven Davies' }]);
  const byName = Object.fromEntries(actions.map((action) => [action.name, action]));
  assert.equal(byName['Steven Davies'].kind, 'tag');
  assert.equal(byName['Steven Davies'].already, true);
  assert.equal(byName['Steven Davies'].phone, '07000000000');
  assert.equal(byName['New Player'].kind, 'create');
  assert.equal(byName['No Mail'].kind, 'skip');
  assert.equal(byName['Late Payer'].kind, 'skip');
  assert.equal(byName['Late Payer'].reason, 'payment has not succeeded');
  assert.equal(byName['Two Mails'].kind, 'review');
  assert.equal(byName['Two Mails'].reason, 'this name has more than one email address');
  assert.equal(byName['Pat Different'].kind, 'review');
  assert.equal(byName['Pat Different'].reason, 'this name already has a different login');
  const counts = summary(actions);
  assert.equal(counts.tag, 1);
  assert.equal(counts.create, 1);
  assert.equal(counts.review, 3);
  assert.equal(counts.skip, 2);
});

test('the welcome message names the player and keeps the password in the body', () => {
  const text = welcomeText({ name: 'New Player', email: 'new@example.test', password: '12345678', place: 'County Closed 2026' });
  assert.match(text, /County Closed 2026/);
  assert.match(text, /new@example.test/);
  assert.match(text, /12345678/);
  assert.match(text, /test inbox/);
});

function row(...cells) {
  const body = [];
  for (let index = 0; index < cells.length; index += 3) {
    const [ref, type, value] = [cells[index], cells[index + 1], cells[index + 2]];
    if (type === 'inline') body.push(`<c r="${ref}" t="inlineStr"><is><t>${value}</t></is></c>`);
    else body.push(`<c r="${ref}" t="${type}"><v>${value}</v></c>`);
  }
  return `<row>${body.join('')}</row>`;
}
