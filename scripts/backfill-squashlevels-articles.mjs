/**
 * Run squashlevels-daily.mjs for each date in a range (London calendar days).
 *
 *   node scripts/backfill-squashlevels-articles.mjs --from 2026-08-01 --to 2026-08-31
 *
 * Needs .env with SQUASHLEVELS_* and SUPABASE_SERVICE_ROLE_KEY. Does not send email.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const daily = join(ROOT, 'scripts', 'squashlevels-daily.mjs');

const args = process.argv.slice(2);
const from = args.includes('--from') ? args[args.indexOf('--from') + 1] : null;
const to = args.includes('--to') ? args[args.indexOf('--to') + 1] : null;

if (!from || !to) {
  console.error('Usage: node scripts/backfill-squashlevels-articles.mjs --from YYYY-MM-DD --to YYYY-MM-DD');
  process.exit(1);
}

function* days(start, end) {
  const cursor = new Date(`${start}T12:00:00Z`);
  const last = new Date(`${end}T12:00:00Z`);
  while (cursor <= last) {
    yield cursor.toISOString().slice(0, 10);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
}

for (const date of days(from, to)) {
  console.log(`\n=== ${date} ===`);
  const result = spawnSync(process.execPath, [daily, '--date', date], { stdio: 'inherit', cwd: ROOT });
  if (result.status !== 0) {
    console.error(`Stopped: squashlevels-daily failed for ${date}`);
    process.exit(result.status ?? 1);
  }
}

console.log('\nBackfill complete.');
