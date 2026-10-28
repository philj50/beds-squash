/**
 * Print a Sport Manager tournament without writing it anywhere.
 *
 *   node --use-system-ca scripts/sportmgr-dry-run.mjs 945811
 */
import { fetchTournament } from './sportmgr-lib.mjs';

const id = process.argv[2];
if (!/^\d+$/.test(id ?? '')) {
  console.error('Usage: node --use-system-ca scripts/sportmgr-dry-run.mjs <tournament-id>');
  process.exit(1);
}

const tournament = await fetchTournament(id);
const names = new Set(tournament.entries.map((entry) => entry.name));
const scored = tournament.matches.filter((match) => match.score);
console.log(tournament.title);
console.log(`Grades: ${tournament.grades.join(', ') || 'none'}`);
console.log(`Entries: ${tournament.entries.length} (${names.size} named players)`);
console.log(`Days: ${tournament.dates.join(', ') || 'none'}`);
console.log(`Matches: ${tournament.matches.length}, with a score ${scored.length}`);
