/** Present a Sport Manager tournament as the order of play. */

export type TournamentMatch = {
  id: number;
  date: string;
  start: string;
  end: string;
  court: string;
  grade: string;
  round: string;
  home: string;
  away: string;
  score: string;
};

export type TournamentEntry = {
  grade: string;
  name: string;
  seed: string;
  club: string;
};

export type TournamentData = {
  id: number;
  title: string;
  dates: string[];
  grades: string[];
  matches: TournamentMatch[];
  entries: TournamentEntry[];
  syncedAt: string;
};

export type BoardState = {
  day: string;
  grade: string;
  today: string;
  nowMinutes: number | null;
  showUpdated?: boolean;
};

function esc(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function londonToday(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function londonMinutes(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? 0);
  return hour * 60 + minute;
}

function updatedLabel(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: 'Europe/London',
  }).format(date);
}

function dayParts(iso: string) {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

export function dayHeading(iso: string) {
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(dayParts(iso));
}

export function dayShort(iso: string) {
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(dayParts(iso));
}

export function roundLabel(round: string) {
  if (/final/i.test(round)) return 'Final';
  if (/\(SF\)/i.test(round)) return 'Semi-final';
  if (/\(QF\)/i.test(round)) return 'Quarter-final';
  const number = round.match(/R(\d+)/);
  return number ? `Round ${number[1]}` : round;
}

function parseGames(score: string) {
  const walkover = /^w\/o\b/i.test(score.trim());
  const body = score.trim().replace(/^w\/o\b/i, '').replace(/[()]/g, '').trim();
  if (!body) return { games: [] as [number, number][], walkover };
  const games: [number, number][] = [];
  for (const part of body.split(/[\s,]+/).filter(Boolean)) {
    const match = part.match(/^(\d+)-(\d+)$/);
    if (!match) return null;
    games.push([Number(match[1]), Number(match[2])] as [number, number]);
  }
  return { games, walkover };
}

type MatchCall = { winner: string | null; loser: string | null; score: string; pending: boolean };

/** The score is stored from the first player's side. The winner is the player who took more games. */
export function matchCall(match: TournamentMatch): MatchCall {
  if (!match.score) return { winner: null, loser: null, score: '', pending: true };
  const parsed = parseGames(match.score);
  if (!parsed) return { winner: null, loser: null, score: match.score, pending: false };
  let homeGames = 0;
  let awayGames = 0;
  for (const [home, away] of parsed.games) {
    if (home > away) homeGames += 1;
    else if (away > home) awayGames += 1;
  }
  if (parsed.games.length === 0 || homeGames === awayGames) {
    return { winner: null, loser: null, score: parsed.walkover ? 'Walkover' : match.score, pending: false };
  }
  const awayWon = awayGames > homeGames;
  const line = parsed.games.map(([home, away]) => (awayWon ? `${away}-${home}` : `${home}-${away}`)).join(', ');
  return {
    winner: awayWon ? match.away : match.home,
    loser: awayWon ? match.home : match.away,
    score: parsed.walkover ? `Walkover, ${line}` : line,
    pending: false,
  };
}

/** The score is stored from the first player's side. The line is rewritten from the winner's side. */
export function describeMatch(match: TournamentMatch) {
  const call = matchCall(match);
  const pending = `${esc(match.home)} <span class="v">v</span> ${esc(match.away)}`;
  if (!call.winner) return { players: pending, score: esc(call.score), pending: call.pending };
  return {
    players: `<span class="winner">${esc(call.winner)}</span> beat ${esc(call.loser ?? '')}`,
    score: esc(call.score),
    pending: false,
  };
}

function offCourt(match: TournamentMatch) {
  return match.court === 'Unassigned' || match.start === '00:00' || match.start === '';
}

function minutes(clock: string) {
  const [hour, minute] = clock.split(':').map(Number);
  return hour * 60 + minute;
}

export function defaultState(data: TournamentData, now = new Date()): BoardState {
  const today = londonToday(now);
  const day = data.dates.includes(today) ? today : (data.dates[0] ?? '');
  return { day, grade: 'all', today, nowMinutes: data.dates.includes(today) ? londonMinutes(now) : null };
}

function courtNow(matches: TournamentMatch[], nowMinutes: number) {
  const courts = [...new Set(matches.filter((match) => !offCourt(match)).map((match) => match.court))];
  courts.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  return courts.map((court) => {
    const onCourt = matches
      .filter((match) => match.court === court)
      .sort((a, b) => a.start.localeCompare(b.start));
    const current = onCourt.find((match) => minutes(match.start) <= nowMinutes && nowMinutes < minutes(match.end || match.start));
    const next = onCourt.find((match) => minutes(match.start) > nowMinutes);
    const match = current ?? next;
    return { court, label: current ? 'On court' : 'Next', match };
  });
}

function roundNumber(round: string) {
  const match = round.match(/R(\d+)/i);
  return match ? Number(match[1]) : 0;
}

type DrawTie = { match: TournamentMatch; homeFeed: DrawTie | null; awayFeed: DrawTie | null };

function buildTie(match: TournamentMatch, matches: TournamentMatch[], used: Set<number>): DrawTie {
  used.add(match.id);
  const before = roundNumber(match.round);
  const feed = (player: string) => {
    const earlier = matches
      .filter((item) => !used.has(item.id) && roundNumber(item.round) < before && (item.home === player || item.away === player))
      .sort((a, b) => roundNumber(b.round) - roundNumber(a.round) || a.id - b.id);
    const found = earlier.find((item) => {
      const winner = matchCall(item).winner;
      return !winner || winner === player;
    });
    return found ? buildTie(found, matches, used) : null;
  };
  return { match, homeFeed: feed(match.home), awayFeed: feed(match.away) };
}

function drawSeeds(entries: TournamentEntry[], grade: string) {
  const seeds = new Map<string, string>();
  for (const entry of entries) if (entry.grade === grade && entry.seed) seeds.set(entry.name, entry.seed);
  return seeds;
}

function drawSlot(name: string, seed: string, winner: string | null) {
  const mark = winner === name ? ' is-winner' : '';
  return `<span class="slot${mark}">${seed ? `<span class="seed">${esc(seed)}</span>` : ''}<span class="name">${esc(name)}</span></span>`;
}

function drawLeaf(name: string, seed: string) {
  return `<div class="tie"><div class="tie__box">${drawSlot(name, seed, null)}</div></div>`;
}

function drawBranch(tie: DrawTie, seeds: Map<string, string>): string {
  const call = matchCall(tie.match);
  if (!tie.homeFeed && !tie.awayFeed) {
    return `<div class="tie"><div class="tie__box">${drawSlot(tie.match.home, seeds.get(tie.match.home) ?? '', call.winner)}${drawSlot(tie.match.away, seeds.get(tie.match.away) ?? '', call.winner)}<span class="tie__score">${esc(call.score)}</span></div></div>`;
  }
  const home = tie.homeFeed ? drawBranch(tie.homeFeed, seeds) : drawLeaf(tie.match.home, seeds.get(tie.match.home) ?? '');
  const away = tie.awayFeed ? drawBranch(tie.awayFeed, seeds) : drawLeaf(tie.match.away, seeds.get(tie.match.away) ?? '');
  const name = call.winner ?? `${tie.match.home} v ${tie.match.away}`;
  return `<div class="tie"><div class="tie__feeds">${home}${away}</div><div class="tie__out${call.winner ? ' is-winner' : ''}"><span class="name">${esc(name)}</span><span class="score">${esc(call.score)}</span></div></div>`;
}

function blankDraw() {
  const box = '<div class="tie"><div class="tie__box tie__box--blank"><span class="slot"></span><span class="slot"></span></div></div>';
  return `<div class="tie"><div class="tie__feeds">${box}${box}</div><div class="tie__out tie__out--blank"></div></div>`;
}

/** The two sides of one grade, in the shape of the Sport Manager draw. */
export function renderDraw(data: TournamentData, grade: string) {
  const grades = data.grades
    .map((name) => `<button type="button" class="pill${name === grade ? ' is-active' : ''}" data-draw-grade="${esc(name)}">${esc(name)}</button>`)
    .join('');
  const filters = grades ? `<div class="filters draw-filters" role="group" aria-label="Draw">${grades}</div>` : '';
  const matches = data.matches.filter((match) => match.grade === grade);
  if (matches.length === 0) {
    return `<div class="section-head"><h2>The draw</h2></div>${filters}<p class="notice">The two sides of the draw will appear here once it is made.</p><div class="sides sides--blank" aria-hidden="true"><section class="side"><h3><span>Top half</span></h3>${blankDraw()}</section><section class="side"><h3><span>Bottom half</span></h3>${blankDraw()}</section></div>`;
  }

  const final = [...matches].sort((a, b) => roundNumber(b.round) - roundNumber(a.round) || a.id - b.id)[0];
  const used = new Set<number>();
  const tree = buildTie(final, matches, used);
  const call = matchCall(final);
  const seeds = drawSeeds(data.entries, grade);
  const champion = call.winner
    ? `<div class="champion"><span class="eyebrow">Champion</span><strong>${esc(call.winner)}</strong><p>beat ${esc(call.loser ?? '')} <span>${esc(call.score)}</span></p></div>`
    : `<div class="champion champion--open"><span class="eyebrow">Final</span><strong>${esc(final.home)} <span class="v">v</span> ${esc(final.away)}</strong></div>`;
  const side = (label: string, player: string, feed: DrawTie | null) =>
    `<section class="side"><h3><span>${label}</span><strong>${esc(player)}</strong></h3>${feed ? drawBranch(feed, seeds) : '<p class="muted">Bye to the final.</p>'}</section>`;
  const orphans = matches.filter((match) => !used.has(match.id));
  const extra = orphans.length
    ? `<section class="side side--extra"><h3><span>Also played</span></h3>${orphans.map((match) => drawBranch({ match, homeFeed: null, awayFeed: null }, seeds)).join('')}</section>`
    : '';
  return `<div class="section-head"><h2>The draw</h2></div>${filters}${champion}<div class="sides">${side('Top half', final.home, tree.homeFeed)}${side('Bottom half', final.away, tree.awayFeed)}</div>${extra}`;
}

export function renderBoard(data: TournamentData, state: BoardState) {
  if (data.matches.length === 0 && data.entries.length === 0) {
    return `<div class="section-head"><h2>Order of play</h2></div><p class="notice">Times, courts and results will appear here once the draw is made.</p>`;
  }

  const days = data.dates
    .map((date) => {
      const active = date === state.day ? ' is-active' : '';
      return `<button type="button" class="pill${active}" data-day="${esc(date)}">${esc(dayShort(date))}</button>`;
    })
    .join('');
  const grades = ['all', ...data.grades]
    .map((grade) => {
      const active = grade === state.grade ? ' is-active' : '';
      const label = grade === 'all' ? 'All grades' : grade;
      return `<button type="button" class="pill${active}" data-grade-filter="${esc(grade)}">${esc(label)}</button>`;
    })
    .join('');

  const dayMatches = data.matches
    .filter((match) => match.date === state.day && (state.grade === 'all' || match.grade === state.grade))
    .sort((a, b) => Number(offCourt(a)) - Number(offCourt(b)) || a.start.localeCompare(b.start) || a.court.localeCompare(b.court, undefined, { numeric: true }));

  const live =
    state.nowMinutes != null && state.day === state.today
      ? courtNow(
          data.matches.filter((match) => match.date === state.day),
          state.nowMinutes,
        )
      : [];
  const liveHtml =
    live.length > 0
      ? `<div class="courts">${live
          .map(({ court, label, match }) => {
            if (!match) return `<article class="court-card"><span class="eyebrow">${esc(court)}</span><p class="muted">Free</p></article>`;
            const described = describeMatch(match);
            return `<article class="court-card"><span class="eyebrow">${esc(court)}</span><strong>${esc(label)} · ${esc(match.start)}</strong><p>${described.players}</p><p class="muted">${esc(match.grade)}${match.round ? ` · ${esc(roundLabel(match.round))}` : ''}</p></article>`;
          })
          .join('')}</div>`
      : '';

  let seenOffCourt = false;
  const rows = dayMatches
    .map((match) => {
      const described = describeMatch(match);
      const parked = offCourt(match);
      const divider = parked && !seenOffCourt ? ((seenOffCourt = true), `<li class="match-note">Recorded off court</li>`) : '';
      const when = parked ? 'Recorded' : esc(match.start);
      const court = parked ? 'No court' : esc(match.court);
      return `${divider}<li class="match${described.pending ? ' match--pending' : ''}">
        <div class="match__when"><span class="match__time">${when}</span><span class="match__court">${court}</span></div>
        <div class="match__main"><span class="match__grade">${esc(match.grade)}${match.round ? ` · ${esc(roundLabel(match.round))}` : ''}</span><span class="match__players">${described.players}</span></div>
        <div class="match__score">${described.score}</div>
      </li>`;
    })
    .join('');

  const list = rows
    ? `<ol class="programme">${rows}</ol>`
    : `<p class="notice">Nothing scheduled for ${esc(dayHeading(state.day))} in this grade.</p>`;

  const entries = data.entries.filter((entry) => state.grade === 'all' || entry.grade === state.grade);
  const playerCount = new Set(entries.map((entry) => entry.name)).size;
  const byGrade = new Map<string, TournamentEntry[]>();
  for (const entry of entries) byGrade.set(entry.grade, [...(byGrade.get(entry.grade) ?? []), entry]);
  const playerBlocks = [...byGrade.entries()]
    .map(
      ([grade, players]) => `<section><h3>${esc(grade)}</h3><ol>${players
        .map((player) => `<li>${player.seed ? `<span class="seed">${esc(player.seed)}</span>` : ''}${esc(player.name)}</li>`)
        .join('')}</ol></section>`,
    )
    .join('');
  const players =
    entries.length > 0
      ? `<details class="player-list"><summary>Players <span>${playerCount}</span></summary><div class="player-grades">${playerBlocks}</div></details>`
      : '';

  const updated = state.showUpdated ? updatedLabel(data.syncedAt) : '';
  const heading = data.matches.length > 0 ? 'Order of play' : 'Players';
  return `<div class="section-head"><h2>${heading}</h2>${updated ? `<span class="muted">Updated ${esc(updated)}</span>` : ''}</div>
    ${days ? `<div class="filters" role="group" aria-label="Day">${days}</div>` : ''}
    ${data.grades.length > 1 ? `<div class="filters" role="group" aria-label="Grade">${grades}</div>` : ''}
    ${liveHtml}
    ${data.matches.length > 0 && state.day ? `<h3 class="day-heading">${esc(dayHeading(state.day))}</h3>${list}` : ''}
    ${players}`;
}
