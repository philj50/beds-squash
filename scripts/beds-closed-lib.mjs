import { randomInt } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';

/**
 * Turn a Sport Manager entry-list sheet into one action per person.
 * Tag a login that already exists. Open one when it does not. Leave a row
 * for a person to check when the email and the name disagree.
 */

export function nameKey(name) {
  return String(name || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z]+/g, '');
}

export function rowsFromSheet(sharedXml, sheetXml) {
  const strings = sharedXml
    ? [...sharedXml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((item) =>
        decodeXml([...item[1].matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map((part) => part[1]).join('')),
      )
    : [];
  const rows = [];
  for (const row of sheetXml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells = [];
    for (const cell of row[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const ref = cell[1].match(/\br="([A-Z]+)/)?.[1] || '';
      const index = ref.split('').reduce((total, char) => total * 26 + char.charCodeAt(0) - 64, 0) - 1;
      if (index < 0) continue;
      const inline = cell[2].match(/<t[^>]*>([^<]*)<\/t>/)?.[1];
      const raw = cell[2].match(/<v>([^<]*)<\/v>/)?.[1] || '';
      if (inline != null) cells[index] = decodeXml(inline);
      else if (cell[1].includes('t="s"')) cells[index] = strings[Number(raw)] || '';
      else cells[index] = decodeXml(raw);
    }
    rows.push(cells);
  }
  return rows;
}

export function zipText(buffer, wanted) {
  const data = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  let eocd = -1;
  const earliest = Math.max(0, data.length - 22 - 65535);
  for (let index = data.length - 22; index >= earliest; index -= 1) {
    if (data.readUInt32LE(index) === 0x06054b50) {
      eocd = index;
      break;
    }
  }
  if (eocd < 0) throw new Error('The entry list is not a spreadsheet.');
  const count = data.readUInt16LE(eocd + 10);
  let cursor = data.readUInt32LE(eocd + 16);
  for (let entry = 0; entry < count; entry += 1) {
    if (cursor + 46 > data.length || data.readUInt32LE(cursor) !== 0x02014b50) break;
    const method = data.readUInt16LE(cursor + 10);
    const compressed = data.readUInt32LE(cursor + 20);
    const nameLength = data.readUInt16LE(cursor + 28);
    const extraLength = data.readUInt16LE(cursor + 30);
    const commentLength = data.readUInt16LE(cursor + 32);
    const local = data.readUInt32LE(cursor + 42);
    const name = data.slice(cursor + 46, cursor + 46 + nameLength).toString('utf8');
    cursor += 46 + nameLength + extraLength + commentLength;
    if (name !== wanted) continue;
    const localName = data.readUInt16LE(local + 26);
    const localExtra = data.readUInt16LE(local + 28);
    const start = local + 30 + localName + localExtra;
    const raw = data.slice(start, start + compressed);
    if (method === 0) return raw.toString('utf8');
    if (method === 8) return inflateRawSync(raw).toString('utf8');
    throw new Error('The entry list spreadsheet could not be read.');
  }
  return '';
}

export function readEntryList(xlsx) {
  const shared = zipText(xlsx, 'xl/sharedStrings.xml');
  const sheet = zipText(xlsx, 'xl/worksheets/sheet1.xml');
  if (!sheet) throw new Error('The entry list spreadsheet has no sheet.');
  return entriesFromTable(rowsFromSheet(shared, sheet));
}

/** Names, grades and payment from the organiser Players page. */
export function organiserPlayers(html) {
  const players = [];
  for (const part of String(html || '').split(/<div\b[^>]*class="card-header"[^>]*>/i).slice(1)) {
    const grade = decodeXml(part.match(/<div\b[^>]*>\s*([^<]+?)\s*<\/div>/i)?.[1] || '');
    if (!grade) continue;
    for (const block of part.split(/class="tournament-player-container"/i).slice(1)) {
      const link = block.match(/href="\/t\/\d+\/entrant\/(\d+)[^"]*"[^>]*>([^<]+)</i);
      if (!link) continue;
      players.push({
        id: link[1],
        name: decodeXml(link[2]),
        grade,
        payment: decodeXml(block.match(/stripe-info-status">([^<]*)</i)?.[1] || ''),
      });
    }
  }
  return players;
}

/** Email, phone and name from a Sport Manager player page. */
export function contactFromPlayerPage(html) {
  return {
    forename: inputValue(html, 'Forename'),
    surname: inputValue(html, 'Surname'),
    email: inputValue(html, 'Email'),
    telephone: inputValue(html, 'Telephone'),
  };
}

/** The phone number entered for this tournament, from the entrant page. */
export function phoneFromEntrantPage(html) {
  const match = String(html || '').match(/new ejs\.inputs\.TextBox\(\{\s*"value":\s*"([^"]*)"\s*\}\)\.appendTo\("#EntrantInfo_Phone"\)/);
  return decodeXml(match?.[1] || '');
}

export function entriesFromTable(table) {
  const headerIndex = table.findIndex((row) => row.some((cell) => /^email$/i.test(String(cell || '').trim())));
  if (headerIndex < 0) return [];
  const header = table[headerIndex].map((cell) => String(cell || '').trim().toLowerCase());
  const column = (name) => header.indexOf(name);
  const grade = column('grade');
  const forename = column('forename');
  const surname = column('surname');
  const email = column('email');
  const telephone = column('telephone');
  const payment = column('paymentstatus');
  return table.slice(headerIndex + 1).map((row) => ({
    grade: cell(row, grade),
    forename: cell(row, forename),
    surname: cell(row, surname),
    email: cell(row, email),
    telephone: cell(row, telephone),
    payment: cell(row, payment),
  }));
}

/**
 * @returns {{ kind: 'tag' | 'create' | 'review' | 'skip', name: string, email: string, phone: string, profileId?: string, already?: boolean, reason?: string, paid: boolean }[]}
 */
export function planClosedEntries(rows, profiles, members = []) {
  const byEmail = new Map();
  const noEmail = new Map();
  for (const row of rows) {
    const name = cleanName(row.forename, row.surname);
    if (!name) continue;
    const email = cleanEmail(row.email);
    const phone = cleanPhone(row.telephone);
    const paid = String(row.payment || '').trim().toLowerCase() === 'succeeded';
    if (!email) {
      const key = nameKey(name);
      const bucket = noEmail.get(key) || { name, phone: '', paid: false };
      if (!bucket.phone && phone) bucket.phone = phone;
      bucket.paid = bucket.paid || paid;
      noEmail.set(key, bucket);
      continue;
    }
    const bucket = byEmail.get(email) || { email, names: new Map(), phone: '', paid: false };
    bucket.names.set(nameKey(name), name);
    if (!bucket.phone && phone) bucket.phone = phone;
    bucket.paid = bucket.paid || paid;
    byEmail.set(email, bucket);
  }

  const profilesByEmail = new Map();
  const profilesByName = new Map();
  for (const profile of profiles) {
    const email = cleanEmail(profile.email);
    if (email) {
      const list = profilesByEmail.get(email) || [];
      list.push(profile);
      profilesByEmail.set(email, list);
    }
    const key = nameKey(profile.display_name || '');
    if (!key) continue;
    const list = profilesByName.get(key) || [];
    list.push(profile);
    profilesByName.set(key, list);
  }
  const memberIds = new Set(members.map((member) => member.profile_id).filter(Boolean));
  const planned = [];

  for (const bucket of byEmail.values()) {
    const names = [...bucket.names.values()];
    const base = { email: bucket.email, phone: bucket.phone, paid: bucket.paid };
    if (names.length > 1) {
      planned.push({ kind: 'review', name: names.join(' / '), ...base, reason: 'one email is used by more than one name' });
      continue;
    }
    const name = names[0];
    const emailProfiles = profilesByEmail.get(bucket.email) || [];
    if (emailProfiles.length > 1) {
      planned.push({ kind: 'review', name, ...base, reason: 'more than one login uses this email' });
      continue;
    }
    if (emailProfiles.length === 1) {
      planned.push(tag(name, emailProfiles[0], memberIds, base));
      continue;
    }
    const named = (profilesByName.get(nameKey(name)) || []).filter((profile) => cleanEmail(profile.email) !== bucket.email);
    if (named.length > 1) {
      planned.push({ kind: 'review', name, ...base, reason: 'more than one login has this name' });
      continue;
    }
    if (named.length === 1 && cleanEmail(named[0].email)) {
      planned.push({ kind: 'review', name, ...base, reason: 'this name already has a different login' });
      continue;
    }
    if (named.length === 1) {
      planned.push(tag(name, named[0], memberIds, base));
      continue;
    }
    planned.push({ kind: 'create', name, ...base });
  }

  const actions = [];
  const byName = new Map();
  for (const action of planned) {
    const key = nameKey(action.name);
    const list = byName.get(key) || [];
    list.push(action);
    byName.set(key, list);
  }
  for (const list of byName.values()) {
    const emails = new Set(list.map((action) => action.email).filter(Boolean));
    if (emails.size > 1) {
      for (const action of list) {
        actions.push({ kind: 'review', name: action.name, email: action.email, phone: action.phone, paid: action.paid, reason: 'this name has more than one email address' });
      }
      continue;
    }
    actions.push(...list);
  }

  for (const bucket of noEmail.values()) {
    actions.push({ kind: 'skip', name: bucket.name, email: '', phone: bucket.phone, paid: bucket.paid, reason: 'no email address' });
  }
  return actions.map((action) => {
    if (action.paid || action.kind === 'review' || action.kind === 'skip') return action;
    return {
      kind: 'skip',
      name: action.name,
      email: action.email,
      phone: action.phone,
      paid: false,
      reason: 'payment has not succeeded',
    };
  });
}

/**
 * The County Closed email for this year is the address the account should keep.
 * A name with two addresses, or an address that already belongs to someone else, is left alone.
 */
export function closedAccountEmails(rows, profiles) {
  const byName = new Map();
  for (const row of rows) {
    const name = cleanName(row.forename, row.surname);
    const email = cleanEmail(row.email);
    if (!name || !email) continue;
    const key = nameKey(name);
    const bucket = byName.get(key) || { name, emails: new Set() };
    bucket.emails.add(email);
    byName.set(key, bucket);
  }
  const profilesByName = new Map();
  for (const profile of profiles) {
    if (profile.is_admin) continue;
    const key = nameKey(profile.display_name || '');
    if (!key) continue;
    const list = profilesByName.get(key) || [];
    list.push(profile);
    profilesByName.set(key, list);
  }
  const updates = [];
  for (const bucket of byName.values()) {
    if (bucket.emails.size !== 1) continue;
    const email = [...bucket.emails][0];
    if (profiles.some((profile) => profile.is_admin && cleanEmail(profile.email) === email)) continue;
    const named = profilesByName.get(nameKey(bucket.name)) || [];
    if (named.length > 1) continue;
    const taken = profiles.some((profile) => !profile.is_admin && cleanEmail(profile.email) === email && !named.includes(profile));
    if (taken) continue;
    const profile = named[0];
    updates.push({
      name: bucket.name,
      email,
      profileId: profile?.id || '',
      changed: !profile || cleanEmail(profile.email) !== email,
    });
  }
  return updates;
}

export function summary(actions) {
  const count = (kind) => actions.filter((action) => action.kind === kind).length;
  return {
    people: actions.length,
    tag: count('tag'),
    create: count('create'),
    review: count('review'),
    skip: count('skip'),
    paid: actions.filter((action) => action.paid).length,
  };
}

export function welcomeText({ name, email, password, place }) {
  return [
    `Hello ${name},`,
    '',
    `A Bedfordshire Squash login is ready for the ${place}.`,
    '',
    'Sign in at https://bedfordshiresquash.co.uk/login/',
    `Email: ${email}`,
    `Password: ${password}`,
    '',
    'Change the password when you sign in.',
    '',
    `This copy was sent to the test inbox. It would have gone to ${email}.`,
  ].join('\n');
}

export function startingPassword() {
  let password = '';
  for (let index = 0; index < 8; index += 1) password += randomInt(0, 10);
  return password;
}

function tag(name, profile, memberIds, base) {
  return {
    kind: 'tag',
    name: profile.display_name || name,
    entryName: name,
    ...base,
    profileId: profile.id,
    already: memberIds.has(profile.id),
  };
}

function cleanName(forename, surname) {
  return [forename, surname]
    .map((part) => String(part || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join(' ');
}

function cleanEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return '';
  return email;
}

function cleanPhone(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function cell(row, index) {
  return index < 0 ? '' : String(row[index] || '');
}

function inputValue(html, name) {
  const tag = String(html || '').match(new RegExp(`<input\\b[^>]*\\bname="${name}"[^>]*>`, 'i'))?.[0] || '';
  return decodeXml(tag.match(/\bvalue="([^"]*)"/)?.[1] || '');
}

function decodeXml(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, digits) => String.fromCharCode(Number(digits)));
}
