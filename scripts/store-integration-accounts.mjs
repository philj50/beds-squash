/**
 * Store integration account names for the admin Config list.
 * Passwords are never read and never written.
 *
 *   node --use-system-ca scripts/store-integration-accounts.mjs
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SUPABASE_URL = 'https://klxyjmwiaivvqjbhxzak.supabase.co';

const ACCOUNTS = [
  ['squashlevels', 'SQUASHLEVELS_EMAIL'],
  ['leaguemaster', 'LEAGUEMASTER_USERNAME'],
  ['sportmanager', 'SPORTS_MANAGER_USERNAME'],
  ['gmail', 'GMAIL_USERNAME'],
  ['ntfy', 'NTFY_TOPIC'],
  ['englandsquash', 'ENGLANDSQUASH_USERNAME'],
  ['squashtv', 'SQUASH_TV_USERNAME'],
];

loadEnv();

const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const base = process.env.SUPABASE_URL || SUPABASE_URL;
if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set.');

const rows = ACCOUNTS.map(([slug, name]) => ({ slug, account: (process.env[name] || '').trim() })).filter((row) => row.account);
if (rows.length === 0) throw new Error('No integration account names are set.');

const response = await fetch(`${base}/rest/v1/integration_accounts?on_conflict=slug`, {
  method: 'POST',
  headers: {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    Prefer: 'resolution=merge-duplicates,return=minimal',
  },
  body: JSON.stringify(rows.map((row) => ({ ...row, updated_at: new Date().toISOString() }))),
});

if (!response.ok) {
  const missing = response.status === 404 || (await response.clone().text()).includes('integration_accounts');
  if (missing) throw new Error('The integration account list is not on the database yet.');
  throw new Error(`The account names could not be saved (${response.status}).`);
}

console.log(`Saved ${rows.length} account names. Passwords were left in GitHub.`);

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
