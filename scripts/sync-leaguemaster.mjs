/**
 * Copy the current Bedfordshire League Master season into our database.
 *
 * Reads: seasons, divisions, teams, fixtures, results, individual rubbers,
 * and the period 1 / period 2 nomination lists. Nothing is sent to anyone.
 *
 * Usage:
 *   node scripts/sync-leaguemaster.mjs                  # import into Supabase
 *   node scripts/sync-leaguemaster.mjs --out file.json  # write the payload only
 *   node scripts/sync-leaguemaster.mjs --season "Winter 2025/26"
 *
 * Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY unless --out is used.
 */
import { writeFile } from 'node:fs/promises';

const BASE = 'https://bedfordshiresquash.leaguemaster.co.uk';
const args = process.argv.slice(2);
const outFile = args.includes('--out') ? args[args.indexOf('--out') + 1] : null;
const wantSeason = args.includes('--season') ? args[args.indexOf('--season') + 1] : null;

let cookie = '';

function decode(html) {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&rsquo;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function cells(rowHtml) {
  return [...rowHtml.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) => decode(m[1]));
}

function slugify(name) {
  return name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function storeCookies(res) {
  const set = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  for (const c of set) {
    const pair = c.split(';')[0];
    const name = pair.split('=')[0];
    cookie = cookie
      .split('; ')
      .filter((p) => p && !p.startsWith(name + '='))
      .concat(pair)
      .join('; ');
  }
}

async function request(urlPath, { method = 'GET', body } = {}) {
  const res = await fetch(BASE + urlPath, {
    method,
    redirect: 'manual',
    headers: {
      cookie,
      ...(body ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
      'user-agent': 'BedsSquashSync/1.0 (county website; public league data)',
    },
    body,
  });
  storeCookies(res);
  if (res.status >= 300 && res.status < 400) {
    const loc = res.headers.get('location') || '';
    return request(loc.startsWith('http') ? loc.replace(BASE, '') : loc);
  }
  if (!res.ok) throw new Error(`${method} ${urlPath} -> ${res.status}`);
  return res.text();
}

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

function parseSeasons(html) {
  return [...html.matchAll(/<option[^>]*value="(\d+)"[^>]*>\s*([^<]+)/gi)].map((m) => ({
    id: m[1],
    name: decode(m[2]),
  }));
}

function parseDivisions(html) {
  const out = [];
  for (const row of [...html.matchAll(/<tr[\s\S]*?<\/tr>/gi)].map((m) => m[0])) {
    const id = row.match(/divisionid=(\d+)/);
    if (!id || !row.includes('showdivision')) continue;
    const c = cells(row);
    const name = c.find((x) => /^Division/i.test(x));
    const scoring = c.find((x) => /PAR/i.test(x)) ?? null;
    if (name) out.push({ lmId: id[1], name, scoring });
  }
  return out;
}

function parseTeamList(html) {
  const teams = [];
  for (const m of html.matchAll(/showteam\?teamid=(\d+)[^>]*>([^<]+)/gi)) {
    teams.push({ leaguemaster_id: m[1], name: decode(m[2]) });
  }
  return teams;
}

function parseClubList(html) {
  const clubs = [];
  for (const m of html.matchAll(/showclub\?clubid=(\d+)[^>]*>([^<]+)/gi)) {
    const name = decode(m[2]);
    if (!name) continue;
    clubs.push({ leaguemaster_id: m[1], name, slug: slugify(name) });
  }
  return clubs;
}

function clubFor(teamName, clubs) {
  let best = null;
  for (const club of clubs) {
    if (teamName.startsWith(club.name) && (!best || club.name.length > best.name.length)) best = club;
  }
  return best;
}

function parseFixtures(html) {
  const fixtures = [];
  for (const m of html.matchAll(/<tr[^>]*class="([^"]*)"[\s\S]*?<\/tr>/gi)) {
    const row = m[0];
    const cls = m[1];
    if (cls.includes('month')) continue;
    const id = row.match(/fixtureid=(\d+)/);
    if (!id) continue;
    const c = cells(row);
    const when = c.find((x) => /\d{2}\/\d{2}\/\d{2}/.test(x)) ?? '';
    const teams = c.filter(
      (x) => x && !/^\d+$/.test(x) && !/\d{2}\/\d{2}\/\d{2}/.test(x) && !/^\d+\s*-\s*\d+$/.test(x) && x !== 'View',
    );
    const scores = c.filter((x) => /^\d+\s*-\s*\d+$/.test(x));
    const dm = when.match(/(\d{2})\/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2})/);
    let startsAt = null;
    if (dm) {
      // League Master shows UK local time. Work out the offset for that date.
      const year = Number(dm[3]) + 2000;
      const local = `${year}-${dm[2]}-${dm[1]}T${dm[4]}:${dm[5]}:00`;
      startsAt = toUtc(local);
    }
    const points = scores[0]?.split(/\s*-\s*/).map(Number);
    const games = scores[1]?.split(/\s*-\s*/).map(Number);
    const played = Boolean(points) || cls.toLowerCase().includes('done');
    const lower = row.toLowerCase();
    const status = lower.includes('postponed') ? 'postponed' : lower.includes('walkover') || lower.includes('w/o') ? 'walkover' : played ? 'played' : 'scheduled';
    fixtures.push({
      lm_id: id[1],
      starts_at: startsAt,
      home: teams[0] ?? '',
      away: teams[1] ?? '',
      status,
      home_points: points?.[0] ?? null,
      away_points: points?.[1] ?? null,
      home_games: games?.[0] ?? null,
      away_games: games?.[1] ?? null,
      rubbers: [],
    });
  }
  return fixtures;
}

/** Convert a Europe/London wall-clock time to an ISO string in UTC. */
function toUtc(local) {
  const guess = new Date(local + 'Z');
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  const parts = Object.fromEntries(fmt.formatToParts(guess).map((p) => [p.type, p.value]));
  const shown = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute);
  const offsetMs = shown - guess.getTime();
  return new Date(guess.getTime() - offsetMs).toISOString();
}

function parseMatch(html) {
  const rubbers = [];
  let pos = 0;
  for (const m of html.matchAll(/<tr[^>]*class="(?:first|second)Row"[\s\S]*?<\/tr>/gi)) {
    const c = cells(m[0]);
    if (c.length < 6) continue;
    pos += 1;
    const homeGames = Number(c[4]);
    const awayGames = Number(c[5]);
    let winner = 'unplayed';
    if (Number.isFinite(homeGames) && Number.isFinite(awayGames) && (homeGames || awayGames)) {
      winner = homeGames > awayGames ? 'home' : 'away';
    }
    rubbers.push({ position: pos, home_player: c[1] || null, away_player: c[3] || null, score: c[6] || null, winner });
  }
  return rubbers;
}

function parseNominations(html, teamsById) {
  // Blocks start with <th class="boxtopleft">Team name</th>, then rows of position + name.
  const out = [];
  const parts = html.split(/<th class="boxtopleft"[^>]*>/i).slice(1);
  for (const part of parts) {
    const teamName = decode(part.slice(0, part.indexOf('</th>')));
    // The block runs until the next heading or the end of the box. Row tags are
    // not always closed, so read the cells directly: numbers are positions, the
    // rest are player names in ranking order.
    const endAt = Math.min(...[part.indexOf('<th', 1), part.indexOf('</table>')].filter((i) => i > 0));
    const block = part.slice(part.indexOf('</th>'), Number.isFinite(endAt) ? endAt : undefined);
    const players = [...block.matchAll(/<td class="box(?:top)?main"[^>]*>([\s\S]*?)<\/td>/gi)]
      .map((m) => decode(m[1]))
      .filter((x) => x && !/^\d+$/.test(x));
    const team = [...teamsById.values()].find((t) => t.name === teamName);
    out.push({ team_name: teamName, leaguemaster_team_id: team?.leaguemaster_id ?? null, players });
  }
  return out;
}

async function buildPayload(season) {
  await request('/cgi-county/icounty.exe/changecompetition?', { method: 'POST', body: `compselect=${season.id}` });
  const clubs = parseClubList(await request('/cgi-county/icounty.exe/showclublist'));
  const teamList = parseTeamList(await request('/cgi-county/icounty.exe/showteamlist'));
  const teamsById = new Map(teamList.map((t) => [t.leaguemaster_id, t]));
  const divisions = parseDivisions(await request('/cgi-county/icounty.exe/showdivlist'));

  const payload = { season: { name: season.name, starts_on: null, ends_on: null }, divisions: [], nominations: [] };
  const allDates = [];

  for (const division of divisions) {
    const fixtures = parseFixtures(await request(`/cgi-county/icounty.exe/showdivfixtures?divisionid=${division.lmId}`));
    const names = new Set(fixtures.flatMap((f) => [f.home, f.away]).filter(Boolean));
    const teams = [...names].map((name) => {
      const listed = teamList.find((t) => t.name === name);
      const club = clubFor(name, clubs);
      return { name, leaguemaster_id: listed?.leaguemaster_id ?? null, club_slug: club?.slug ?? null };
    });
    for (const fx of fixtures) {
      if (fx.starts_at) allDates.push(fx.starts_at);
      if (fx.status === 'played') {
        fx.rubbers = parseMatch(await request(`/cgi-county/icounty.exe/showmatch?fixtureid=${fx.lm_id}&divid=${division.lmId}`));
        await pause(40);
      }
    }
    payload.divisions.push({ name: division.name, scoring: division.scoring, teams, fixtures });
    console.error(`${season.name} ${division.name}: ${teams.length} teams, ${fixtures.length} fixtures`);
  }

  for (const club of clubs) {
    for (const period of [1, 2]) {
      const html = await request(`/cgi-county/icounty.exe/showteamnominations?clubid=${club.leaguemaster_id}&compid=${season.id}&nomperiod=${period}`);
      for (const nom of parseNominations(html, teamsById)) {
        if (nom.players.length) payload.nominations.push({ ...nom, period });
      }
      await pause(40);
    }
  }
  console.error(`${season.name}: ${payload.nominations.length} nomination lists with players`);

  if (allDates.length) {
    allDates.sort();
    payload.season.starts_on = allDates[0].slice(0, 10);
    payload.season.ends_on = allDates[allDates.length - 1].slice(0, 10);
  }
  return payload;
}

async function importPayload(payload) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, or pass --out to write a file.');
  const res = await fetch(`${url.replace(/\/$/, '')}/rest/v1/rpc/import_league_master`, {
    method: 'POST',
    headers: { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ payload }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`import_league_master -> ${res.status} ${text}`);
  return text;
}

async function main() {
  const seasons = parseSeasons(await request('/cgi-county/icounty.exe'));
  if (!seasons.length) throw new Error('No seasons found on League Master.');
  const season = wantSeason ? seasons.find((s) => s.name === wantSeason) : seasons[0];
  if (!season) throw new Error(`Season not found: ${wantSeason}. Seen: ${seasons.map((s) => s.name).join(', ')}`);

  const payload = await buildPayload(season);
  if (outFile) {
    await writeFile(outFile, JSON.stringify(payload, null, 2));
    console.error(`wrote ${outFile}`);
    return;
  }
  console.log(await importPayload(payload));
  await refreshContacts();
}

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

async function rest(path, options = {}) {
  const url = process.env.SUPABASE_URL.replace(/\/$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const res = await fetch(`${url}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      'content-type': 'application/json',
      prefer: 'return=minimal',
      ...(options.headers ?? {}),
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${options.method || 'GET'} ${path} -> ${res.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

/** Copy club manager and team contact emails from the public League Master pages. */
async function refreshContacts() {
  const clubs = await rest('clubs?select=slug,leaguemaster_club_id,contact_name,contact_email');
  const teams = await rest('teams?select=id,leaguemaster_team_id,captain_name,captain_email');
  let clubCount = 0;
  let captainCount = 0;
  for (const club of clubs ?? []) {
    if (!club.leaguemaster_club_id) continue;
    const html = await request(`/cgi-county/icounty.exe/showclub?clubid=${club.leaguemaster_club_id}`);
    const fields = fieldsUntil(labelled(html), 'Manager', /fixture|nomination/i);
    const contactName = fields.manager || null;
    const contactEmail = (fields.email || '').includes('@') ? fields.email.toLowerCase() : null;
    const nextName = contactName || club.contact_name;
    const nextEmail = contactEmail || club.contact_email;
    if (nextName !== club.contact_name || nextEmail !== club.contact_email) {
      await rest(`clubs?slug=eq.${encodeURIComponent(club.slug)}`, {
        method: 'PATCH',
        body: JSON.stringify({ contact_name: nextName, contact_email: nextEmail }),
      });
      clubCount += 1;
    }
    await pause(40);
  }
  for (const team of teams ?? []) {
    if (!team.leaguemaster_team_id) continue;
    const html = await request(`/cgi-county/icounty.exe/showteam?teamid=${team.leaguemaster_team_id}`);
    const fields = fieldsUntil(labelled(html), 'Team Contact', /reserve|club details|fixture|nomination/i);
    const captainName = fields['team contact'] || null;
    const captainEmail = (fields.email || '').includes('@') ? fields.email.toLowerCase() : null;
    const nextName = captainName || team.captain_name;
    const nextEmail = captainEmail || team.captain_email;
    if (nextName !== team.captain_name || nextEmail !== team.captain_email) {
      await rest(`teams?id=eq.${team.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ captain_name: nextName, captain_email: nextEmail }),
      });
      const squads = await rest(`captain_squads?team_id=eq.${team.id}&select=id`);
      if (squads?.[0] && nextEmail) {
        await rest(`captain_squads?id=eq.${squads[0].id}`, {
          method: 'PATCH',
          body: JSON.stringify({ captain_email: nextEmail }),
        });
      }
      captainCount += 1;
    }
    await pause(40);
  }
  console.error(`League Master contacts: ${clubCount} clubs, ${captainCount} captains updated`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
