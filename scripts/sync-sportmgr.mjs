/**
 * Refresh Sport Manager tournaments named on an event page.
 *
 *   node --use-system-ca scripts/sync-sportmgr.mjs --snapshot
 *   node --use-system-ca scripts/sync-sportmgr.mjs
 *
 * --snapshot writes src/data/sportmgr/<id>.json and does not touch the database.
 * Without it, rows are upserted when SUPABASE_SERVICE_ROLE_KEY is set.
 * The key is read from the environment or .env and is never printed.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLOSED_SCORE_TOPIC, fetchTournament, freshScores, scoreNote } from './sportmgr-lib.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SUPABASE_URL = 'https://klxyjmwiaivvqjbhxzak.supabase.co';
const snapshotOnly = process.argv.includes('--snapshot');

loadEnv();

const events = readdirSync(join(ROOT, 'src', 'content', 'events'))
  .filter((name) => name.endsWith('.md') && !name.startsWith('_'))
  .map((name) => {
    const text = readFileSync(join(ROOT, 'src', 'content', 'events', name), 'utf8');
    const id = text.match(/^sportmgr:\s*(\d+)\s*$/m);
    return id ? { eventId: name.replace(/\.md$/, ''), sportmgr: Number(id[1]) } : null;
  })
  .filter(Boolean);

if (events.length === 0) {
  console.log('No events have a sportmgr id.');
  process.exit(0);
}

const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!snapshotOnly && !key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set. Use --snapshot to write JSON only.');

for (const event of events) {
  const tournament = await fetchTournament(event.sportmgr);
  console.log(`${tournament.title}: ${tournament.entries.length} entries, ${tournament.matches.length} matches`);
  if (snapshotOnly) {
    const dir = join(ROOT, 'src', 'data', 'sportmgr');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${tournament.id}.json`), `${JSON.stringify(tournament, null, 2)}\n`);
    continue;
  }
  try {
    await rest('sportmgr_tournaments?on_conflict=id', {
      method: 'POST',
      prefer: 'resolution=merge-duplicates,return=minimal',
      body: { id: tournament.id, event_id: event.eventId, title: tournament.title, synced_at: tournament.syncedAt },
    });
  } catch (error) {
    const message = String(error);
    if (message.includes('PGRST205') || message.includes('Could not find the table')) {
      console.log('The Sport Manager tables are not in the database yet, so nothing was stored.');
      process.exit(0);
    }
    throw error;
  }
  const stored = await rest(`sportmgr_matches?tournament_id=eq.${tournament.id}&select=id,score`);
  const arrived = freshScores(Array.isArray(stored) ? stored : [], tournament.matches);
  await rest(`sportmgr_entries?tournament_id=eq.${tournament.id}`, { method: 'DELETE' });
  for (const batch of chunks(tournament.entries, 200)) {
    await rest('sportmgr_entries', {
      method: 'POST',
      body: batch.map((entry) => ({
        tournament_id: tournament.id,
        grade: entry.grade,
        player_name: entry.name,
        club: entry.club,
        seed: entry.seed,
      })),
    });
  }
  for (const batch of chunks(tournament.matches, 200)) {
    await rest('sportmgr_matches?on_conflict=id', {
      method: 'POST',
      prefer: 'resolution=merge-duplicates,return=minimal',
      body: batch.map((match) => ({
        id: match.id,
        tournament_id: tournament.id,
        played_on: match.date,
        start_time: match.start,
        end_time: match.end,
        court: match.court,
        grade: match.grade,
        round_label: match.round,
        home_name: match.home,
        away_name: match.away,
        score: match.score,
      })),
    });
  }
  const ids = tournament.matches.map((match) => match.id);
  const stale = ids.length ? `&id=not.in.(${ids.join(',')})` : '';
  await rest(`sportmgr_matches?tournament_id=eq.${tournament.id}${stale}`, { method: 'DELETE' });
  let sent = 0;
  for (const match of arrived) {
    if (await publishScore(match)) sent += 1;
  }
  if (arrived.length) console.log(`Sent ${sent} of ${arrived.length} score notes to ${CLOSED_SCORE_TOPIC}.`);
}

function chunks(items, size) {
  const batches = [];
  for (let index = 0; index < items.length; index += size) batches.push(items.slice(index, index + size));
  return batches;
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

async function publishScore(match) {
  try {
    const response = await fetch(`https://ntfy.sh/${CLOSED_SCORE_TOPIC}`, {
      method: 'POST',
      headers: { Title: 'Beds Closed', Tags: 'squash' },
      body: scoreNote(match),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function rest(path, { method = 'GET', body, prefer } = {}) {
  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
  };
  if (prefer) headers.Prefer = prefer;
  else if (method !== 'GET') headers.Prefer = 'return=minimal';
  const response = await fetch(`${process.env.SUPABASE_URL || SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${method} ${path.split('?')[0]} returned ${response.status}: ${text.slice(0, 240)}`);
  }
  if (method === 'GET') return response.json();
}
