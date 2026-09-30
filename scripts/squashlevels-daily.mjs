/**
 * Read SquashLevels with the premium account, store rating history, and
 * prepare at most one league match article for a day on which somebody played.
 *
 * Usage:
 *   node scripts/squashlevels-daily.mjs            # yesterday in London
 *   node scripts/squashlevels-daily.mjs --latest   # most recent day with a result
 *   node scripts/squashlevels-daily.mjs --date 2026-08-11
 *
 * Writes need SUPABASE_SERVICE_ROLE_KEY. Without it, SQL is written to the
 * temp directory and a news file is still written when publishing is automatic.
 * Sign-in uses SQUASHLEVELS_EMAIL and SQUASHLEVELS_PASSWORD from the environment
 * or from .env. Those values are never printed.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const NEWS_DIR = join(ROOT, 'src', 'content', 'news');
const SL_BASE = 'https://api-leveltech.squashlevels.com/api/classic/';
const SUPABASE_URL = 'https://klxyjmwiaivvqjbhxzak.supabase.co';
const PUBLISHABLE_KEY = 'sb_publishable_wcOU09VyQcF7JWoZ6i-PHg_pFp6UM-4';
const SEARCH_LIMIT = 24;

loadEnv();

const args = process.argv.slice(2);
const wantLatest = args.includes('--latest');
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

async function rest(path, { method = 'GET', body, write = false } = {}) {
  const key = write ? process.env.SUPABASE_SERVICE_ROLE_KEY : process.env.SUPABASE_SERVICE_ROLE_KEY || PUBLISHABLE_KEY;
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      'content-type': 'application/json',
      ...(method === 'GET' ? {} : { prefer: 'resolution=merge-duplicates,return=minimal' }),
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
  const html = await sl(`players?search=${encodeURIComponent(name)}`);
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
  if (chosen.length === 1) return { status: 'matched', playerId: chosen[0].id, displayName: chosen[0].name };
  if (unique.length > 1) return { status: 'ambiguous', playerId: null, displayName: null };
  return { status: 'missing', playerId: null, displayName: null };
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
    ranked.push({
      rubber,
      homeBefore,
      awayBefore,
      homeAfter,
      awayAfter,
      gap: Math.abs(homeBefore - awayBefore) / Math.max(homeBefore, awayBefore, 1),
      upset: winnerBefore < loserBefore,
    });
  }
  ranked.sort((left, right) => left.gap - right.gap || Number(right.upset) - Number(left.upset));
  return ranked[0] ?? null;
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
    slug: `${rubber.playedOn}-league-match`,
    title,
    summary,
    body: lines.join('\n'),
  };
}

function writeNews(article) {
  mkdirSync(NEWS_DIR, { recursive: true });
  const path = join(NEWS_DIR, `${article.slug}.md`);
  if (existsSync(path)) return path;
  const markdown = `---
title: ${JSON.stringify(article.title)}
date: ${article.articleOn}
summary: ${JSON.stringify(article.summary)}
category: leagues
featured: false
draft: false
---

${article.body}
`;
  writeFileSync(path, markdown);
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
  if (payload.article) {
    const article = payload.article;
    push(
      `insert into public.match_articles (article_on, rubber_id, slug, status, title, summary, body, published_at) values (${quote(article.articleOn)}::date, ${article.rubberId}, ${quote(article.slug)}, ${quote(article.status)}, ${quote(article.title)}, ${quote(article.summary)}, ${quote(article.body)}, ${article.status === 'published' ? 'now()' : 'null'}) on conflict (article_on) do nothing;`,
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
  await batches(
    'squashlevels_players',
    payload.players.map((player) => ({
      id: player.id,
      display_name: player.displayName,
      current_level: player.currentLevel,
      confidence: player.confidence,
      updated_at: new Date().toISOString(),
    })),
    'id',
  );
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
  if (payload.article) {
    await rest('match_articles?on_conflict=article_on', {
      method: 'POST',
      write: true,
      body: [{
        article_on: payload.article.articleOn,
        rubber_id: payload.article.rubberId,
        slug: payload.article.slug,
        status: payload.article.status,
        title: payload.article.title,
        summary: payload.article.summary,
        body: payload.article.body,
        published_at: payload.article.status === 'published' ? new Date().toISOString() : null,
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

async function main() {
  const days = await leagueDays();
  if (!days.length) {
    console.error('No scored rubbers to read.');
    return;
  }
  const yesterday = londonDate(new Date(Date.now() - 24 * 60 * 60 * 1000));
  const playedOn = wantDate ?? (wantLatest ? days[0][0] : yesterday);
  const rubbers = days.find(([date]) => date === playedOn)?.[1] ?? [];
  await publishApproved();
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
  const existingFile = existsSync(join(NEWS_DIR, `${playedOn}-league-match.md`));
  const choice = chooseRubber(rubbers, names, [...matches.values()]);
  let article = null;
  if (!choice) {
    console.error(`No close match with ratings on ${playedOn}. No article.`);
  } else {
    article = { ...articleFrom(choice), status: mode === 'manual' ? 'held' : 'published' };
    if (article.status === 'published' && !existingFile) {
      console.error(`wrote ${writeNews(article)}`);
    } else if (article.status === 'published') {
      console.error(`Article file already exists for ${playedOn}.`);
    } else {
      console.error(`held article for ${playedOn}; publishing is manual`);
    }
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
    article,
    summary: {
      playedOn,
      searches,
      players: players.size,
      matches: matches.size,
      ratings: ratings.length,
      article: article?.slug ?? null,
      mode,
    },
  };
  const chunks = await save(payload);
  console.error(JSON.stringify(payload.summary));
  if (chunks.length) console.error(chunks.join('\n'));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'SquashLevels sync failed');
  process.exit(1);
});
