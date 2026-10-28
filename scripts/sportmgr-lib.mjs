/** Read a public Sport Manager tournament into the shape the site stores. */

const BASE = 'https://sportmgr.co.uk';

function decode(value) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, ' ')
    .trim();
}

async function get(path) {
  const response = await fetch(BASE + path, { headers: { Accept: 'text/html' } });
  if (!response.ok) throw new Error(`${path} returned ${response.status}`);
  return response.text();
}

function gradesFrom(html) {
  const match = html.match(/parse\.isJson\(\s*(\[[\s\S]*?\])\s*\)/);
  if (!match) return [];
  return JSON.parse(match[1]).map((grade) => ({ id: grade.Id, name: grade.Name }));
}

function playersFrom(html) {
  const players = [];
  for (const chunk of html.split('list-group-item').slice(1)) {
    const name = chunk.match(/class="fw-semibold">([^<]*)<\/div>/);
    const club = chunk.match(/class="small text-muted">([^<]*)<\/div>/);
    const seed = chunk.match(/seed-badge">\s*([^<]*?)\s*<\/span>/);
    if (!name) continue;
    const playerName = decode(name[1]);
    if (!playerName) continue;
    players.push({
      name: playerName,
      club: club ? decode(club[1]) : '',
      seed: seed ? decode(seed[1]) : '',
    });
  }
  return players;
}

function datesFrom(html) {
  return [...html.matchAll(/DateFilterDate_\d+"[^>]*value="(\d{4}-\d{2}-\d{2})"/g)].map((match) => match[1]);
}

function titleFrom(html) {
  const match = html.match(/<h1[^>]*>([^<]+)<\/h1>/);
  return match ? decode(match[1]) : '';
}

function splitGrade(label) {
  const match = label.match(/^(.*?)\s+-\s+(R\d+.*)$/);
  if (!match) return { grade: label, round: '' };
  return { grade: match[1], round: match[2] };
}

function splitTime(time) {
  const match = time.match(/^(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})$/);
  if (!match) return { start: '', end: '' };
  return { start: match[1], end: match[2] };
}

function matchesFrom(html, date) {
  const matches = [];
  for (const chunk of html.split('<td class="match"').slice(1)) {
    const head = chunk.slice(0, chunk.indexOf('</td>'));
    const idMatch = head.match(/data-sm-match-id="(\d+)"/);
    const court = head.match(/data-sm-court="([^"]*)"/);
    const grade = head.match(/class="grade">([^<]*)<\/div>/);
    const players = head.match(/class="players">([^<]*)<\/div>/);
    const time = head.match(/class="time">([^<]*)<\/div>/);
    const result = head.match(/class="result">([^<]*)<\/div>/);
    if (!idMatch || !players) continue;
    const sides = decode(players[1]);
    const pair = sides.match(/^(.*?)(?: \[([^\]]+)\])? v (.*?)(?: \[([^\]]+)\])?$/);
    const label = grade ? decode(grade[1]) : '';
    const parts = splitGrade(label);
    const clock = splitTime(time ? decode(time[1]) : '');
    matches.push({
      id: Number(idMatch[1]),
      date,
      start: clock.start,
      end: clock.end,
      court: court ? decode(court[1]) : '',
      grade: parts.grade,
      round: parts.round,
      home: pair ? decode(pair[1]) : sides,
      away: pair ? decode(pair[3]) : '',
      score: result ? decode(result[1]) : '',
    });
  }
  return matches;
}

export async function fetchTournament(id) {
  const info = await get(`/t/${id}/info`);
  const playersPage = await get(`/t/${id}/players`);
  const grades = gradesFrom(playersPage);
  const schedule = await get(`/t/${id}/schedule`);
  const dates = datesFrom(schedule);

  const entries = [];
  for (const grade of grades) {
    const html = await get(`/t/${id}/players/${grade.id}`);
    for (const player of playersFrom(html)) entries.push({ ...player, grade: grade.name });
  }

  const matches = [];
  const seen = new Set();
  for (const date of dates) {
    const html = await get(`/t/${id}/schedule?date=${date}`);
    for (const match of matchesFrom(html, date)) {
      if (seen.has(match.id)) continue;
      seen.add(match.id);
      matches.push(match);
    }
  }

  return {
    id: Number(id),
    title: titleFrom(info) || `Tournament ${id}`,
    dates,
    grades: grades.map((grade) => grade.name),
    matches,
    entries,
    syncedAt: new Date().toISOString(),
  };
}
