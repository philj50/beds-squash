/**
 * Link County Closed entrants from Sport Manager to Bedfordshire Squash.
 *
 *   node --use-system-ca scripts/sync-beds-closed.mjs
 *   node --use-system-ca scripts/sync-beds-closed.mjs --apply
 *
 * Without --apply, this saves the entry list and prints counts.
 * It does not open logins or send mail.
 * A new login is created from the Sport Manager email. The starting password
 * is emailed by scripts/outbound-mail.mjs, which always sends to the test inbox.
 * An existing login is marked as a BC Player and its password is left alone.
 * This year's County Closed email is written onto that person's account.
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { closedAccountEmails, contactFromPlayerPage, nameKey, organiserPlayers, phoneFromEntrantPage, planClosedEntries, startingPassword, summary, welcomeText } from './beds-closed-lib.mjs';
import { OUTBOUND_TO, sendOutbound } from './outbound-mail.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SUPABASE_URL = 'https://klxyjmwiaivvqjbhxzak.supabase.co';
const apply = process.argv.includes('--apply');
const only = process.argv.find((arg, index) => process.argv[index - 1] === '--tournament');

loadEnv();

const events = readdirSync(join(ROOT, 'src', 'content', 'events'))
  .filter((name) => name.endsWith('.md') && !name.startsWith('_'))
  .sort()
  .map((name) => {
    const text = readFileSync(join(ROOT, 'src', 'content', 'events', name), 'utf8');
    const id = text.match(/^sportmgr:\s*(\d+)\s*$/m);
    if (!id) return null;
    const title = text.match(/^title:\s*(.+)\s*$/m)?.[1]?.trim() || name;
    const year = (title.match(/20\d{2}/) || name.match(/20\d{2}/) || [''])[0];
    return { title, sportmgr: id[1], year: Number(year || 0), place: year ? `County Closed ${year}` : 'County Closed' };
  })
  .filter(Boolean);
const currentYear = Math.max(0, ...events.map((event) => event.year));
const chosen = events.filter((event) => !only || event.sportmgr === only);

if (chosen.length === 0) {
  console.log('No events have a sportmgr id.');
  process.exit(0);
}

const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const username = process.env.SPORTS_MANAGER_USERNAME;
const password = process.env.SPORTS_MANAGER_PASSWORD;
if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set.');
if (!username || !password) throw new Error('The Sport Manager organiser login is not set.');

const base = process.env.SUPABASE_URL || SUPABASE_URL;
const lists = await downloadLists(chosen);
const profiles = await restAll('profiles?select=id,email,display_name,is_admin');
const members = await restAll('group_members?group_slug=eq.bc_players&select=id,profile_id,person_name,place');
const squads = await restAll('squad_players?select=id,display_name,email,phone');
const users = await listUsers();
const usersByEmail = new Map(users.map((user) => [String(user.email || '').trim().toLowerCase(), user]));

let emailsFixed = 0;
if (apply) {
  for (const event of chosen) {
    if (event.year !== currentYear) continue;
    for (const update of closedAccountEmails(lists.get(event.sportmgr) || [], profiles)) {
      if (update.profileId && update.changed) {
        await keepClosedEmail(update.profileId, update.email);
        const profile = profiles.find((item) => item.id === update.profileId);
        if (profile) profile.email = update.email;
        emailsFixed += 1;
      }
      await keepSquadEmail(update.name, update.email);
    }
  }
}

let mailFailed = false;
let created = 0;
let sent = 0;
let tagged = 0;
let phones = 0;

const plans = [];
for (const event of chosen) {
  const rows = lists.get(event.sportmgr) || [];
  const actions = planClosedEntries(rows, profiles, members);
  plans.push({ event, actions });
  const counts = summary(actions);
  console.log(`${event.title}: ${rows.length} entry rows, ${counts.people} people`);
  console.log(`Already have a login: ${counts.tag}. New logins: ${counts.create}. Need a look: ${counts.review}. Not paid yet: ${unpaid(actions)}. No email: ${noEmail(actions)}.`);
  for (const action of actions.filter((item) => item.kind === 'review' || (item.kind === 'skip' && item.reason !== 'no email address'))) {
    console.log(`Needs a look: ${action.name} (${action.reason}).`);
  }
  await storeEntries(event, rows);
}

if (!apply) {
  console.log('The entry list was saved. No logins were changed and no mail was sent.');
  process.exit(0);
}

const willCreate = plans.some((plan) => plan.actions.some((action) => action.kind === 'create'));
if (willCreate) {
  try {
    await sendOutbound({
      from: process.env.GMAIL_USERNAME,
      user: process.env.GMAIL_USERNAME,
      pass: process.env.GMAIL_PASSWORD,
      subject: 'County Closed mail check',
      text: 'The County Closed sync can send mail to the test inbox. No player password is in this message.',
    });
  } catch (error) {
    console.log(error instanceof Error ? error.message : 'The message could not be sent.');
    console.log(emailsFixed ? `Set ${emailsFixed} account emails from County Closed ${currentYear}. No new logins were opened.` : 'No logins were changed.');
    process.exit(1);
  }
}

for (const { event, actions } of plans) {
  for (const action of actions.filter((item) => item.kind === 'tag' && item.profileId)) {
    await ensureMember(action.profileId, action.name, event.place);
    tagged += 1;
  }

  for (const action of actions.filter((item) => item.kind === 'create')) {
    if (mailFailed) break;
    const account = await openAccount(action);
    await ensureMember(account.profileId, action.name, event.place);
    profiles.push({ id: account.profileId, email: action.email, display_name: action.name });
    created += 1;
    if (!account.welcomeDue) continue;
    try {
      await sendOutbound({
        from: process.env.GMAIL_USERNAME,
        user: process.env.GMAIL_USERNAME,
        pass: process.env.GMAIL_PASSWORD,
        subject: `County Closed login for ${action.name}`,
        text: welcomeText({ name: action.name, email: action.email, password: account.password, place: event.place }),
      });
      await markWelcomeSent(account.userId, account.metadata);
      sent += 1;
      await pause(1500);
    } catch {
      mailFailed = true;
      console.log(`The login for ${action.name} was created, and the message did not send. No further logins were created.`);
    }
  }

  for (const squad of squads) {
    if (String(squad.phone || '').trim()) continue;
    const phone = phoneFor(squad, actions);
    if (!phone) continue;
    await restWrite(`squad_players?id=eq.${squad.id}`, 'PATCH', { phone });
    squad.phone = phone;
    phones += 1;
  }
}

console.log(`Checked ${tagged} existing logins. Opened ${created} logins. Sent ${sent} messages to ${OUTBOUND_TO}. Saved ${phones} phone numbers. Set ${emailsFixed} account emails from County Closed ${currentYear}.`);
if (mailFailed) process.exit(1);

async function storeEntries(event, rows) {
  const year = Number(String(event.place).match(/20\d{2}/)?.[0] || 0);
  const seen = new Set();
  const people = [];
  for (const row of rows) {
    const forename = String(row.forename || '').replace(/\s+/g, ' ').trim();
    const surname = String(row.surname || '').replace(/\s+/g, ' ').trim();
    if (!forename && !surname) continue;
    const grade = String(row.grade || '').replace(/\s+/g, ' ').trim();
    const email = String(row.email || '').trim().toLowerCase();
    const key = [grade, forename, surname, email].join('|').toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    people.push({
      tournament_id: Number(event.sportmgr),
      year,
      grade,
      forename,
      surname,
      email,
      telephone: String(row.telephone || '').replace(/\s+/g, ' ').trim(),
      payment_status: String(row.payment || '').trim(),
    });
  }
  await restWrite(`beds_closed_entries?tournament_id=eq.${event.sportmgr}`, 'DELETE');
  for (let index = 0; index < people.length; index += 200) {
    await restWrite('beds_closed_entries', 'POST', people.slice(index, index + 200));
  }
  console.log(`${event.title}: saved ${people.length} entries.`);
}

async function downloadLists(eventList) {
  const browser = await chromium.launch({ headless: true });
  const lists = new Map();
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(30000);
    await page.goto('https://sportmgr.co.uk/Player', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#email');
    await page.fill('#email', username);
    await page.fill('#password', password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    try {
      await page.waitForURL((url) => !url.hostname.includes('b2clogin.com'), { timeout: 30000 });
    } catch {
      throw new Error('Sport Manager did not accept the organiser login.');
    }
    for (const event of eventList) {
      const response = await page.request.get(`https://sportmgr.co.uk/Tournament/Players/${event.sportmgr}`);
      if (!response.ok()) throw new Error(`Sport Manager did not return the player page for ${event.title}.`);
      const listed = organiserPlayers(await response.text());
      const rows = [];
      for (const player of listed) {
        const [edit, entrant] = await Promise.all([
          page.request.get(`https://sportmgr.co.uk/Player/Edit/${player.id}`),
          page.request.get(`https://sportmgr.co.uk/t/${event.sportmgr}/entrant/${player.id}`),
        ]);
        if (!edit.ok()) throw new Error(`Sport Manager did not return the player page for ${player.name}.`);
        const contact = contactFromPlayerPage(await edit.text());
        const entryPhone = entrant.ok() ? phoneFromEntrantPage(await entrant.text()) : '';
        const parts = player.name.split(/\s+/).filter(Boolean);
        const surname = contact.surname || parts.pop() || '';
        rows.push({
          grade: player.grade,
          forename: contact.forename || parts.join(' '),
          surname,
          email: contact.email,
          telephone: entryPhone || contact.telephone,
          payment: player.payment,
        });
      }
      lists.set(event.sportmgr, rows);
    }
  } finally {
    await browser.close();
  }
  return lists;
}

async function openAccount(action) {
  const existing = usersByEmail.get(action.email);
  if (existing) {
    const profileId = await ensureProfile(existing.id, action, false);
    const metadata = { ...(existing.user_metadata || {}) };
    const welcomeDue = metadata.bc_closed_account === true && metadata.bc_welcome_sent !== true && !existing.last_sign_in_at;
    let password = '';
    if (welcomeDue) {
      password = startingPassword();
      metadata.must_change_password = true;
      metadata.bc_welcome_sent = false;
      await authWrite(existing.id, { password, user_metadata: metadata });
    }
    return { profileId, welcomeDue, password, userId: existing.id, metadata };
  }
  const password = startingPassword();
  const metadata = {
    display_name: action.name,
    must_change_password: true,
    bc_closed_account: true,
    bc_welcome_sent: false,
  };
  const created = await authCreate({ email: action.email, password, email_confirm: true, user_metadata: metadata });
  const profileId = await ensureProfile(created.id, action, true);
  usersByEmail.set(action.email, { ...created, user_metadata: metadata });
  return { profileId, welcomeDue: true, password, userId: created.id, metadata };
}

async function keepClosedEmail(profileId, email) {
  const address = String(email || '').trim().toLowerCase();
  if (!address) return;
  const previous = [...usersByEmail.entries()].find(([, user]) => user.id === profileId);
  if (!previous || previous[0] !== address) {
    await authWrite(profileId, { email: address, email_confirm: true });
    if (previous) usersByEmail.delete(previous[0]);
    usersByEmail.set(address, { ...(previous?.[1] || { id: profileId }), email: address });
  }
  await restWrite(`profiles?id=eq.${profileId}`, 'PATCH', { email: address });
}

async function keepSquadEmail(name, email) {
  const key = nameKey(name);
  const address = String(email || '').trim().toLowerCase();
  if (!key || !address) return;
  for (const squad of squads) {
    if (nameKey(squad.display_name || '') !== key) continue;
    if (String(squad.email || '').trim().toLowerCase() === address) continue;
    await restWrite(`squad_players?id=eq.${squad.id}`, 'PATCH', { email: address });
    squad.email = address;
  }
}

async function ensureProfile(id, action, isNew) {
  const rows = await restAll(`profiles?id=eq.${id}&select=id,email`);
  if (!rows.length) {
    await restWrite('profiles', 'POST', { id, display_name: action.name, email: action.email });
    return id;
  }
  if (isNew || !String(rows[0].email || '').trim()) {
    await restWrite(`profiles?id=eq.${id}`, 'PATCH', { display_name: action.name, email: action.email });
  }
  return id;
}

async function ensureMember(profileId, name, place) {
  const existing = members.find((member) => member.profile_id === profileId);
  if (existing) {
    const placeText = mergePlace(existing.place, place);
    if (placeText !== (existing.place || '')) {
      await restWrite(`group_members?id=eq.${existing.id}`, 'PATCH', { place: placeText });
      existing.place = placeText;
    }
    return;
  }
  const byName = members.find((member) => nameKey(member.person_name) === nameKey(name));
  if (byName?.profile_id && byName.profile_id !== profileId) return;
  if (byName) {
    const placeText = mergePlace(byName.place, place);
    await restWrite(`group_members?id=eq.${byName.id}`, 'PATCH', { profile_id: profileId, place: placeText });
    byName.profile_id = profileId;
    byName.place = placeText;
    return;
  }
  await restWrite('group_members', 'POST', { group_slug: 'bc_players', profile_id: profileId, person_name: name, place });
  members.push({ profile_id: profileId, person_name: name, place });
}

async function markWelcomeSent(userId, metadata) {
  const next = { ...metadata, bc_welcome_sent: true };
  await authWrite(userId, { user_metadata: next });
  const user = [...usersByEmail.values()].find((item) => item.id === userId);
  if (user) user.user_metadata = next;
}

function phoneFor(squad, actions) {
  const email = String(squad.email || '').trim().toLowerCase();
  const usable = actions.filter((action) => action.phone && (action.kind === 'tag' || action.kind === 'create'));
  const byEmail = email ? usable.find((action) => action.email === email) : null;
  if (byEmail) return byEmail.phone;
  const byName = usable.filter((action) => {
    const squadKey = nameKey(squad.display_name || '');
    return squadKey && (squadKey === nameKey(action.name) || squadKey === nameKey(action.entryName || ''));
  });
  return byName.length === 1 ? byName[0].phone : '';
}

function mergePlace(current, next) {
  const parts = String(current || '')
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean);
  if (!parts.includes(next)) parts.push(next);
  return parts.join('; ');
}

async function listUsers() {
  const users = [];
  for (let page = 1; page < 20; page += 1) {
    const response = await fetch(`${base}/auth/v1/admin/users?page=${page}&per_page=200`, { headers: authHeaders() });
    if (!response.ok) throw new Error('The account list could not be read.');
    const body = await response.json();
    const batch = body.users || [];
    users.push(...batch);
    if (batch.length < 200) break;
  }
  return users;
}

async function authCreate(body) {
  const response = await fetch(`${base}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  const id = payload.id || payload.user?.id;
  if (!response.ok || !id) throw new Error(`A login could not be opened (${response.status}).`);
  return { id, email: payload.email || body.email };
}

async function authWrite(id, body) {
  const response = await fetch(`${base}/auth/v1/admin/users/${id}`, {
    method: 'PUT',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`A login could not be updated (${response.status}).`);
}

function authHeaders() {
  return { apikey: key, Authorization: `Bearer ${key}` };
}

async function restAll(path) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const response = await fetch(`${base}/rest/v1/${path}`, {
      headers: { ...authHeaders(), Range: `${from}-${from + 999}`, Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`The database could not be read (${response.status}).`);
    const page = await response.json();
    rows.push(...page);
    if (page.length < 1000) break;
  }
  return rows;
}

async function restWrite(path, method, body) {
  const response = await fetch(`${base}/rest/v1/${path}`, {
    method,
    headers: { ...authHeaders(), 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify(body),
  });
  if (response.status === 409) return;
  if (!response.ok) throw new Error(`The database could not be updated (${response.status}).`);
}

function pause(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadEnv() {
  const path = join(ROOT, '.env');
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const index = line.indexOf('=');
    const name = line.slice(0, index).trim();
    if (!process.env[name]) process.env[name] = line.slice(index + 1).trim();
  }
}

function noEmail(actions) {
  return actions.filter((action) => action.kind === 'skip' && action.reason === 'no email address').length;
}

function unpaid(actions) {
  return actions.filter((action) => action.kind === 'skip' && action.reason === 'payment has not succeeded').length;
}
