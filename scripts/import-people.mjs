/**
 * Fill clubs and team captains from the public League Master pages, and store
 * each England Squash number from the county spreadsheet against the player's
 * name and email.
 *
 *   node scripts/import-people.mjs --dry-run
 *   node scripts/import-people.mjs
 *
 * Reads LEAGUEMASTER_* only if present; the club, captain and player pages used
 * here are public. Needs SUPABASE_SERVICE_ROLE_KEY. Prints counts, never addresses.
 */
import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';

const SPREADSHEET = 'C:/Users/phili/OneDrive/Beds Squash/Beds_SRA-ex ES.xlsm';
const BASE = 'https://bedfordshiresquash.leaguemaster.co.uk';
const dryRun = process.argv.includes('--dry-run');

function loadEnv() {
  const env = {};
  for (const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9_]+)=(.*)$/);
    if (match) env[match[1]] = match[2].trim();
  }
  return env;
}

function decode(html) {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&rsquo;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, ' ')
    .trim();
}

function norm(name) {
  return name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z\s'-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const CANON = {
  dan: 'daniel',
  daniel: 'daniel',
  steve: 'stephen',
  stephen: 'stephen',
  steven: 'stephen',
  mike: 'michael',
  michael: 'michael',
  tom: 'thomas',
  thomas: 'thomas',
  phil: 'philip',
  philip: 'philip',
  phillip: 'philip',
  nick: 'nicholas',
  nicholas: 'nicholas',
  ben: 'benjamin',
  benjamin: 'benjamin',
  sam: 'samuel',
  samuel: 'samuel',
  matt: 'matthew',
  matthew: 'matthew',
  dave: 'david',
  david: 'david',
  andy: 'andrew',
  andrew: 'andrew',
  chris: 'christopher',
  christopher: 'christopher',
  alex: 'alexander',
  alexander: 'alexander',
  ollie: 'oliver',
  oliver: 'oliver',
  will: 'william',
  william: 'william',
  bill: 'william',
  joe: 'joseph',
  joseph: 'joseph',
  rob: 'robert',
  robert: 'robert',
  bob: 'robert',
  jim: 'james',
  james: 'james',
  tony: 'anthony',
  anthony: 'anthony',
};

function keysFor(name) {
  const parts = norm(name).split(' ').filter(Boolean);
  if (parts.length < 2) return parts.length ? [parts[0]] : [];
  const first = parts[0];
  const last = parts[parts.length - 1];
  const middle = parts.slice(1, -1).join(' ');
  const full = parts.join(' ');
  const canonFirst = CANON[first] || first;
  const keys = new Set([full, `${canonFirst} ${middle} ${last}`.replace(/\s+/g, ' ').trim(), `${first[0]} ${last}`]);
  return [...keys];
}

function readZip(file) {
  const data = readFileSync(file);
  const entries = new Map();
  let offset = 0;
  while (offset + 30 < data.length && data.readUInt32LE(offset) === 0x04034b50) {
    const method = data.readUInt16LE(offset + 8);
    const compressed = data.readUInt32LE(offset + 18);
    const nameLen = data.readUInt16LE(offset + 26);
    const extraLen = data.readUInt16LE(offset + 28);
    const name = data.subarray(offset + 30, offset + 30 + nameLen).toString('utf8');
    const start = offset + 30 + nameLen + extraLen;
    const body = data.subarray(start, start + compressed);
    entries.set(name, method === 0 ? body : inflateRawSync(body));
    offset = start + compressed;
  }
  return entries;
}

function spreadsheetRows(file) {
  const zip = readZip(file);
  const stringsXml = zip.get('xl/sharedStrings.xml').toString('utf8');
  const strings = [...stringsXml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
    decode([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('')),
  );
  function rows(sheetName) {
    const xml = zip.get(sheetName).toString('utf8');
    const out = [];
    for (const row of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells = {};
      for (const cell of row[1].matchAll(/<c r="([A-Z]+)\d+"([^>]*)>([\s\S]*?)<\/c>/g)) {
        const value = (cell[3].match(/<v>([\s\S]*?)<\/v>/) || [])[1] ?? '';
        cells[cell[1]] = cell[2].includes('t="s"') ? strings[Number(value)] ?? '' : value;
      }
      out.push(cells);
    }
    return out;
  }
  const main = rows('xl/worksheets/sheet1.xml').slice(1);
  const extra = rows('xl/worksheets/sheet3.xml').slice(1);
  const people = [];
  const seenEmail = new Set();
  for (const row of [...main, ...extra]) {
    const first = String(row.B || '').trim();
    const last = String(row.C || '').trim();
    const displayName = `${first} ${last}`.replace(/\s+/g, ' ').trim();
    const email = String(row.D || '').trim().toLowerCase();
    const englandSquashId = String(row.E || '').trim();
    if (!displayName) continue;
    if (email && seenEmail.has(email)) continue;
    if (email) seenEmail.add(email);
    people.push({ displayName, email: email || null, englandSquashId: englandSquashId || null, club: String(row.H || '').trim() || null });
  }
  return people;
}

let cookie = '';
function storeCookies(res) {
  const set = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  for (const item of set) {
    const pair = item.split(';')[0];
    const name = pair.split('=')[0];
    cookie = cookie.split('; ').filter((part) => part && !part.startsWith(name + '=')).concat(pair).join('; ');
  }
}
async function request(urlPath) {
  const res = await fetch(BASE + urlPath, {
    redirect: 'manual',
    headers: { cookie, 'user-agent': 'BedsSquashSync/1.0 (county website; public league data)' },
  });
  storeCookies(res);
  if (res.status >= 300 && res.status < 400) {
    const loc = res.headers.get('location') || '';
    return request(loc.startsWith('http') ? loc.replace(BASE, '') : loc);
  }
  if (!res.ok) throw new Error(`GET ${urlPath} -> ${res.status}`);
  return res.text();
}
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function labelled(html) {
  const pairs = [];
  for (const match of html.matchAll(/<th[^>]*>([\s\S]*?)<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>/gi)) {
    pairs.push([decode(match[1]).replace(/:$/, ''), decode(match[2])]);
  }
  return pairs;
}

function fieldsUntil(pairs, start, stop) {
  const from = pairs.findIndex(([label]) => label.toLowerCase() === start.toLowerCase());
  if (from < 0) return {};
  const slice = [];
  for (const pair of pairs.slice(from)) {
    if (slice.length && stop.test(pair[0])) break;
    slice.push(pair);
  }
  const out = {};
  for (const [label, value] of slice) {
    if (value && value !== '-') out[label.toLowerCase()] = value;
  }
  return out;
}

const env = loadEnv();
const supabaseUrl = (env.SUPABASE_URL || '').replace(/\/$/, '');
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !key) throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
const headers = { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json', prefer: 'return=minimal' };

async function rest(path, options = {}) {
  const res = await fetch(`${supabaseUrl}/rest/v1/${path}`, { ...options, headers: { ...headers, ...options.headers } });
  const text = await res.text();
  if (!res.ok) throw new Error(`${options.method || 'GET'} ${path} -> ${res.status} ${text.slice(0, 240)}`);
  return text ? JSON.parse(text) : null;
}

const registry = spreadsheetRows(SPREADSHEET);
const byKey = new Map();
for (const person of registry) {
  for (const keyName of keysFor(person.displayName)) {
    const list = byKey.get(keyName) || [];
    list.push(person);
    byKey.set(keyName, list);
  }
}

function matchPerson(displayName) {
  const found = new Map();
  for (const keyName of keysFor(displayName)) {
    for (const person of byKey.get(keyName) || []) found.set(person.email || person.displayName, person);
  }
  const hits = [...found.values()];
  if (hits.length === 1) return hits[0];
  const exact = hits.filter((person) => norm(person.displayName) === norm(displayName));
  if (exact.length === 1) return exact[0];
  return null;
}

const clubs = await rest('clubs?select=slug,name,leaguemaster_club_id,contact_name,contact_email');
const teams = await rest('teams?select=id,name,leaguemaster_team_id,captain_name,captain_email,club_slug');
const squads = await rest('captain_squads?select=id,team_id,captain_email');
const players = await rest('squad_players?select=id,squad_id,display_name,email');

const lmClubs = [...(await request('/cgi-county/icounty.exe/showclublist')).matchAll(/showclub\?clubid=(\d+)/gi)].map((m) => m[1]);
const clubIds = [...new Set(lmClubs)];
const clubUpdates = [];
for (const id of clubIds) {
  const html = await request(`/cgi-county/icounty.exe/showclub?clubid=${id}`);
  const fields = fieldsUntil(labelled(html), 'Manager', /fixture|nomination/i);
  const local = clubs.find((club) => club.leaguemaster_club_id === id);
  if (!local) continue;
  const contactName = fields.manager || null;
  const contactEmail = (fields.email || '').includes('@') ? fields.email.toLowerCase() : null;
  if ((contactName && contactName !== local.contact_name) || (contactEmail && contactEmail !== (local.contact_email || '').toLowerCase())) {
    clubUpdates.push({ slug: local.slug, contact_name: contactName || local.contact_name, contact_email: contactEmail || local.contact_email });
  }
  await pause(40);
}

const lmTeams = [...(await request('/cgi-county/icounty.exe/showteamlist')).matchAll(/showteam\?teamid=(\d+)/gi)].map((m) => m[1]);
const teamIds = [...new Set(lmTeams)];
const teamUpdates = [];
for (const id of teamIds) {
  const html = await request(`/cgi-county/icounty.exe/showteam?teamid=${id}`);
  const fields = fieldsUntil(labelled(html), 'Team Contact', /reserve|club details|fixture|nomination/i);
  const local = teams.find((team) => team.leaguemaster_team_id === id);
  if (!local) continue;
  const captainName = fields['team contact'] || null;
  const captainEmail = (fields.email || '').includes('@') ? fields.email.toLowerCase() : null;
  if ((captainName && captainName !== local.captain_name) || (captainEmail && captainEmail !== (local.captain_email || '').toLowerCase())) {
    teamUpdates.push({ id: local.id, captain_name: captainName || local.captain_name, captain_email: captainEmail || local.captain_email });
  }
  await pause(40);
}

let matched = 0;
let withNumber = 0;
const playerUpdates = [];
for (const player of players) {
  const person = matchPerson(player.display_name);
  if (!person) continue;
  matched += 1;
  if (person.englandSquashId) withNumber += 1;
  const email = person.email;
  const sameEmail = (player.email || '').toLowerCase() === (email || '');
  if (!sameEmail || person.englandSquashId) {
    playerUpdates.push({ id: player.id, email: email || player.email, england_squash_id: person.englandSquashId });
  }
}

console.log(`Spreadsheet: ${registry.length} people, ${registry.filter((p) => p.englandSquashId).length} with an England Squash number.`);
console.log(`League Master clubs to update: ${clubUpdates.length} of ${clubs.length}.`);
console.log(`League Master captains to update: ${teamUpdates.length} of ${teams.length}.`);
console.log(`Squad players matched to the spreadsheet: ${matched} of ${players.length} (${withNumber} with a number).`);
console.log(dryRun ? 'Dry run only.' : 'Writing.');

if (dryRun) process.exit(0);

for (const club of clubUpdates) {
  await rest(`clubs?slug=eq.${encodeURIComponent(club.slug)}`, {
    method: 'PATCH',
    body: JSON.stringify({ contact_name: club.contact_name, contact_email: club.contact_email }),
  });
}
for (const team of teamUpdates) {
  await rest(`teams?id=eq.${team.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ captain_name: team.captain_name, captain_email: team.captain_email }),
  });
  const squad = squads.find((row) => row.team_id === team.id);
  if (squad && team.captain_email) {
    await rest(`captain_squads?id=eq.${squad.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ captain_email: team.captain_email }),
    });
  }
}
let squadColumn = true;
for (const player of playerUpdates) {
  const body = { email: player.email };
  if (squadColumn && player.england_squash_id) body.england_squash_id = player.england_squash_id;
  try {
    await rest(`squad_players?id=eq.${player.id}`, { method: 'PATCH', body: JSON.stringify(body) });
  } catch (error) {
    if (!squadColumn || !String(error.message).includes('england_squash_id')) throw error;
    squadColumn = false;
    await rest(`squad_players?id=eq.${player.id}`, { method: 'PATCH', body: JSON.stringify({ email: player.email }) });
  }
}

let registrySaved = false;
try {
  await rest('player_registry?id=not.is.null', { method: 'DELETE' });
  for (let i = 0; i < registry.length; i += 50) {
    await rest('player_registry', {
      method: 'POST',
      body: JSON.stringify(registry.slice(i, i + 50).map((person) => ({
        display_name: person.displayName,
        email: person.email,
        england_squash_id: person.englandSquashId,
        club: person.club,
      }))),
    });
  }
  registrySaved = true;
} catch (error) {
  if (!String(error.message).includes('player_registry')) throw error;
  console.log('Player registry table is not on the database yet.');
}
console.log(squadColumn
  ? 'Saved club contacts, captains, squad emails and England Squash numbers.'
  : 'Saved club contacts, captains and squad emails. The England Squash column is not on squad players yet.');
console.log(registrySaved ? 'Saved the player registry.' : 'Player registry was not written.');
