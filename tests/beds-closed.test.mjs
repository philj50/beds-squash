import assert from 'node:assert/strict';
import test from 'node:test';
import { deflateRawSync } from 'node:zlib';
import { closedAccountEmails, contactFromPlayerPage, entriesFromTable, organiserPlayers, phoneFromEntrantPage, planClosedEntries, readEntryList, rowsFromSheet, summary, welcomeText } from '../scripts/beds-closed-lib.mjs';
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

test('this year\'s County Closed email is the address kept on the account', () => {
  const rows = [
    { forename: 'Pat', surname: 'Different', email: 'smgr@example.test' },
    { forename: 'Steven', surname: 'Davies', email: 'steven@example.test' },
    { forename: 'New', surname: 'Player', email: 'new@example.test' },
    { forename: 'Two', surname: 'Mails', email: 'a@example.test' },
    { forename: 'Two', surname: 'Mails', email: 'b@example.test' },
    { forename: 'Taken', surname: 'Address', email: 'steven@example.test' },
  ];
  const updates = closedAccountEmails(rows, [
    { id: '1', email: 'steven@example.test', display_name: 'Steven Davies' },
    { id: '2', email: 'other@example.test', display_name: 'Pat Different' },
    { id: '9', email: 'admin@example.test', display_name: 'County Admin', is_admin: true },
  ]);
  const byName = Object.fromEntries(updates.map((update) => [update.name, update]));
  assert.equal(byName['Pat Different'].changed, true);
  assert.equal(byName['Pat Different'].profileId, '2');
  assert.equal(byName['Pat Different'].email, 'smgr@example.test');
  assert.equal(byName['Steven Davies'].changed, false);
  assert.equal(byName['New Player'].profileId, '');
  assert.equal(byName['New Player'].changed, true);
  assert.equal(byName['Two Mails'], undefined);
  assert.equal(byName['Taken Address'], undefined);
});

test('email and phone are read from the Sport Manager player pages', () => {
  const players = organiserPlayers(`
    <div class="card-header"><div>A Grade</div></div>
    <div class="tournament-player-container">
      <a href="/t/1244761/entrant/41?returnUrl=%2FTournament%2FPlayers%2F1244761">Ada Lovelace</a>
      <div class="stripe-info-status">Succeeded</div>
    </div>
    <div class="tournament-player-container">
      <a href="/t/1244761/entrant/42?returnUrl=%2FTournament%2FPlayers%2F1244761">James O&#x27;Connor</a>
      <div class="stripe-info-status">Succeeded</div>
    </div>
    <div class="card-header"><div>B Grade</div></div>
  `);
  assert.equal(players.length, 2);
  assert.equal(players[0].id, '41');
  assert.equal(players[0].grade, 'A Grade');
  assert.equal(players[0].payment, 'Succeeded');
  assert.equal(players[1].name, "James O'Connor");
  const contact = contactFromPlayerPage('<input name="Forename" value="Ada" /><input name="Surname" value="Lovelace" /><input name="Email" value="ada@example.test" /><input name="Telephone" value="07000000000" />');
  assert.equal(contact.email, 'ada@example.test');
  assert.equal(contact.telephone, '07000000000');
  assert.equal(phoneFromEntrantPage('new ejs.inputs.TextBox({\n  "value": "07000000001"\n}).appendTo("#EntrantInfo_Phone");'), '07000000001');
});

test('a zipped spreadsheet is read without unpacking it on disk', () => {
  const shared = '<sst><si><t>Email</t></si><si><t>Forename</t></si><si><t>Surname</t></si><si><t>Ada</t></si><si><t>Lovelace</t></si><si><t>ada@example.test</t></si></sst>';
  const sheet = '<sheetData><row><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row><row><c r="A2" t="s"><v>5</v></c><c r="B2" t="s"><v>3</v></c><c r="C2" t="s"><v>4</v></c></row></sheetData>';
  const entries = readEntryList(zipSpreadsheet({ 'xl/sharedStrings.xml': shared, 'xl/worksheets/sheet1.xml': deflateRawSync(Buffer.from(sheet)) }, { 'xl/worksheets/sheet1.xml': 8 }));
  assert.equal(entries.length, 1);
  assert.equal(entries[0].forename, 'Ada');
  assert.equal(entries[0].surname, 'Lovelace');
  assert.equal(entries[0].email, 'ada@example.test');
});

test('the welcome message names the player and keeps the password in the body', () => {
  const text = welcomeText({ name: 'New Player', email: 'new@example.test', password: '12345678', place: 'County Closed 2026' });
  assert.match(text, /County Closed 2026/);
  assert.match(text, /new@example.test/);
  assert.match(text, /12345678/);
  assert.match(text, /test inbox/);
});

function zipSpreadsheet(files, methods = {}) {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const [name, body] of Object.entries(files)) {
    const method = methods[name] ?? 0;
    const raw = Buffer.isBuffer(body) ? body : Buffer.from(body);
    const stored = method === 0 ? raw : body;
    const nameBuf = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(stored.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50, 0);
    directory.writeUInt16LE(method, 10);
    directory.writeUInt32LE(stored.length, 20);
    directory.writeUInt32LE(method === 0 ? stored.length : raw.length, 24);
    directory.writeUInt16LE(nameBuf.length, 28);
    directory.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, stored);
    central.push(directory, nameBuf);
    offset += local.length + nameBuf.length + stored.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

function row(...cells) {
  const body = [];
  for (let index = 0; index < cells.length; index += 3) {
    const [ref, type, value] = [cells[index], cells[index + 1], cells[index + 2]];
    if (type === 'inline') body.push(`<c r="${ref}" t="inlineStr"><is><t>${value}</t></is></c>`);
    else body.push(`<c r="${ref}" t="${type}"><v>${value}</v></c>`);
  }
  return `<row>${body.join('')}</row>`;
}
