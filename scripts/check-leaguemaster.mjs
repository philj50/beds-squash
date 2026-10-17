/**
 * Compare Division 1 and Division 2 with the public League Master pages.
 * League Master is the source. The website should have the same fixtures,
 * the same results, and the same table (played, won, lost, drawn, points
 * for, points against, penalty, total).
 *
 *   node scripts/check-leaguemaster.mjs
 *
 * Prints one JSON line. Exits with an error when something differs.
 * Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const BASE = 'https://bedfordshiresquash.leaguemaster.co.uk';
const DIVISIONS = ['Division 1', 'Division 2'];

export function decode(html) {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&rsquo;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function cells(rowHtml) {
  return [...rowHtml.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((match) => decode(match[1]));
}

function scorePair(value) {
  const match = String(value ?? '').match(/^(\d+)\s*-\s*(\d+)$/);
  return match ? [Number(match[1]), Number(match[2])] : null;
}

export function parseSeasonName(html) {
  const match = html.match(/Divisions in:\s*([^<]+)/i);
  return match ? decode(match[1]) : '';
}

export function parseDivisionIds(html) {
  const out = [];
  for (const row of html.match(/<tr[\s\S]*?<\/tr>/gi) ?? []) {
    const id = row.match(/divisionid=(\d+)/);
    if (!id || !row.includes('showdivision')) continue;
    const name = cells(row).find((cell) => /^Division/i.test(cell));
    if (name) out.push({ id: id[1], name });
  }
  return out;
}

/** League Master table: position, team, played, won, lost, drawn, for, against, penalty, total. */
export function parseLmTable(html) {
  const rows = [];
  for (const match of html.matchAll(/<tr[^>]*class="(?:first|second)Row"[\s\S]*?<\/tr>/gi)) {
    const row = cells(match[0]);
    if (row.length < 11 || !/^\d+$/.test(row[0]) || !row[1] || row[1] === 'Team') continue;
    rows.push({
      pos: Number(row[0]),
      name: row[1],
      p: Number(row[3]),
      w: Number(row[4]),
      l: Number(row[5]),
      d: Number(row[6]),
      f: Number(row[7]),
      a: Number(row[8]),
      pen: Number(row[9]),
      total: Number(row[10]),
    });
  }
  return rows;
}

/** Fixture list. Result is the points score. The Games column on League Master is the rubbers. */
export function parseLmFixtures(html) {
  const fixtures = [];
  for (const match of html.matchAll(/<tr[^>]*class="([^"]*)"[\s\S]*?<\/tr>/gi)) {
    const row = match[0];
    const id = row.match(/fixtureid=(\d+)/);
    if (!id) continue;
    const rowCells = cells(row);
    const when = (rowCells.find((cell) => /\d{2}\/\d{2}\/\d{2}/.test(cell)) ?? '').replace(/^[A-Za-z]+\s+/, '');
    const viewAt = rowCells.lastIndexOf('View');
    const result = viewAt > 2 ? scorePair(rowCells[viewAt - 2]) : null;
    const lower = `${match[1]} ${decode(row)}`.toLowerCase();
    let status = 'scheduled';
    if (lower.includes('postponed')) status = 'postponed';
    else if (lower.includes('walkover') || lower.includes('w/o')) status = 'walkover';
    else if (result) status = 'played';
    fixtures.push({
      id: id[1],
      when,
      home: rowCells[2] ?? '',
      away: rowCells[3] ?? '',
      result,
      status,
    });
  }
  return fixtures;
}

export function londonStamp(iso) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/London',
      day: '2-digit',
      month: '2-digit',
      year: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date(iso))
      .map((part) => [part.type, part.value]),
  );
  return `${parts.day}/${parts.month}/${parts.year} ${parts.hour}:${parts.minute}`;
}

/** The same order as the League Master table: total, points difference, points for, name. */
export function tableFromResults(fixtures) {
  const rows = new Map();
  const ensure = (name) => {
    if (!rows.has(name)) rows.set(name, { name, p: 0, w: 0, l: 0, d: 0, f: 0, a: 0, pen: 0, total: 0 });
    return rows.get(name);
  };
  for (const fixture of fixtures) {
    ensure(fixture.home);
    ensure(fixture.away);
    if (!fixture.result) continue;
    const [homePoints, awayPoints] = fixture.result;
    const home = ensure(fixture.home);
    const away = ensure(fixture.away);
    home.p += 1;
    away.p += 1;
    home.f += homePoints;
    home.a += awayPoints;
    home.total += homePoints;
    away.f += awayPoints;
    away.a += homePoints;
    away.total += awayPoints;
    if (homePoints > awayPoints) {
      home.w += 1;
      away.l += 1;
    } else if (homePoints < awayPoints) {
      away.w += 1;
      home.l += 1;
    } else {
      home.d += 1;
      away.d += 1;
    }
  }
  return [...rows.values()].sort(
    (a, b) => b.total - a.total || b.f - b.a - (a.f - a.a) || b.f - a.f || a.name.localeCompare(b.name, 'en-GB'),
  );
}

export function compareDivision(lmFixtures, bedsFixtures) {
  const differences = [];
  const lmById = new Map(lmFixtures.map((fixture) => [String(fixture.id), fixture]));
  const bedsById = new Map(bedsFixtures.map((fixture) => [String(fixture.id), fixture]));
  for (const id of lmById.keys()) {
    if (!bedsById.has(id)) differences.push(`fixture ${id} is on League Master and missing here`);
  }
  for (const id of bedsById.keys()) {
    if (!lmById.has(id)) differences.push(`fixture ${id} is here and not on League Master`);
  }
  for (const [id, source] of lmById) {
    const row = bedsById.get(id);
    if (!row) continue;
    if (row.home !== source.home || row.away !== source.away) {
      differences.push(`fixture ${id} teams ${row.home} v ${row.away}, League Master has ${source.home} v ${source.away}`);
    }
    if (row.when !== source.when) differences.push(`fixture ${id} time ${row.when}, League Master has ${source.when}`);
    if (JSON.stringify(row.result) !== JSON.stringify(source.result)) {
      differences.push(`fixture ${id} result ${formatScore(row.result)}, League Master has ${formatScore(source.result)}`);
    }
    const marked = source.status === 'postponed' || source.status === 'walkover' || row.status === 'postponed' || row.status === 'walkover';
    if (marked && row.status !== source.status) {
      differences.push(`fixture ${id} is ${row.status}, League Master has ${source.status}`);
    }
  }
  const bedsTable = tableFromResults(bedsFixtures.filter((fixture) => bedsById.has(String(fixture.id))));
  const lmTable = tableFromResults(lmFixtures);
  const names = new Set([...bedsTable, ...lmTable].map((row) => row.name));
  for (const name of [...names].sort((a, b) => a.localeCompare(b, 'en-GB'))) {
    const here = bedsTable.find((row) => row.name === name);
    const there = lmTable.find((row) => row.name === name);
    if (!here || !there) {
      differences.push(`${name} is on one table only`);
      continue;
    }
    for (const key of ['p', 'w', 'l', 'd', 'f', 'a', 'pen', 'total']) {
      if (here[key] !== there[key]) differences.push(`${name} ${key} is ${here[key]}, League Master has ${there[key]}`);
    }
    if (bedsTable.findIndex((row) => row.name === name) !== lmTable.findIndex((row) => row.name === name)) {
      differences.push(`${name} is in a different table place`);
    }
  }
  return differences;
}

function formatScore(result) {
  return result ? `${result[0]}-${result[1]}` : 'no result';
}

function loadEnv() {
  try {
    const text = readFileSync(new URL('../.env', import.meta.url), 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const match = line.match(/^([A-Za-z0-9_]+)=(.*)$/);
      if (match && process.env[match[1]] == null) process.env[match[1]] = match[2].trim().replace(/^["']|["']$/g, '');
    }
  } catch {
    // GitHub Actions supplies the variables.
  }
}

async function request(urlPath) {
  const response = await fetch(BASE + urlPath, {
    headers: { 'user-agent': 'BedsSquashSync/1.0 (county website; public league data)' },
    signal: AbortSignal.timeout(25000),
  });
  if (!response.ok) throw new Error(`${urlPath} -> ${response.status}`);
  return response.text();
}

async function rest(path) {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  const response = await fetch(`${url}/rest/v1/${path}`, {
    headers: { apikey: key, authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(25000),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${path} -> ${response.status} ${text.slice(0, 180)}`);
  return text ? JSON.parse(text) : [];
}

function bedsFixture(row, teams) {
  return {
    id: String(row.leaguemaster_id ?? ''),
    when: londonStamp(row.starts_at),
    home: teams.get(row.home_team_id) ?? '',
    away: teams.get(row.away_team_id) ?? '',
    result: row.home_points == null || row.away_points == null ? null : [row.home_points, row.away_points],
    status: row.status,
  };
}

export async function checkDivisions() {
  const listHtml = await request('/cgi-county/icounty.exe/showdivlist');
  const season = parseSeasonName(listHtml);
  if (!season) throw new Error('League Master did not name the current season.');
  const wanted = parseDivisionIds(listHtml).filter((division) => DIVISIONS.includes(division.name));
  if (wanted.length !== DIVISIONS.length) {
    throw new Error(`League Master is missing ${DIVISIONS.filter((name) => !wanted.some((division) => division.name === name)).join(', ')}.`);
  }
  const seasons = await rest(`league_seasons?select=id,name&name=eq.${encodeURIComponent(season)}`);
  const seasonId = seasons[0]?.id;
  if (!seasonId) throw new Error(`${season} is not on the website.`);
  const divisions = await rest(`divisions?select=id,name&season_id=eq.${seasonId}`);
  const report = {};
  let ok = true;
  for (const division of wanted) {
    const here = divisions.find((row) => row.name === division.name);
    if (!here) {
      report[division.name] = { fixtures: 0, differences: [`${division.name} is not on the website`] };
      ok = false;
      continue;
    }
    const [tableHtml, fixtureHtml, teams, fixtures] = await Promise.all([
      request(`/cgi-county/icounty.exe/showdivision?divisionid=${division.id}`),
      request(`/cgi-county/icounty.exe/showdivfixtures?divisionid=${division.id}`),
      rest(`league_teams?select=id,name&division_id=eq.${here.id}`),
      rest(
        `fixtures?select=leaguemaster_id,home_team_id,away_team_id,starts_at,status,home_points,away_points&division_id=eq.${here.id}`,
      ),
    ]);
    const published = parseLmTable(tableHtml);
    const lmFixtures = parseLmFixtures(fixtureHtml);
    const teamNames = new Map(teams.map((team) => [team.id, team.name]));
    const bedsFixtures = fixtures.map((row) => bedsFixture(row, teamNames));
    const differences = compareDivision(lmFixtures, bedsFixtures);
    const built = tableFromResults(lmFixtures);
    for (const row of published) {
      const fromFixtures = built.find((item) => item.name === row.name);
      if (!fromFixtures) {
        differences.push(`${row.name} is on the League Master table and not in its fixtures`);
        continue;
      }
      for (const key of ['p', 'w', 'l', 'd', 'f', 'a', 'pen', 'total']) {
        if (fromFixtures[key] !== row[key]) {
          differences.push(`League Master table ${row.name} ${key} is ${row[key]}, its fixtures add up to ${fromFixtures[key]}`);
        }
      }
    }
    if (differences.length) ok = false;
    report[division.name] = { fixtures: lmFixtures.length, differences: differences.slice(0, 20) };
  }
  return { ok, season, divisions: report };
}

async function main() {
  loadEnv();
  const report = await checkDivisions();
  console.log(JSON.stringify(report));
  if (!report.ok) process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
