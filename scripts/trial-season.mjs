/**
 * Creates or removes one made-up winter season for a local look-through.
 * Does not send email and does not publish match articles.
 *
 *   node scripts/trial-season.mjs
 *   node scripts/trial-season.mjs --cleanup
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const SEASON_NAME = 'Winter Trial 2026';
const RECORD_PATH = new URL('./.trial-season.json', import.meta.url);
const PASSWORD = 'Trial-Season-2026!';

const CLUBS = [
  { slug: 'trial-north', name: 'North Trial' },
  { slug: 'trial-south', name: 'South Trial' },
];

const TEAM_DEFS = [
  { key: 'n1', club: 'trial-north', name: 'North Trial 1', rank: 4 },
  { key: 's1', club: 'trial-south', name: 'South Trial 1', rank: 3 },
  { key: 'n2', club: 'trial-north', name: 'North Trial 2', rank: 2 },
  { key: 's2', club: 'trial-south', name: 'South Trial 2', rank: 1 },
];

const FIRST = ['Morgan', 'Riley', 'Casey', 'Jordan', 'Avery', 'Quinn', 'Rowan', 'Eden', 'Harper', 'Sage'];
const LAST = ['Hale', 'Brooks', 'Keene', 'Adler', 'Moss', 'Vale', 'Pryor', 'Ellison', 'Crowe', 'Dalton'];

function loadEnv() {
  const env = {};
  for (const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split(/\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match) continue;
    env[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, '');
  }
  return env;
}

function fail(error, label) {
  const message = error?.message || String(error);
  throw new Error(`${label}: ${message}`);
}

function playerName(teamIndex, playerIndex) {
  return `${FIRST[(teamIndex * 3 + playerIndex) % FIRST.length]} ${LAST[(teamIndex * 2 + playerIndex) % LAST.length]}`;
}

function rubberScore(homeWinsRubber) {
  const games = homeWinsRubber
    ? ['11/6', '11/8', '7/11', '11/9']
    : ['6/11', '11/8', '8/11', '4/11'];
  return {
    score: games.join(' '),
    homeGames: games.filter((game) => {
      const [left, right] = game.split('/').map(Number);
      return left > right;
    }).length,
    awayGames: games.filter((game) => {
      const [left, right] = game.split('/').map(Number);
      return right > left;
    }).length,
  };
}

function pairings() {
  const rows = [];
  for (let home = 0; home < TEAM_DEFS.length; home += 1) {
    for (let away = 0; away < TEAM_DEFS.length; away += 1) {
      if (home !== away) rows.push([home, away]);
    }
  }
  return rows;
}

async function listTrialUsers(admin) {
  const found = [];
  for (let page = 1; page < 20; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) fail(error, 'list users');
    const batch = data.users ?? [];
    found.push(...batch.filter((user) => user.email?.startsWith('trial.') && user.email.endsWith('@example.test')));
    if (batch.length < 200) break;
  }
  return found;
}

async function cleanup(admin) {
  const { data: seasons, error: seasonError } = await admin.from('league_seasons').select('id').eq('name', SEASON_NAME);
  if (seasonError) fail(seasonError, 'find season');
  const seasonIds = (seasons ?? []).map((row) => row.id);
  if (seasonIds.length) {
    const { data: divisions, error: divisionError } = await admin.from('divisions').select('id').in('season_id', seasonIds);
    if (divisionError) fail(divisionError, 'find divisions');
    const divisionIds = (divisions ?? []).map((row) => row.id);
    if (divisionIds.length) {
      const { data: fixtures, error: fixtureError } = await admin.from('fixtures').select('id').in('division_id', divisionIds);
      if (fixtureError) fail(fixtureError, 'find fixtures');
      const fixtureIds = (fixtures ?? []).map((row) => row.id);
      if (fixtureIds.length) {
        const { error } = await admin.from('rubbers').delete().in('fixture_id', fixtureIds);
        if (error) fail(error, 'delete rubbers');
        const { error: availError } = await admin.from('availability').delete().in('fixture_id', fixtureIds);
        if (availError) fail(availError, 'delete availability');
        const { error: selError } = await admin.from('selections').delete().in('fixture_id', fixtureIds);
        if (selError) fail(selError, 'delete selections');
        const { error: fxError } = await admin.from('fixtures').delete().in('id', fixtureIds);
        if (fxError) fail(fxError, 'delete fixtures');
      }
      const { error: teamError } = await admin.from('league_teams').delete().in('division_id', divisionIds);
      if (teamError) fail(teamError, 'delete league teams');
      const { error: divError } = await admin.from('divisions').delete().in('id', divisionIds);
      if (divError) fail(divError, 'delete divisions');
    }
    const { error } = await admin.from('league_seasons').delete().in('id', seasonIds);
    if (error) fail(error, 'delete season');
  }

  const { data: clubs, error: clubError } = await admin.from('clubs').select('slug').like('slug', 'trial-%');
  if (clubError) fail(clubError, 'find clubs');
  const slugs = (clubs ?? []).map((row) => row.slug);
  if (slugs.length) {
    const { data: orgTeams, error: orgError } = await admin.from('teams').select('id').in('club_slug', slugs);
    if (orgError) fail(orgError, 'find teams');
    const teamIds = (orgTeams ?? []).map((row) => row.id);
    if (teamIds.length) {
      const { data: squads, error: squadError } = await admin.from('captain_squads').select('id').in('team_id', teamIds);
      if (squadError) fail(squadError, 'find squads');
      const squadIds = (squads ?? []).map((row) => row.id);
      if (squadIds.length) {
        const { error } = await admin.from('squad_players').delete().in('squad_id', squadIds);
        if (error) fail(error, 'delete squad players');
        const { error: squadDel } = await admin.from('captain_squads').delete().in('id', squadIds);
        if (squadDel) fail(squadDel, 'delete squads');
      }
      const { error: nomError } = await admin.from('nominations').delete().in('team_id', teamIds);
      if (nomError && nomError.code !== 'PGRST204') fail(nomError, 'delete nominations');
      const { error: memberError } = await admin.from('memberships').delete().in('team_id', teamIds);
      if (memberError) fail(memberError, 'delete team memberships');
      const { error: orgDel } = await admin.from('teams').delete().in('id', teamIds);
      if (orgDel) fail(orgDel, 'delete teams');
    }
    const { error: clubMemberError } = await admin.from('memberships').delete().in('club_slug', slugs);
    if (clubMemberError) fail(clubMemberError, 'delete club memberships');
    const { error: clubDel } = await admin.from('clubs').delete().in('slug', slugs);
    if (clubDel) fail(clubDel, 'delete clubs');
  }

  const users = await listTrialUsers(admin);
  for (const user of users) {
    const { error } = await admin.auth.admin.deleteUser(user.id);
    if (error) fail(error, `delete user ${user.email}`);
  }
  console.log(`Removed trial season, ${users.length} accounts, and the trial clubs.`);
}

async function createSeason(admin) {
  await cleanup(admin);

  for (const club of CLUBS) {
    const { error } = await admin.from('clubs').insert({
      slug: club.slug,
      name: club.name,
      contact_name: `${club.name} captain`,
      contact_email: `trial.club.${club.slug}@example.test`,
    });
    if (error) fail(error, `club ${club.name}`);
  }

  const teams = [];
  for (const def of TEAM_DEFS) {
    const captainName = playerName(TEAM_DEFS.indexOf(def), 0);
    const { data, error } = await admin
      .from('teams')
      .insert({
        club_slug: def.club,
        name: def.name,
        division: 'Trial division',
        captain_name: captainName,
        captain_email: `trial.${def.key}.captain@example.test`,
        last_season: SEASON_NAME,
      })
      .select('id')
      .single();
    if (error) fail(error, `team ${def.name}`);
    teams.push({ ...def, id: data.id, captainName });
  }

  const accounts = [];
  async function makeUser(email, displayName, role, extra) {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { display_name: displayName },
    });
    if (error) fail(error, `account ${email}`);
    const id = data.user.id;
    const profile = { display_name: displayName, email, is_admin: false };
    const { data: updated, error: updateError } = await admin.from('profiles').update(profile).eq('id', id).select('id');
    if (updateError) fail(updateError, `profile ${email}`);
    if (!updated?.length) {
      const { error: insertError } = await admin.from('profiles').insert({ id, ...profile });
      if (insertError) fail(insertError, `profile insert ${email}`);
    }
    const membership = { profile_id: id, role, ...extra };
    const { error: memberError } = await admin.from('memberships').insert(membership);
    if (memberError) fail(memberError, `membership ${email}`);
    accounts.push({ email, displayName, role, id });
    return id;
  }

  for (const club of CLUBS) {
    await makeUser(`trial.club.${club.slug}@example.test`, `${club.name} captain`, 'club_captain', { club_slug: club.slug });
  }

  const squads = [];
  for (const [teamIndex, team] of teams.entries()) {
    const players = [];
    for (let playerIndex = 0; playerIndex < 5; playerIndex += 1) {
      const name = playerIndex === 0 ? team.captainName : playerName(teamIndex, playerIndex);
      const email = playerIndex === 0 ? `trial.${team.key}.captain@example.test` : `trial.${team.key}.p${playerIndex}@example.test`;
      const role = playerIndex === 0 ? 'team_captain' : 'team_player';
      const userId = await makeUser(email, name, role, { team_id: team.id });
      players.push({ name, email, userId, position: playerIndex + 1 });
    }
    const captain = players[0];
    const { data: squad, error: squadError } = await admin
      .from('captain_squads')
      .insert({
        name: team.name,
        captain_email: captain.email,
        captain_id: captain.userId,
        team_id: team.id,
      })
      .select('id')
      .single();
    if (squadError) fail(squadError, `squad ${team.name}`);
    const squadPlayers = [];
    for (const player of players) {
      const { data, error } = await admin
        .from('squad_players')
        .insert({ squad_id: squad.id, display_name: player.name, email: player.email })
        .select('id')
        .single();
      if (error) fail(error, `player ${player.name}`);
      squadPlayers.push({ ...player, id: data.id });
    }
    squads.push({ ...team, squadId: squad.id, players: squadPlayers });
  }

  const { data: season, error: seasonError } = await admin
    .from('league_seasons')
    .insert({ name: SEASON_NAME, starts_on: '2026-09-01', ends_on: '2027-03-31' })
    .select('id')
    .single();
  if (seasonError) fail(seasonError, 'season');

  const { data: division, error: divisionError } = await admin
    .from('divisions')
    .insert({ season_id: season.id, name: 'Trial division', scoring: 'PAR to 11' })
    .select('id')
    .single();
  if (divisionError) fail(divisionError, 'division');

  for (const squad of squads) {
    const { data, error } = await admin
      .from('league_teams')
      .insert({
        division_id: division.id,
        club_slug: squad.club,
        name: squad.name,
        team_id: squad.id,
      })
      .select('id')
      .single();
    if (error) fail(error, `league team ${squad.name}`);
    squad.leagueTeamId = data.id;
  }

  const fixtures = [];
  const dates = pairings();
  for (const [index, [homeIndex, awayIndex]] of dates.entries()) {
    const day = String(1 + index * 2).padStart(2, '0');
    const home = squads[homeIndex];
    const away = squads[awayIndex];
    const homeRubbers = Math.min(4, Math.max(1, 3 + (home.rank - away.rank)));
    let homeGames = 0;
    let awayGames = 0;
    const rubbers = [];
    for (let string = 0; string < 5; string += 1) {
      const homeWon = string < homeRubbers;
      const scored = rubberScore(homeWon);
      homeGames += scored.homeGames;
      awayGames += scored.awayGames;
      rubbers.push({
        position: string + 1,
        home_player: home.players[string].name,
        away_player: away.players[string].name,
        score: scored.score,
        winner: homeWon ? 'home' : 'away',
      });
    }
    const startsAt = `2026-09-${day}T18:00:00.000Z`;
    const { data: fixture, error } = await admin
      .from('fixtures')
      .insert({
        division_id: division.id,
        home_team_id: home.leagueTeamId,
        away_team_id: away.leagueTeamId,
        starts_at: startsAt,
        status: 'played',
        home_points: homeRubbers,
        away_points: 5 - homeRubbers,
        home_games: homeGames,
        away_games: awayGames,
      })
      .select('id')
      .single();
    if (error) fail(error, `fixture ${home.name} v ${away.name}`);
    const { error: rubberError } = await admin.from('rubbers').insert(rubbers.map((rubber) => ({ ...rubber, fixture_id: fixture.id })));
    if (rubberError) fail(rubberError, `rubbers ${home.name} v ${away.name}`);

    const availability = [];
    const selections = [];
    for (const side of [home, away]) {
      for (const player of side.players) {
        availability.push({
          fixture_id: fixture.id,
          squad_player_id: player.id,
          status: 'in',
          set_by: player.userId,
        });
        selections.push({
          fixture_id: fixture.id,
          squad_id: side.squadId,
          squad_player_id: player.id,
          position: player.position,
        });
      }
    }
    const { error: availError } = await admin.from('availability').insert(availability);
    if (availError) fail(availError, 'availability');
    const { error: selError } = await admin.from('selections').insert(selections);
    if (selError) fail(selError, 'selections');
    fixtures.push({ id: fixture.id, home: home.name, away: away.name, startsAt });
  }

  const record = {
    seasonId: season.id,
    divisionId: division.id,
    password: PASSWORD,
    accounts: accounts.map(({ email, displayName, role }) => ({ email, displayName, role })),
    fixtures: fixtures.length,
  };
  writeFileSync(RECORD_PATH, JSON.stringify(record, null, 2));
  console.log(`Season ${season.id}, division ${division.id}, ${fixtures.length} played matches, ${accounts.length} accounts.`);
  console.log(`Tables: /leagues/results/#${season.id}/${division.id}`);
}

const env = loadEnv();
const key = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY;
const url = env.SUPABASE_URL || 'https://klxyjmwiaivvqjbhxzak.supabase.co';
if (!key) throw new Error(`Missing service role key in .env (names: ${Object.keys(env).join(', ')}; service length ${env.SUPABASE_SERVICE_ROLE_KEY?.length ?? 0})`);
const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

if (process.argv.includes('--cleanup')) {
  await cleanup(admin);
} else {
  await createSeason(admin);
}
