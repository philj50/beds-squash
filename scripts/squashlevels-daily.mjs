/**
 * Read SquashLevels with the premium account, store rating history, and
 * prepare one league match article for each division that played.
 *
 * Usage:
 *   node scripts/squashlevels-daily.mjs            # yesterday in London
 *   node scripts/squashlevels-daily.mjs --latest   # most recent day with a result
 *   node scripts/squashlevels-daily.mjs --date 2026-08-11
 *   node scripts/squashlevels-daily.mjs --backfill    # county and club lists, then a name search
 *   node scripts/squashlevels-daily.mjs --exceptions # current names those lists missed
 *
 * Writes need SUPABASE_SERVICE_ROLE_KEY. Without it, SQL is written to the
 * temp directory and a news file is still written when publishing is automatic.
 * Sign-in uses SQUASHLEVELS_EMAIL and SQUASHLEVELS_PASSWORD from the environment
 * or from .env. Those values are never printed.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { nvidiaArticle } from './lib/nvidia-article.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const NEWS_DIR = join(ROOT, 'src', 'content', 'news');
const SEASON_NAME = 'Winter 2026/27';
const MINIGAME_TOP = join(NEWS_DIR, '_minigame-top.json');
const SL_BASE = 'https://api-leveltech.squashlevels.com/api/classic/';
const SUPABASE_URL = 'https://klxyjmwiaivvqjbhxzak.supabase.co';
const PUBLISHABLE_KEY = 'sb_publishable_wcOU09VyQcF7JWoZ6i-PHg_pFp6UM-4';
const SEARCH_LIMIT = 24;

loadEnv();

const args = process.argv.slice(2);
const wantLatest = args.includes('--latest');
const wantBackfill = args.includes('--backfill');
const wantExceptions = args.includes('--exceptions');
const wantDate = args.includes('--date') ? args[args.indexOf('--date') + 1] : null;
const canWrite = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);

const jar = new Map();

function loadEnv() {
  const path = join(ROOT, '.env');
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const index = line.indexOf('=');
    const key = line.slice(0, index).trim();
    if (!process.env[key]) process.env[key] = line.slice(index + 1).trim();
  }
}

function londonDate(value) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(value);
}

function longDate(iso) {
  const [year, month, day] = iso.split('-').map(Number);
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

function divisionSlug(name) {
  return (
    String(name || 'league')
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'league'
  );
}

function nameKey(name) {
  return name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function levelText(level) {
  return Number(level).toLocaleString('en-GB');
}

function personName(html) {
  const link = String(html ?? '').match(/player_detail\?player=\d+[^>]*>([\s\S]{0,240}?)<\/a>/);
  return plain(link?.[1] ?? '');
}

function plain(html) {
  return String(html ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&rsquo;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function sliceJson(html, start) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < html.length; index += 1) {
    const char = html[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return html.slice(start, index + 1);
    }
  }
  return null;
}

function storeCookies(response) {
  const list = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [];
  for (const cookie of list) {
    const pair = cookie.split(';')[0];
    jar.set(pair.split('=')[0], pair);
  }
}

async function sl(path, { method = 'GET', body } = {}) {
  const response = await fetch(SL_BASE + path, {
    method,
    redirect: 'manual',
    signal: AbortSignal.timeout(90000),
    headers: {
      'user-agent': 'Mozilla/5.0 BedsSquash/1.0',
      cookie: [...jar.values()].join('; '),
      ...(body ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
    },
    body,
  });
  storeCookies(response);
  return await response.text();
}

async function signIn() {
  const email = process.env.SQUASHLEVELS_EMAIL;
  const password = process.env.SQUASHLEVELS_PASSWORD;
  if (!email || !password) throw new Error('Set SQUASHLEVELS_EMAIL and SQUASHLEVELS_PASSWORD.');
  const html = await sl('menu_login', {
    method: 'POST',
    body: new URLSearchParams({
      stay_logged_in: '1',
      action: 'login',
      referer: '/menu_login',
      email,
      password,
      md5password: createHash('md5').update(password).digest('hex'),
    }).toString(),
  });
  const page = html.match(/currentPage = '([^']+)'/)?.[1];
  if (page !== 'dashboard') throw new Error(`SquashLevels sign-in failed (${page ?? 'no page'}).`);
}

async function rest(path, { method = 'GET', body, write = false, range, prefer } = {}) {
  const key = write ? process.env.SUPABASE_SERVICE_ROLE_KEY : process.env.SUPABASE_SERVICE_ROLE_KEY || PUBLISHABLE_KEY;
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      'content-type': 'application/json',
      ...(range ? { range } : {}),
      ...(method === 'GET' ? {} : { prefer: prefer ?? 'resolution=merge-duplicates,return=minimal' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${path.split('?')[0]} -> ${response.status} ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : null;
}

async function leagueDays() {
  const select = [
    'id',
    'starts_at',
    'division_id',
    'home_team_id',
    'home_points',
    'away_points',
    'home:league_teams!fixtures_home_team_id_fkey(name)',
    'away:league_teams!fixtures_away_team_id_fkey(name)',
    'division:divisions(id,name,season_id,league_seasons(name))',
    'rubbers(id,position,home_player,away_player,score,winner)',
  ].join(',');
  const rows = await rest(
    `fixtures?select=${encodeURIComponent(select)}&status=eq.played&order=starts_at.desc&limit=40`,
  );
  const days = new Map();
  for (const fixture of rows ?? []) {
    const playedOn = londonDate(new Date(fixture.starts_at));
    const rubbers = (fixture.rubbers ?? []).flatMap((rubber) => {
      if (rubber.winner !== 'home' && rubber.winner !== 'away') return [];
      if (!rubber.home_player || !rubber.away_player || !rubber.score) return [];
      if (/walkover/i.test(rubber.home_player) || /walkover/i.test(rubber.away_player)) return [];
      return [{
        ...rubber,
        playedOn,
        fixtureId: fixture.id,
        divisionId: fixture.division?.id ?? fixture.division_id,
        seasonId: fixture.division?.season_id,
        division: fixture.division?.name ?? 'the league',
        season: fixture.division?.league_seasons?.name ?? 'the league',
        homeTeam: fixture.home?.name ?? 'the home team',
        awayTeam: fixture.away?.name ?? 'the away team',
        homeTeamId: fixture.home_team_id,
        homePoints: fixture.home_points,
        awayPoints: fixture.away_points,
      }];
    });
    if (!rubbers.length) continue;
    days.set(playedOn, [...(days.get(playedOn) ?? []), ...rubbers]);
  }
  return [...days.entries()].sort((a, b) => b[0].localeCompare(a[0]));
}

function clubTokens(team) {
  const stop = new Set(['club', 'team', 'leisure', 'centre', 'center', 'squash', 'the', 'and']);
  return nameKey(team ?? '')
    .split(' ')
    .filter((word) => word.length > 3 && !stop.has(word));
}

async function searchPlayer(name, team) {
  const html = await sl(`players?all&search=${encodeURIComponent(name)}&nocss=true&nojs=true`);
  const hits = [];
  for (const match of html.matchAll(/player_detail\?player=(\d+)[^>]*>([^<]+)/g)) {
    const displayName = plain(match[2]);
    if (nameKey(displayName) !== nameKey(name)) continue;
    hits.push({
      id: Number(match[1]),
      name: displayName,
      club: nameKey(plain(html.slice(match.index, match.index + 450))).replace(nameKey(name), ''),
    });
  }
  const unique = [...new Map(hits.map((hit) => [hit.id, hit])).values()];
  const tokens = clubTokens(team);
  const narrowed = tokens.length
    ? unique.filter((hit) => tokens.some((token) => hit.club.includes(token)))
    : unique;
  const chosen = narrowed.length === 1 ? narrowed : unique.length === 1 ? unique : [];
  if (chosen.length === 1) return { status: 'matched', playerId: chosen[0].id, displayName: chosen[0].name, via: 'directory' };
  if (unique.length > 1) return { status: 'ambiguous', playerId: null, displayName: null, via: 'directory' };
  const site = await searchSite(name);
  const siteExact = [...new Map(site.filter((hit) => nameKey(hit.name) === nameKey(name)).map((hit) => [hit.id, hit])).values()];
  const siteNarrowed = tokens.length
    ? siteExact.filter((hit) => tokens.some((token) => hit.club.includes(token)))
    : siteExact;
  const siteChosen = siteNarrowed.length === 1 ? siteNarrowed : siteExact.length === 1 ? siteExact : [];
  if (siteChosen.length === 1) return { status: 'matched', playerId: siteChosen[0].id, displayName: siteChosen[0].name, via: 'site' };
  if (siteExact.length > 1) return { status: 'ambiguous', playerId: null, displayName: null, via: 'site' };
  return {
    status: 'missing',
    playerId: null,
    displayName: null,
    via: 'site',
    nearby: site.slice(0, 5).map((hit) => hit.name),
  };
}

async function searchSite(name) {
  try {
    const response = await fetch('https://api-leveltech.squashlevels.com/api/search', {
      method: 'POST',
      redirect: 'manual',
      signal: AbortSignal.timeout(20000),
      headers: {
        'user-agent': 'Mozilla/5.0 BedsSquash/1.0',
        'content-type': 'application/json',
        cookie: [...jar.values()].join('; '),
      },
      body: JSON.stringify({ name: name.toLowerCase(), includeClubs: false, clubsOnly: false }),
    });
    storeCookies(response);
    if (!response.ok) return [];
    const body = await response.json();
    const rows = Array.isArray(body?.data?.array) ? body.data.array : [];
    const hits = [];
    for (const row of rows) {
      const displayName = plain(row.player);
      const id = Number(row.playerid);
      if (!displayName || !Number.isFinite(id) || id <= 0) continue;
      hits.push({ id, name: displayName, club: nameKey(`${row.club ?? ''} ${row.county ?? ''}`) });
    }
    return [...new Map(hits.map((hit) => [hit.id, hit])).values()];
  } catch {
    return [];
  }
}

function pause() {
  return new Promise((resolve) => setTimeout(resolve, 300));
}

function listedPlayers(html, bedsOnly) {
  const found = new Map();
  for (const match of html.matchAll(/player_detail\?player=(\d+)[^>]*>([^<]+)/g)) {
    const id = Number(match[1]);
    const displayName = plain(match[2]);
    if (!displayName || found.has(id)) continue;
    if (bedsOnly) {
      const around = nameKey(plain(html.slice(match.index, match.index + 450)));
      if (!around.includes('beds') && !around.includes('bedford')) continue;
    }
    found.set(id, displayName);
  }
  return found;
}

async function eachListPage(path, bedsOnly) {
  const found = new Map();
  for (let start = 0; start < 800; start += 26) {
    const html = await sl(`${path}${path.includes('?') ? '&' : '?'}start=${start}`);
    const page = listedPlayers(html, bedsOnly);
    let added = 0;
    for (const [id, displayName] of page) {
      if (found.has(id)) continue;
      found.set(id, displayName);
      added += 1;
    }
    if (!added) break;
    await pause();
  }
  return found;
}

async function bedsClubs() {
  const html = await sl('players?all&county=52');
  const select = html.match(/<select[^>]*id=['"]club_select['"][^>]*>([\s\S]*?)<\/select>/i)?.[1] ?? '';
  const clubs = [];
  for (const option of select.matchAll(/<option[^>]*value=['"](\d+)['"][^>]*>([^<]+)/gi)) {
    const name = plain(option[2]);
    if (!name || /^all\b/i.test(name) || /^none$/i.test(name)) continue;
    clubs.push({ id: option[1], name });
  }
  return clubs;
}

async function restAll(path) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const page = await rest(path, { range: `${from}-${from + 999}` });
    if (!Array.isArray(page) || !page.length) break;
    rows.push(...page);
    if (page.length < 1000) break;
  }
  return rows;
}

async function leaguePeople() {
  const fixtures = await restAll(
    'fixtures?select=id,starts_at,home:league_teams!fixtures_home_team_id_fkey(name),away:league_teams!fixtures_away_team_id_fkey(name)',
  );
  const fixtureById = new Map(fixtures.map((fixture) => [fixture.id, fixture]));
  const people = new Map();
  const consider = (name, team, when) => {
    const key = nameKey(name ?? '');
    if (!key.includes(' ') || key.includes('walkover')) return;
    const current = people.get(key);
    if (!current || when > current.when) people.set(key, { name, team: team || current?.team || '', when });
  };
  const rubbers = await restAll('rubbers?select=fixture_id,home_player,away_player,winner');
  for (const rubber of rubbers) {
    if (rubber.winner !== 'home' && rubber.winner !== 'away') continue;
    const fixture = fixtureById.get(rubber.fixture_id);
    const when = fixture?.starts_at ?? '';
    consider(rubber.home_player, oneName(fixture?.home), when);
    consider(rubber.away_player, oneName(fixture?.away), when);
  }
  const nominations = await restAll('nominations?select=player_name,team_id');
  const teams = nominations.length ? await restAll('teams?select=id,name') : [];
  const teamName = new Map(teams.map((team) => [team.id, team.name]));
  for (const nomination of nominations) consider(nomination.player_name, teamName.get(nomination.team_id) ?? '', '');
  const squads = await restAll('captain_squads?select=name,squad_players(display_name)');
  for (const squad of squads) {
    const members = Array.isArray(squad.squad_players) ? squad.squad_players : [];
    for (const player of members) consider(player.display_name, squad.name ?? '', '');
  }
  return people;
}

function oneName(value) {
  if (Array.isArray(value)) return value[0]?.name ?? '';
  return value?.name ?? '';
}

function ratingsFor(players, matches) {
  const ratings = [];
  const today = londonDate(new Date());
  for (const match of matches.values()) {
    for (const side of [
      [match.playerId, match.playerLevelBefore, match.playerLevelAfter],
      [match.opponentId, match.opponentLevelBefore, match.opponentLevelAfter],
    ]) {
      const [playerId, before, after] = side;
      if (!players.has(playerId)) continue;
      if (before !== null) ratings.push({ playerId, recordedOn: match.playedOn, level: before, matchId: match.id, kind: 'before' });
      if (after !== null) ratings.push({ playerId, recordedOn: match.playedOn, level: after, matchId: match.id, kind: 'after' });
    }
  }
  for (const player of players.values()) {
    if (player.currentLevel === null) continue;
    const kindRank = { before: 0, after: 1, snapshot: 2 };
    const latest = ratings
      .filter((rating) => rating.playerId === player.id)
      .sort((left, right) => right.recordedOn.localeCompare(left.recordedOn) || kindRank[right.kind] - kindRank[left.kind])[0];
    if (latest && latest.level === player.currentLevel) continue;
    ratings.push({ playerId: player.id, recordedOn: today, level: player.currentLevel, matchId: '', kind: 'snapshot' });
  }
  return ratings;
}

async function backfill() {
  if (!canWrite) throw new Error('Backfill needs SUPABASE_SERVICE_ROLE_KEY.');
  await signIn();
  const ids = new Map();
  const take = (found, label) => {
    let added = 0;
    for (const [id, displayName] of found) {
      if (ids.has(id)) continue;
      ids.set(id, displayName);
      added += 1;
    }
    console.error(`${label}: ${found.size} listed, ${added} new`);
  };

  for (const term of ['Bedfordshire', 'Beds']) {
    take(await eachListPage(`players?all&search=${encodeURIComponent(term)}&nocss=true&nojs=true`, true), `search ${term}`);
  }
  take(await eachListPage('players?all&county=52', false), 'county Beds');
  const clubs = await bedsClubs();
  console.error(`clubs: ${clubs.map((club) => club.name).join(', ') || 'none'}`);
  for (const club of clubs) {
    take(await eachListPage(`players?all&club=${club.id}`, false), club.name);
  }

  const knownNames = new Map();
  for (const row of await restAll('squashlevels_names?select=name_key,player_id,status')) {
    knownNames.set(row.name_key, { status: row.status, playerId: row.player_id });
  }
  const knownIds = new Set(
    (await restAll('squashlevels_players?select=id,current_level'))
      .filter((player) => player.current_level != null)
      .map((player) => player.id),
  );
  const covered = new Set([...ids.values()].map((displayName) => nameKey(displayName)));
  const people = await leaguePeople();
  const wanted = [...people.values()].filter((person) => {
    const key = nameKey(person.name);
    return !covered.has(key) && !knownNames.has(key);
  });
  console.error(`league names still to search: ${wanted.length}`);
  let searches = 0;
  for (const person of wanted) {
    const key = nameKey(person.name);
    let found = await searchPlayer(person.name, person.team);
    searches += 1;
    if (found.status === 'missing') {
      const alias = person.name.replace(/^Daniel\b/i, 'Dan');
      if (alias !== person.name) {
        found = await searchPlayer(alias, person.team);
        searches += 1;
        await pause();
      }
    }
    knownNames.set(key, found);
    if (found.playerId && !ids.has(found.playerId)) ids.set(found.playerId, found.displayName || person.name);
    console.error(`${found.status} ${person.name}${found.playerId ? ` ${found.playerId}` : ''}`);
    await pause();
  }

  const players = new Map();
  const matches = new Map();
  const namePayload = (chunk) => {
    const rows = [];
    const seen = new Set();
    const add = (key, playerId, status) => {
      if (!key || seen.has(key)) return;
      if (playerId != null && !chunk.has(playerId) && !knownIds.has(playerId)) return;
      seen.add(key);
      rows.push({ nameKey: key, playerId, status });
    };
    for (const [key, value] of knownNames) add(key, value.playerId ?? null, value.status);
    for (const player of chunk.values()) {
      if (player.currentLevel == null) continue;
      add(nameKey(player.displayName), player.id, 'matched');
    }
    return rows;
  };
  const saveChunk = async () => {
    await save({
      players: [...players.values()],
      matches: [...matches.values()],
      ratings: ratingsFor(players, matches),
      names: namePayload(players),
      article: null,
      summary: { backfill: true, listed: ids.size, fetched, searches },
    });
    for (const player of players.values()) {
      if (player.currentLevel != null) knownIds.add(player.id);
    }
    players.clear();
    matches.clear();
  };
  let fetched = 0;
  for (const [id, displayName] of ids) {
    if (knownIds.has(id)) continue;
    let page;
    try {
      page = parsePlayerPage(await sl(`player_detail?player=${id}&show=last12m`), id);
    } catch (error) {
      console.error(`skipped ${displayName} ${id}: ${error.message}`);
      await pause();
      continue;
    }
    if (!page.displayName || !page.currentLevel) {
      console.error(`no level for ${displayName} ${id}`);
      await pause();
      continue;
    }
    players.set(id, {
      id,
      displayName: page.displayName,
      currentLevel: page.currentLevel,
      confidence: page.confidence,
    });
    for (const match of page.matches) {
      matches.set(match.id, match);
      if (match.opponentId && match.opponentName && !players.has(match.opponentId) && !knownIds.has(match.opponentId)) {
        players.set(match.opponentId, {
          id: match.opponentId,
          displayName: match.opponentName,
          currentLevel: null,
          confidence: null,
        });
      }
    }
    knownNames.set(nameKey(page.displayName), { status: 'matched', playerId: id });
    fetched += 1;
    console.error(`${page.displayName} ${page.currentLevel} (${page.matches.length} matches)`);
    if (fetched % 20 === 0) {
      await saveChunk();
      console.error(`saved ${fetched}`);
    }
    await pause();
  }
  await saveChunk();
  const leagueKeys = new Set([...people.keys()]);
  const hidden = (await restAll('squashlevels_players?select=id,display_name&current_level=is.null')).filter(
    (player) => leagueKeys.has(nameKey(player.display_name)) && !knownIds.has(player.id),
  );
  console.error(`league names found on other players' matches: ${hidden.length}`);
  for (const player of hidden) {
    let page;
    try {
      page = parsePlayerPage(await sl(`player_detail?player=${player.id}&show=last12m`), player.id);
    } catch (error) {
      console.error(`skipped ${player.display_name} ${player.id}: ${error.message}`);
      await pause();
      continue;
    }
    if (!page.displayName || !page.currentLevel) {
      console.error(`no level for ${player.display_name} ${player.id}`);
      await pause();
      continue;
    }
    players.set(player.id, {
      id: player.id,
      displayName: page.displayName,
      currentLevel: page.currentLevel,
      confidence: page.confidence,
    });
    knownNames.set(nameKey(page.displayName), { status: 'matched', playerId: player.id });
    for (const match of page.matches) {
      matches.set(match.id, match);
      if (match.opponentId && match.opponentName && !players.has(match.opponentId) && !knownIds.has(match.opponentId)) {
        players.set(match.opponentId, {
          id: match.opponentId,
          displayName: match.opponentName,
          currentLevel: null,
          confidence: null,
        });
      }
    }
    fetched += 1;
    console.error(`${page.displayName} ${page.currentLevel} (${page.matches.length} matches)`);
    await pause();
  }
  await saveChunk();
  console.error(JSON.stringify({ backfill: true, listed: ids.size, fetched, searches, fromMatches: hidden.length }));
}

function parsePlayerPage(html, playerId) {
  const displayName = plain(html.match(new RegExp(`player_detail\\?player=${playerId}(?:&[^"'\\s]*)?["']>([^<]+)`))?.[1] ?? '');
  const currentLevel = Number((html.match(/class='headline_player_level'>([\d,]+)/)?.[1] ?? '').replace(/,/g, '')) || null;
  const confidenceSlice = html.slice(html.indexOf('confidence__container'), html.indexOf('confidence__container') + 700);
  const confidence = Number(confidenceSlice.match(/(\d{1,3})\s*%/)?.[1]);
  const matches = [];
  const marker = 'classic-json-data-match-';
  let from = 0;
  while (from < html.length) {
    const at = html.indexOf(marker, from);
    if (at < 0) break;
    const brace = html.indexOf('{', at);
    const raw = brace < 0 ? null : sliceJson(html, brace);
    from = (brace < 0 ? at : brace) + (raw?.length ?? 1);
    if (!raw) continue;
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      continue;
    }
    const details = data.match_details;
    const self = details?.player_match_levels;
    const opponent = details?.opponent1_match_levels;
    const doubles = details?.opponent2_match_levels;
    if (!details?.matchid || !self?.playerid || !opponent?.playerid) continue;
    if (!Array.isArray(doubles) || doubles.length) continue;
    const eventWindow = html.slice(Math.max(0, at - 5000), at);
    matches.push({
      id: String(details.matchid),
      playedOn: londonDate(new Date(Number(details.dateint) * 1000)),
      eventName: plain(eventWindow.match(/match_result_matchtype[^>]*>([^<]+)/)?.[1] ?? '') || null,
      playerId: Number(self.playerid),
      opponentId: Number(opponent.playerid),
      playerName: personName(data.player_detailed_info?.name) || displayName || null,
      opponentName: personName(data.opponent1_detailed_info?.name) || null,
      playerLevelBefore: numberOrNull(self.levelbefore),
      playerLevelAfter: numberOrNull(self.levelafter),
      opponentLevelBefore: numberOrNull(opponent.levelbefore),
      opponentLevelAfter: numberOrNull(opponent.levelafter),
      playerWon: details.win === true,
      gamesText: details.games_text || null,
      pointsText: details.points_text || null,
    });
  }
  return {
    displayName,
    currentLevel,
    confidence: Number.isInteger(confidence) ? confidence : null,
    matches,
  };
}

function numberOrNull(value) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function samePair(match, left, right) {
  return (
    (match.playerId === left && match.opponentId === right) ||
    (match.playerId === right && match.opponentId === left)
  );
}

function gameScores(score) {
  return score
    .trim()
    .split(/\s+/)
    .map((game) => game.split(/[/-]/).map(Number))
    .filter((game) => game.length === 2 && game.every(Number.isFinite));
}

function winnerGames(score, winner) {
  let home = 0;
  let away = 0;
  for (const [homeScore, awayScore] of gameScores(score)) {
    if (homeScore > awayScore) home += 1;
    else if (awayScore > homeScore) away += 1;
  }
  return winner === 'home' ? `${home}-${away}` : `${away}-${home}`;
}

function chooseRubber(rubbers, names, matches) {
  const ranked = [];
  for (const rubber of rubbers) {
    const home = names.get(nameKey(rubber.home_player));
    const away = names.get(nameKey(rubber.away_player));
    if (!home?.playerId || !away?.playerId) continue;
    const match = matches.find((row) => row.playedOn === rubber.playedOn && samePair(row, home.playerId, away.playerId));
    if (!match) continue;
    const homeIsPlayer = match.playerId === home.playerId;
    const homeBefore = homeIsPlayer ? match.playerLevelBefore : match.opponentLevelBefore;
    const awayBefore = homeIsPlayer ? match.opponentLevelBefore : match.playerLevelBefore;
    const homeAfter = homeIsPlayer ? match.playerLevelAfter : match.opponentLevelAfter;
    const awayAfter = homeIsPlayer ? match.opponentLevelAfter : match.playerLevelAfter;
    if (homeBefore === null || awayBefore === null) continue;
    const winnerBefore = rubber.winner === 'home' ? homeBefore : awayBefore;
    const loserBefore = rubber.winner === 'home' ? awayBefore : homeBefore;
    const levelGap = loserBefore - winnerBefore;
    ranked.push({
      rubber,
      homeBefore,
      awayBefore,
      homeAfter,
      awayAfter,
      gap: Math.abs(homeBefore - awayBefore) / Math.max(homeBefore, awayBefore, 1),
      levelGap,
      upset: winnerBefore < loserBefore,
    });
  }
  const significantUpsets = ranked.filter((row) => row.upset && (row.levelGap >= 200 || row.gap >= 0.12));
  if (significantUpsets.length) {
    significantUpsets.sort((left, right) => right.levelGap - left.levelGap || right.gap - left.gap);
    return significantUpsets[0];
  }
  ranked.sort((left, right) => left.gap - right.gap || Number(right.upset) - Number(left.upset));
  return ranked[0] ?? null;
}

/** One rubber from each division: an upset when there is one, otherwise the closest ratings. */
export function choicesByDivision(rubbers, names, matches) {
  const groups = new Map();
  for (const rubber of rubbers) {
    const division = rubber.division || 'the league';
    const group = groups.get(division) ?? [];
    group.push(rubber);
    groups.set(division, group);
  }
  return [...groups.entries()]
    .sort((left, right) => left[0].localeCompare(right[0], 'en-GB'))
    .map(([, group]) => chooseRubber(group, names, matches))
    .filter(Boolean);
}

function articleFrom(choice) {
  const { rubber, homeBefore, awayBefore, homeAfter, awayAfter, upset } = choice;
  const homeWon = rubber.winner === 'home';
  const winner = homeWon ? rubber.home_player : rubber.away_player;
  const loser = homeWon ? rubber.away_player : rubber.home_player;
  const winnerTeam = homeWon ? rubber.homeTeam : rubber.awayTeam;
  const loserTeam = homeWon ? rubber.awayTeam : rubber.homeTeam;
  const winnerBefore = homeWon ? homeBefore : awayBefore;
  const loserBefore = homeWon ? awayBefore : homeBefore;
  const games = winnerGames(rubber.score, rubber.winner);
  const points = gameScores(rubber.score).map(([home, away]) => `${home}-${away}`).join(', ');
  const when = longDate(rubber.playedOn);
  const title = `${winner} beat ${loser} in ${rubber.division}`;
  let summary = `${winner} (${winnerTeam}) beat ${loser} (${loserTeam}) ${games} on ${when}. SquashLevels had them at ${levelText(winnerBefore)} and ${levelText(loserBefore)} beforehand.`;
  if (summary.length > 280) {
    summary = `${winner} (${winnerTeam}) beat ${loser} (${loserTeam}) ${games} on ${when}.`;
  }
  const lines = [
    `${winner} beat ${loser} in ${rubber.division} of the ${rubber.season} on ${when}.`,
    '',
    `${winner} plays for ${winnerTeam} and ${loser} for ${loserTeam}. The games, with ${rubber.homeTeam} listed first, were ${points}. ${winner} won ${games}.`,
    '',
    `SquashLevels recorded ${rubber.home_player} at ${levelText(homeBefore)} and ${rubber.away_player} at ${levelText(awayBefore)} before the match.${
      homeAfter !== null && awayAfter !== null
        ? ` Afterwards those ratings were ${levelText(homeAfter)} and ${levelText(awayAfter)}.`
        : ''
    }`,
  ];
  if (upset) {
    lines.push('', `${winner} won from the lower SquashLevels rating.`);
  }
  if (rubber.homePoints !== null && rubber.awayPoints !== null) {
    lines.push('', `The fixture finished ${rubber.homeTeam} ${rubber.homePoints} points, ${rubber.awayTeam} ${rubber.awayPoints} points.`);
  }
  if (rubber.seasonId && rubber.divisionId && rubber.homeTeamId && rubber.fixtureId) {
    lines.push('', `The scorecard is on the [league tables](/leagues/results/#${rubber.seasonId}/${rubber.divisionId}/t${rubber.homeTeamId}/m${rubber.fixtureId}).`);
  }
  return {
    articleOn: rubber.playedOn,
    rubberId: rubber.id,
    slug: `${rubber.playedOn}-${divisionSlug(rubber.division)}`,
    title,
    summary,
    body: lines.join('\n'),
  };
}

function articleFacts(choice) {
  const { rubber, homeBefore, awayBefore, homeAfter, awayAfter, upset } = choice;
  const homeWon = rubber.winner === 'home';
  const winner = homeWon ? rubber.home_player : rubber.away_player;
  const loser = homeWon ? rubber.away_player : rubber.home_player;
  const games = winnerGames(rubber.score, rubber.winner);
  const points = gameScores(rubber.score).map(([home, away]) => `${home}-${away}`).join(', ');
  let scorecardLink = null;
  if (rubber.seasonId && rubber.divisionId && rubber.homeTeamId && rubber.fixtureId) {
    scorecardLink = `/leagues/results/#${rubber.seasonId}/${rubber.divisionId}/t${rubber.homeTeamId}/m${rubber.fixtureId}`;
  }
  return {
    date: rubber.playedOn,
    dateLong: longDate(rubber.playedOn),
    division: rubber.division,
    season: rubber.season,
    winner,
    loser,
    winnerTeam: homeWon ? rubber.homeTeam : rubber.awayTeam,
    loserTeam: homeWon ? rubber.awayTeam : rubber.homeTeam,
    gamesWon: games,
    gamePoints: points,
    homeTeam: rubber.homeTeam,
    awayTeam: rubber.awayTeam,
    squashLevelsBefore: { [rubber.home_player]: homeBefore, [rubber.away_player]: awayBefore },
    squashLevelsAfter:
      homeAfter !== null && awayAfter !== null
        ? { [rubber.home_player]: homeAfter, [rubber.away_player]: awayAfter }
        : null,
    upset: Boolean(upset),
    fixturePoints:
      rubber.homePoints !== null && rubber.awayPoints !== null
        ? { home: rubber.homePoints, away: rubber.awayPoints }
        : null,
    scorecardMarkdownLink: scorecardLink
      ? `[league tables](${scorecardLink})`
      : null,
  };
}

async function buildArticle(choice) {
  const template = articleFrom(choice);
  if (!process.env.NVIDIA_API_KEY?.trim()) {
    return { ...template, prose: 'template' };
  }
  try {
    const ai = await nvidiaArticle(articleFacts(choice), template);
    if (ai) {
      console.error('article prose: NVIDIA NIM');
      return { ...template, title: ai.title, summary: ai.summary, body: ai.body, prose: 'nvidia' };
    }
  } catch (error) {
    console.error(`NVIDIA article failed: ${error instanceof Error ? error.message : error}`);
  }
  console.error('article prose: template (fallback)');
  return { ...template, prose: 'template' };
}

/** Illustrated match scenes. An upset and a close match use different pictures, and the match date picks which one so the same scene is not used every day. */
const MATCH_PICTURES = {
  upset: [
    {
      image: '/uploads/news/league-upset.jpg',
      imageAlt: 'A player in orange plays a shot into the back corner while a player in navy watches.',
    },
    {
      image: '/uploads/news/league-nick.jpg',
      imageAlt: 'A player reaches down to the nick while the opponent waits on the T.',
    },
    {
      image: '/uploads/news/league-sidewall.jpg',
      imageAlt: 'A player hits a ball that has come off the side wall, with the opponent waiting behind.',
    },
  ],
  close: [
    {
      image: '/uploads/news/league-decider.jpg',
      imageAlt: 'Two players pause at the end of a long rally, the ball sitting in the back corner.',
    },
    {
      image: '/uploads/news/league-handshake.jpg',
      imageAlt: 'Two players shake hands at the end of a match, rackets still in hand.',
    },
    {
      image: '/uploads/news/league-drive.jpg',
      imageAlt: 'A player stretches for a low drive along the side wall.',
    },
  ],
};

/** Used on about one match day in ten, so the usual scenes stay the regular set. */
const OCCASIONAL_PICTURE = {
  image: '/uploads/news/league-boast.jpg',
  imageAlt: 'A player in orange stretches along the side wall for a boast, while a player in navy waits on the T.',
};

function pictureKind(article, choice) {
  const marked = String(article.body ?? '').match(/<!-- match-picture: (upset|close) -->/);
  if (marked) return marked[1];
  const text = `${article.title ?? ''}\n${article.summary ?? ''}\n${article.body ?? ''}`;
  const significant = choice
    ? Boolean(choice.upset && (choice.levelGap >= 200 || choice.gap >= 0.12))
    : /lower(?: SquashLevels)? rating/i.test(text);
  return significant ? 'upset' : 'close';
}

function matchPicture(article, choice) {
  if (article.image && article.imageAlt) return { image: article.image, imageAlt: article.imageAlt };
  const pool = MATCH_PICTURES[pictureKind(article, choice)];
  const day = Math.floor(Date.parse(`${article.articleOn}T00:00:00Z`) / 86400000);
  if (Number.isFinite(day) && Math.abs(day) % 10 === 0) return OCCASIONAL_PICTURE;
  const salt = [...String(article.slug ?? '')].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const index = Number.isFinite(day) ? Math.abs(day + salt) % pool.length : 0;
  return pool[index];
}

function divisionArticleExists(playedOn, division) {
  if (existsSync(join(NEWS_DIR, `${playedOn}-${divisionSlug(division)}.md`))) return true;
  const legacy = join(NEWS_DIR, `${playedOn}-league-match.md`);
  if (!existsSync(legacy)) return false;
  return readFileSync(legacy, 'utf8').includes(division);
}

function writeNews(article, choice) {
  mkdirSync(NEWS_DIR, { recursive: true });
  const path = join(NEWS_DIR, `${article.slug}.md`);
  if (existsSync(path)) return path;
  const picture = matchPicture(article, choice);
  const body = String(article.body ?? '').replace(/\n*<!-- match-picture: (?:upset|close) -->\s*$/, '').trimEnd();
  const markdown = `---
title: ${JSON.stringify(article.title)}
date: ${article.articleOn}
summary: ${JSON.stringify(article.summary)}
image: ${picture.image}
imageAlt: ${JSON.stringify(picture.imageAlt)}
category: ${article.category ?? 'leagues'}
${article.main ? 'main: true\n' : ''}featured: false
draft: false
---

${body}
`;
  writeFileSync(path, markdown);
  return path;
}

function seasonOpenerExists() {
  if (!existsSync(NEWS_DIR)) return false;
  return readdirSync(NEWS_DIR).some((name) => name.endsWith('-season-opens.md'));
}

function rubberSentence(rubber) {
  const winner = rubber.winner === 'home' ? rubber.home_player : rubber.away_player;
  const loser = rubber.winner === 'home' ? rubber.away_player : rubber.home_player;
  if (!winner || !loser) return null;
  if (rubber.winner !== 'home' && rubber.winner !== 'away') return null;
  if (/walkover/i.test(`${winner} ${loser}`)) return 'One rubber was a walkover.';
  const games = rubber.score ? winnerGames(rubber.score, rubber.winner) : '';
  return games ? `${winner} beat ${loser} ${games}.` : `${winner} beat ${loser}.`;
}

function seasonOpenerFrom(fixture, playedOn, seasonId) {
  const home = fixture.home?.name ?? 'The home team';
  const away = fixture.away?.name ?? 'The away team';
  const homePoints = fixture.home_points;
  const awayPoints = fixture.away_points;
  const drawn = homePoints === awayPoints;
  const winner = homePoints > awayPoints ? home : away;
  const loser = homePoints > awayPoints ? away : home;
  const division = fixture.division?.name ?? 'the league';
  const when = longDate(playedOn);
  const title = drawn
    ? `${home} and ${away} share the first Winter League result`
    : `${winner} take the first Winter League result`;
  let summary = drawn
    ? `${home} and ${away} drew ${homePoints}-${awayPoints} in ${division} on ${when}, the first result logged for ${SEASON_NAME}.`
    : `${winner} beat ${loser} ${homePoints > awayPoints ? homePoints : awayPoints}-${homePoints > awayPoints ? awayPoints : homePoints} in ${division} on ${when}, the first result logged for ${SEASON_NAME}.`;
  if (summary.length > 280) {
    summary = drawn
      ? `${home} and ${away} share the first logged result of ${SEASON_NAME}.`
      : `${winner} take the first logged result of ${SEASON_NAME}, beating ${loser}.`;
  }
  const rubbers = (fixture.rubbers ?? [])
    .slice()
    .sort((left, right) => (left.position ?? 0) - (right.position ?? 0))
    .map((rubber) => rubberSentence(rubber))
    .filter(Boolean);
  const scorecard = `/leagues/results/#${seasonId}/${fixture.division?.id ?? fixture.division_id}/t${fixture.home_team_id}/m${fixture.id}`;
  const lines = [
    `The ${SEASON_NAME} league has its first result on the books.`,
    '',
    `${home} played ${away} in ${division} on ${when}. The fixture finished ${home} ${homePoints}, ${away} ${awayPoints}.`,
    '',
    rubbers.length
      ? `The rubbers, with ${home} listed first: ${rubbers.join(' ')}`
      : 'The team score is in. The individual rubbers are not on the card yet.',
    '',
    `The scorecard is on the [league tables](${scorecard}).`,
  ];
  return {
    slug: `${playedOn}-season-opens`,
    title,
    summary,
    body: lines.join('\n'),
    articleOn: playedOn,
    category: 'leagues',
  };
}

async function writeSeasonOpener() {
  if (seasonOpenerExists()) return null;
  const seasons = await rest(`league_seasons?select=id&name=eq.${encodeURIComponent(SEASON_NAME)}`);
  const seasonId = seasons?.[0]?.id;
  if (!seasonId) return null;
  const divisions = await rest(`divisions?select=id&season_id=eq.${seasonId}`);
  const ids = (divisions ?? []).map((row) => row.id);
  if (!ids.length) return null;
  const select = [
    'id',
    'starts_at',
    'division_id',
    'home_team_id',
    'home_points',
    'away_points',
    'home:league_teams!fixtures_home_team_id_fkey(name)',
    'away:league_teams!fixtures_away_team_id_fkey(name)',
    'division:divisions(id,name)',
    'rubbers(position,home_player,away_player,score,winner)',
  ].join(',');
  const rows = await rest(
    `fixtures?select=${encodeURIComponent(select)}&status=eq.played&division_id=in.(${ids.join(',')})&home_points=not.is.null&order=starts_at.asc&limit=8`,
  );
  const fixture = (rows ?? []).find((row) => row.home_points !== null && row.away_points !== null);
  if (!fixture?.starts_at) return null;
  const playedOn = londonDate(new Date(fixture.starts_at));
  const path = writeNews(seasonOpenerFrom(fixture, playedOn, seasonId), { upset: false, levelGap: 0, gap: 0 });
  console.error(`season opener ${path}`);
  return { playedOn, division: fixture.division?.name ?? '' };
}

function leadingScores(rows) {
  const top = rows.find((row) => Number.isFinite(Number(row.score)) && row.name);
  if (!top) return [];
  const score = Number(top.score);
  const names = [];
  for (const row of rows) {
    if (Number(row.score) !== score) break;
    if (!names.some((leader) => leader.name === row.name)) names.push({ name: row.name, score });
  }
  return names;
}

function sameLeaders(left, right) {
  const key = (rows) => (rows ?? []).map((row) => `${row.name}:${row.score}`).sort().join('|');
  return key(left) === key(right);
}

function readMinigameTop() {
  if (!existsSync(MINIGAME_TOP)) return null;
  try {
    const saved = JSON.parse(readFileSync(MINIGAME_TOP, 'utf8'));
    return Array.isArray(saved.leaders) ? saved.leaders : null;
  } catch {
    return null;
  }
}

function writeMinigameTop(leaders) {
  mkdirSync(NEWS_DIR, { recursive: true });
  writeFileSync(MINIGAME_TOP, `${JSON.stringify({ leaders, recordedOn: londonDate(new Date()) }, null, 2)}\n`);
}

async function minigameLeaders() {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/minigame_leaderboard`, {
    method: 'POST',
    headers: {
      apikey: PUBLISHABLE_KEY,
      authorization: `Bearer ${PUBLISHABLE_KEY}`,
      'content-type': 'application/json',
    },
    body: '{}',
  });
  if (!response.ok) return [];
  const data = await response.json();
  return Array.isArray(data) ? data : [];
}

function minigameArticle(leaders, today) {
  const score = leaders[0].score;
  const names = leaders.map((row) => row.name);
  const who = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
  const plural = names.length > 1;
  const title = plural ? `${who} lead the Minigame mk3 board` : `${who} leads the Minigame mk3 board`;
  const summary = plural
    ? `${who} are level on ${score}, at the top of the Minigame mk3 board.`
    : `${who} scored ${score} on Minigame mk3 and leads the board.`;
  return {
    slug: `${today}-minigame-leader`,
    title,
    summary: summary.length > 280 ? `${who} ${plural ? 'lead' : 'leads'} Minigame mk3 with ${score}.` : summary,
    body: [
      `${who} ${plural ? 'have' : 'has'} the top score on [Minigame mk3](/minigame/), with ${score}.`,
      '',
      'The board beside the court shows the ten highest scores. A higher score takes the lead.',
    ].join('\n'),
    articleOn: today,
    category: 'website',
    main: true,
    image: '/uploads/news/minigame-mk3.jpg',
    imageAlt: 'A top-down Halloween squash court with orange lines, cobwebs, lanterns, a purple racket, and a ball in the air above its shadow.',
  };
}

async function writeMinigameLeader() {
  const leaders = leadingScores(await minigameLeaders());
  if (!leaders.length) return null;
  const previous = readMinigameTop();
  if (!previous) {
    writeMinigameTop(leaders);
    console.error(`minigame lead noted: ${leaders.map((row) => `${row.name} ${row.score}`).join(', ')}`);
    return null;
  }
  if (sameLeaders(previous, leaders)) return null;
  const previousScore = Math.max(...previous.map((row) => Number(row.score) || 0));
  if (leaders[0].score < previousScore) {
    writeMinigameTop(leaders);
    return null;
  }
  const today = londonDate(new Date());
  const path = writeNews(minigameArticle(leaders, today));
  writeMinigameTop(leaders);
  console.error(`minigame lead ${path}`);
  return path;
}

function quote(value) {
  if (value === null || value === undefined) return 'null';
  return `$$${String(value).replaceAll('$', '')}$$`;
}

function writeSql(payload) {
  const chunks = [];
  const statements = [];
  const push = (sql) => statements.push(sql);
  for (const player of payload.players) {
    push(
      `insert into public.squashlevels_players (id, display_name, current_level, confidence) values (${player.id}, ${quote(player.displayName)}, ${player.currentLevel ?? 'null'}, ${player.confidence ?? 'null'}) on conflict (id) do update set display_name = excluded.display_name, current_level = coalesce(excluded.current_level, public.squashlevels_players.current_level), confidence = coalesce(excluded.confidence, public.squashlevels_players.confidence), updated_at = now();`,
    );
  }
  for (const match of payload.matches) {
    push(
      `insert into public.squashlevels_matches (id, played_on, event_name, player_id, opponent_id, player_level_before, player_level_after, opponent_level_before, opponent_level_after, player_won, games_text, points_text) values (${quote(match.id)}, ${quote(match.playedOn)}::date, ${quote(match.eventName)}, ${match.playerId}, ${match.opponentId}, ${match.playerLevelBefore ?? 'null'}, ${match.playerLevelAfter ?? 'null'}, ${match.opponentLevelBefore ?? 'null'}, ${match.opponentLevelAfter ?? 'null'}, ${match.playerWon}, ${quote(match.gamesText)}, ${quote(match.pointsText)}) on conflict (id) do update set played_on = excluded.played_on, event_name = excluded.event_name, player_level_before = excluded.player_level_before, player_level_after = excluded.player_level_after, opponent_level_before = excluded.opponent_level_before, opponent_level_after = excluded.opponent_level_after, player_won = excluded.player_won, games_text = excluded.games_text, points_text = excluded.points_text;`,
    );
  }
  for (const rating of payload.ratings) {
    push(
      `insert into public.squashlevels_ratings (player_id, recorded_on, level, squashlevels_match_id, kind) values (${rating.playerId}, ${quote(rating.recordedOn)}::date, ${rating.level}, ${quote(rating.matchId)}, ${quote(rating.kind)}) on conflict (player_id, recorded_on, squashlevels_match_id, kind) do update set level = excluded.level;`,
    );
  }
  for (const name of payload.names) {
    push(
      `insert into public.squashlevels_names (name_key, player_id, status) values (${quote(name.nameKey)}, ${name.playerId ?? 'null'}, ${quote(name.status)}) on conflict (name_key) do update set player_id = excluded.player_id, status = excluded.status, updated_at = now();`,
    );
  }
  for (const article of payload.articles ?? []) {
    push(
      `insert into public.match_articles (article_on, rubber_id, slug, status, title, summary, body, published_at) values (${quote(article.articleOn)}::date, ${article.rubberId}, ${quote(article.slug)}, ${quote(article.status)}, ${quote(article.title)}, ${quote(article.summary)}, ${quote(article.body)}, ${article.status === 'published' ? 'now()' : 'null'}) on conflict (slug) do nothing;`,
    );
  }
  push(
    `insert into public.import_runs (source, summary) values ('squashlevels', ${quote(JSON.stringify(payload.summary))}::jsonb);`,
  );
  const size = 60;
  for (let index = 0; index < statements.length; index += size) {
    const path = join(tmpdir(), `sl-chunk-${String(chunks.length).padStart(2, '0')}.sql`);
    writeFileSync(path, statements.slice(index, index + size).join('\n'));
    chunks.push(path);
  }
  return chunks;
}

async function save(payload) {
  if (!canWrite) return writeSql(payload);
  const batches = async (table, rows, conflict) => {
    for (let index = 0; index < rows.length; index += 200) {
      await rest(`${table}?on_conflict=${conflict}`, { method: 'POST', write: true, body: rows.slice(index, index + 200) });
    }
  };
  const playerRows = (player) => ({
    id: player.id,
    display_name: player.displayName,
    current_level: player.currentLevel,
    confidence: player.confidence,
    updated_at: new Date().toISOString(),
  });
  await batches(
    'squashlevels_players',
    payload.players.filter((player) => player.currentLevel != null).map(playerRows),
    'id',
  );
  for (let index = 0; index < payload.players.length; index += 200) {
    const stubs = payload.players.slice(index, index + 200).filter((player) => player.currentLevel == null).map(playerRows);
    if (stubs.length) {
      await rest('squashlevels_players?on_conflict=id', {
        method: 'POST',
        write: true,
        prefer: 'resolution=ignore-duplicates,return=minimal',
        body: stubs,
      });
    }
  }
  await batches('squashlevels_matches', payload.matches.map((match) => ({
    id: match.id,
    played_on: match.playedOn,
    event_name: match.eventName,
    player_id: match.playerId,
    opponent_id: match.opponentId,
    player_level_before: match.playerLevelBefore,
    player_level_after: match.playerLevelAfter,
    opponent_level_before: match.opponentLevelBefore,
    opponent_level_after: match.opponentLevelAfter,
    player_won: match.playerWon,
    games_text: match.gamesText,
    points_text: match.pointsText,
  })), 'id');
  await batches('squashlevels_ratings', payload.ratings.map((rating) => ({
    player_id: rating.playerId,
    recorded_on: rating.recordedOn,
    level: rating.level,
    squashlevels_match_id: rating.matchId,
    kind: rating.kind,
  })), 'player_id,recorded_on,squashlevels_match_id,kind');
  await batches('squashlevels_names', payload.names.map((name) => ({
    name_key: name.nameKey,
    player_id: name.playerId,
    status: name.status,
    updated_at: new Date().toISOString(),
  })), 'name_key');
  for (const article of payload.articles ?? []) {
    await rest('match_articles?on_conflict=slug', {
      method: 'POST',
      write: true,
      prefer: 'resolution=ignore-duplicates,return=minimal',
      body: [{
        article_on: article.articleOn,
        rubber_id: article.rubberId,
        slug: article.slug,
        status: article.status,
        title: article.title,
        summary: article.summary,
        body: article.body,
        published_at: article.status === 'published' ? new Date().toISOString() : null,
      }],
    });
  }
  await rest('import_runs', {
    method: 'POST',
    write: true,
    body: [{ source: 'squashlevels', summary: payload.summary }],
  });
  return [];
}

async function publishApproved() {
  if (!canWrite) return;
  const rows = await rest('match_articles?status=eq.approved&select=id,slug,title,summary,body,article_on');
  for (const row of rows ?? []) {
    writeNews({
      slug: row.slug,
      title: row.title,
      summary: row.summary,
      body: row.body,
      articleOn: row.article_on,
    });
    await rest(`match_articles?id=eq.${row.id}`, {
      method: 'PATCH',
      write: true,
      body: { status: 'published', published_at: new Date().toISOString() },
    });
    console.error(`published approved article ${row.slug}`);
  }
}

async function exceptions() {
  if (!canWrite) throw new Error('Exception lookup needs SUPABASE_SERVICE_ROLE_KEY.');
  await signIn();
  const nominations = await restAll('nominations?select=player_name,season,team_id');
  const season = [...new Set(nominations.map((row) => row.season).filter(Boolean))].sort().at(-1) ?? '';
  const teams = await restAll('teams?select=id,name');
  const teamName = new Map(teams.map((team) => [team.id, team.name]));
  const people = new Map();
  const consider = (name, team) => {
    const key = nameKey(name ?? '');
    if (!key.includes(' ') || key.includes('walkover')) return;
    if (!people.has(key)) people.set(key, { name: String(name).trim(), team: team || '' });
  };
  for (const row of nominations) {
    if (row.season !== season) continue;
    consider(row.player_name, teamName.get(row.team_id) ?? '');
  }
  const squads = await restAll('captain_squads?select=name,squad_players(display_name)');
  for (const squad of squads) {
    const members = Array.isArray(squad.squad_players) ? squad.squad_players : [];
    for (const player of members) consider(player.display_name, squad.name ?? '');
  }

  const knownNames = new Map();
  for (const row of await restAll('squashlevels_names?select=name_key,player_id,status')) {
    knownNames.set(row.name_key, { status: row.status, playerId: row.player_id });
  }
  const stored = await restAll('squashlevels_players?select=id,display_name,current_level');
  const knownIds = new Set(stored.filter((player) => player.current_level != null).map((player) => player.id));
  const covered = new Set(stored.filter((player) => player.current_level != null).map((player) => nameKey(player.display_name)));
  const wanted = [...people.values()].filter((person) => {
    const key = nameKey(person.name);
    const known = knownNames.get(key);
    if (covered.has(key)) return false;
    if (known?.status === 'matched' && known.playerId && knownIds.has(known.playerId)) return false;
    return true;
  });
  console.error(`${season || 'current'} names still to find: ${wanted.length} of ${people.size}`);

  const players = new Map();
  const matches = new Map();
  let searches = 0;
  for (const person of wanted) {
    const key = nameKey(person.name);
    let found = await searchPlayer(person.name, person.team);
    searches += 1;
    if (found.status === 'missing') {
      const alias = person.name.replace(/^Daniel\b/i, 'Dan');
      if (alias !== person.name) {
        found = await searchPlayer(alias, person.team);
        searches += 1;
        await pause();
      }
    }
    knownNames.set(key, found);
    const nearby = found.nearby?.length ? ` nearby ${found.nearby.join(', ')}` : '';
    console.error(
      `${found.status} ${person.name}${found.playerId ? ` ${found.playerId}` : ''}${found.via === 'site' ? ' via current search' : ''}${nearby}`,
    );
    if (found.playerId && knownIds.has(found.playerId)) {
      console.error(`already stored ${person.name} ${found.playerId}`);
    } else if (found.playerId && !players.has(found.playerId)) {
      let page;
      try {
        page = parsePlayerPage(await sl(`player_detail?player=${found.playerId}&show=last12m`), found.playerId);
      } catch (error) {
        console.error(`skipped ${person.name} ${found.playerId}: ${error.message}`);
        await pause();
        continue;
      }
      if (!page.displayName) {
        console.error(`no name for ${person.name} ${found.playerId}`);
        knownNames.set(key, { status: 'missing', playerId: null, displayName: null });
      } else if (!page.currentLevel) {
        console.error(`no level yet for ${page.displayName} ${found.playerId}`);
        players.set(found.playerId, {
          id: found.playerId,
          displayName: page.displayName,
          currentLevel: null,
          confidence: null,
        });
        knownNames.set(key, { status: 'matched', playerId: found.playerId, displayName: page.displayName });
        knownNames.set(nameKey(page.displayName), { status: 'matched', playerId: found.playerId, displayName: page.displayName });
      } else {
        players.set(found.playerId, {
          id: found.playerId,
          displayName: page.displayName,
          currentLevel: page.currentLevel,
          confidence: page.confidence,
        });
        knownNames.set(nameKey(page.displayName), { status: 'matched', playerId: found.playerId });
        for (const match of page.matches) {
          matches.set(match.id, match);
          if (match.opponentId && match.opponentName && !players.has(match.opponentId) && !knownIds.has(match.opponentId)) {
            players.set(match.opponentId, {
              id: match.opponentId,
              displayName: match.opponentName,
              currentLevel: null,
              confidence: null,
            });
          }
        }
        console.error(`${page.displayName} ${page.currentLevel}`);
      }
    }
    await pause();
  }

  const nameRows = [];
  const seen = new Set();
  const addName = (key, playerId, status) => {
    if (!key || seen.has(key)) return;
    seen.add(key);
    nameRows.push({ nameKey: key, playerId, status });
  };
  for (const person of wanted) {
    const value = knownNames.get(nameKey(person.name));
    if (!value?.status) continue;
    const playerId = value.playerId && (knownIds.has(value.playerId) || players.has(value.playerId)) ? value.playerId : null;
    addName(nameKey(person.name), playerId, playerId ? value.status : value.status === 'ambiguous' ? 'ambiguous' : 'missing');
  }
  for (const player of players.values()) {
    if (player.currentLevel == null) continue;
    addName(nameKey(player.displayName), player.id, 'matched');
  }
  await save({
    players: [...players.values()],
    matches: [...matches.values()],
    ratings: ratingsFor(players, matches),
    names: nameRows,
    article: null,
    summary: { exceptions: true, season, wanted: wanted.length, found: [...players.values()].filter((player) => player.currentLevel != null).length, searches },
  });
  console.error(JSON.stringify({ exceptions: true, season, wanted: wanted.length, found: nameRows.filter((row) => row.status === 'matched').length, searches }));
}

async function main() {
  if (wantBackfill) {
    await backfill();
    return;
  }
  if (wantExceptions) {
    await exceptions();
    return;
  }
  await publishApproved();
  let opener = null;
  try {
    opener = await writeSeasonOpener();
  } catch (error) {
    console.error(`season opener skipped: ${error instanceof Error ? error.message : error}`);
  }
  try {
    await writeMinigameLeader();
  } catch (error) {
    console.error(`minigame lead skipped: ${error instanceof Error ? error.message : error}`);
  }
  const days = await leagueDays();
  if (!days.length) {
    console.error('No scored rubbers to read.');
    return;
  }
  const yesterday = londonDate(new Date(Date.now() - 24 * 60 * 60 * 1000));
  const playedOn = wantDate ?? (wantLatest ? days[0][0] : yesterday);
  const rubbers = days.find(([date]) => date === playedOn)?.[1] ?? [];
  if (!rubbers.length) {
    console.error(`No player matches on ${playedOn}. No article.`);
    return;
  }

  await signIn();
  const names = new Map();
  const known = canWrite
    ? await rest('squashlevels_names?select=name_key,player_id,status')
    : [];
  for (const row of known ?? []) {
    names.set(row.name_key, { status: row.status, playerId: row.player_id, displayName: null });
  }

  const teamFor = new Map();
  for (const rubber of rubbers) {
    teamFor.set(nameKey(rubber.home_player), rubber.homeTeam);
    teamFor.set(nameKey(rubber.away_player), rubber.awayTeam);
  }
  const wanted = [...new Set(rubbers.flatMap((rubber) => [rubber.home_player, rubber.away_player]))];
  let searches = 0;
  for (const name of wanted) {
    const key = nameKey(name);
    if (!key.includes(' ')) continue;
    if (names.has(key)) continue;
    if (searches >= SEARCH_LIMIT) break;
    searches += 1;
    let found = await searchPlayer(name, teamFor.get(key));
    if (found.status === 'missing') {
      const alias = name.replace(/^Daniel\b/i, 'Dan');
      if (alias !== name && searches < SEARCH_LIMIT) {
        searches += 1;
        found = await searchPlayer(alias, teamFor.get(key));
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
    }
    names.set(key, found);
    console.error(`${found.status} ${name}${found.playerId ? ` ${found.playerId}` : ''}`);
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  const players = new Map();
  const matches = new Map();
  const today = londonDate(new Date());
  const ids = [...new Set([...names.values()].map((row) => row.playerId).filter(Boolean))];
  for (const playerId of ids) {
    const html = await sl(`player_detail?player=${playerId}&show=last12m`);
    const page = parsePlayerPage(html, playerId);
    if (!page.displayName || !page.currentLevel) {
      console.error(`no level for ${playerId}`);
      continue;
    }
    players.set(playerId, {
      id: playerId,
      displayName: page.displayName,
      currentLevel: page.currentLevel,
      confidence: page.confidence,
    });
    for (const match of page.matches) {
      matches.set(match.id, match);
      if (match.opponentId && match.opponentName && !players.has(match.opponentId)) {
        players.set(match.opponentId, {
          id: match.opponentId,
          displayName: match.opponentName,
          currentLevel: null,
          confidence: null,
        });
      }
    }
    console.error(`${page.displayName} ${page.currentLevel} (${page.matches.length} matches)`);
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  const ratings = [];
  for (const match of matches.values()) {
    for (const side of [
      [match.playerId, match.playerLevelBefore, match.playerLevelAfter],
      [match.opponentId, match.opponentLevelBefore, match.opponentLevelAfter],
    ]) {
      const [playerId, before, after] = side;
      if (!players.has(playerId)) continue;
      if (before !== null) ratings.push({ playerId, recordedOn: match.playedOn, level: before, matchId: match.id, kind: 'before' });
      if (after !== null) ratings.push({ playerId, recordedOn: match.playedOn, level: after, matchId: match.id, kind: 'after' });
    }
  }
  for (const player of players.values()) {
    if (player.currentLevel === null) continue;
    const kindRank = { before: 0, after: 1, snapshot: 2 };
    const latest = ratings
      .filter((rating) => rating.playerId === player.id)
      .sort((left, right) => right.recordedOn.localeCompare(left.recordedOn) || kindRank[right.kind] - kindRank[left.kind])[0];
    if (latest && latest.level === player.currentLevel) continue;
    ratings.push({ playerId: player.id, recordedOn: today, level: player.currentLevel, matchId: '', kind: 'snapshot' });
  }

  let mode = 'auto';
  if (canWrite) {
    const settings = await rest('article_settings?id=eq.1&select=publication_mode');
    mode = settings?.[0]?.publication_mode ?? 'auto';
  }
  const articles = [];
  const choices = choicesByDivision(rubbers, names, [...matches.values()]);
  if (!choices.length) {
    console.error(`No close match with ratings on ${playedOn}. No article.`);
  }
  for (const choice of choices) {
    const division = choice.rubber.division || 'the league';
    if (opener?.playedOn === playedOn && opener.division === division) {
      console.error(`Season opening article covers ${division} on ${playedOn}.`);
      continue;
    }
    if (divisionArticleExists(playedOn, division)) {
      console.error(`Article already exists for ${division} on ${playedOn}.`);
      continue;
    }
    const draft = await buildArticle(choice);
    const { prose, ...articleFields } = draft;
    const article = { ...articleFields, status: mode === 'manual' ? 'held' : 'published', prose };
    const kind = pictureKind(article, choice);
    if (!String(article.body).includes('match-picture:')) {
      article.body = `${String(article.body).trimEnd()}\n\n<!-- match-picture: ${kind} -->`;
    }
    if (article.status === 'published') console.error(`wrote ${writeNews(article, choice)}`);
    else console.error(`held article for ${division} on ${playedOn}; publishing is manual`);
    articles.push(article);
  }

  const payload = {
    players: [...players.values()],
    matches: [...matches.values()],
    ratings,
    names: [...names.entries()].map(([key, value]) => ({
      nameKey: key,
      playerId: value.playerId,
      status: value.status,
    })),
    articles,
    summary: {
      playedOn,
      searches,
      players: players.size,
      matches: matches.size,
      ratings: ratings.length,
      articles: articles.map((article) => article.slug),
      mode,
    },
  };
  const chunks = await save(payload);
  console.error(JSON.stringify(payload.summary));
  if (chunks.length) console.error(chunks.join('\n'));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'SquashLevels sync failed');
    process.exit(1);
  });
}
