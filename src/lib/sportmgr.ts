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

function playerHref(name: string) {
  const base = String(import.meta.env?.BASE_URL ?? '/').replace(/\/+$/, '');
  return `${base}/players/#${encodeURIComponent(name)}`;
}

function linkedName(name: string) {
  if (!name) return '';
  return `<a class="player-link" href="${playerHref(name)}">${esc(name)}</a>`;
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
  const pending = `${linkedName(match.home)} <span class="v">v</span> ${linkedName(match.away)}`;
  if (!call.winner) return { players: pending, score: esc(call.score), pending: call.pending };
  return {
    players: `<span class="winner">${linkedName(call.winner)}</span> beat ${linkedName(call.loser ?? '')}`,
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

function slotEnd(match: TournamentMatch) {
  const start = minutes(match.start);
  const end = minutes(match.end || '');
  return end > start ? end : start + 40;
}

function byCourt(left: string, right: string) {
  return left.localeCompare(right, undefined, { numeric: true });
}

/** Matches in their scheduled slot, or the next wave if play has not started. */
function courtsNow(matches: TournamentMatch[], nowMinutes: number) {
  const assigned = matches.filter((match) => !offCourt(match)).sort((a, b) => a.start.localeCompare(b.start) || byCourt(a.court, b.court));
  if (!assigned.length) return null;
  const live = [...assigned].reverse().filter((match) => minutes(match.start) <= nowMinutes && nowMinutes < slotEnd(match));
  const onCourt = new Map<string, TournamentMatch>();
  for (const match of live) if (!onCourt.has(match.court)) onCourt.set(match.court, match);
  if (onCourt.size) {
    return {
      heading: 'Who is on court now?',
      note: '',
      cards: [...onCourt.entries()]
        .sort(([a], [b]) => byCourt(a, b))
        .map(([court, match]) => ({ court, match })),
    };
  }
  const upcoming = assigned.filter((match) => minutes(match.start) > nowMinutes);
  if (!upcoming.length) return { heading: 'Who is on court now?', note: 'Courts are clear.', cards: [] as { court: string; match: TournamentMatch }[] };
  const nextStart = upcoming[0].start;
  return {
    heading: 'Next on court',
    note: '',
    cards: upcoming.filter((match) => match.start === nextStart).map((match) => ({ court: match.court, match })),
  };
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

const CELL_W = 172;
const CELL_H = 54;
const COL_GAP = 36;
const UNIT = 64;
const LABEL = 22;

type DrawCell = {
  home: string;
  away: string;
  seedHome: string;
  seedAway: string;
  winner: string | null;
  score: string;
  round: string;
  onPath: boolean;
  bye: boolean;
};

type DrawNode = { cell: DrawCell; span: number; children: [DrawNode, DrawNode] | null };
type DrawBox = { cell: DrawCell; top: number; span: number; depth: number; key: number; parent: number | null };

function cellFrom(tie: DrawTie, seeds: Map<string, string>, finalist: string): DrawCell {
  const call = matchCall(tie.match);
  return {
    home: tie.match.home,
    away: tie.match.away,
    seedHome: seeds.get(tie.match.home) ?? '',
    seedAway: seeds.get(tie.match.away) ?? '',
    winner: call.winner,
    score: call.score,
    round: roundLabel(tie.match.round),
    onPath: call.winner === finalist,
    bye: false,
  };
}

function nodeFrom(tie: DrawTie | null, byeName: string, seeds: Map<string, string>, finalist: string): DrawNode {
  if (!tie) {
    return {
      cell: { home: byeName, away: '', seedHome: seeds.get(byeName) ?? '', seedAway: '', winner: byeName, score: '', round: '', onPath: byeName === finalist, bye: true },
      span: 1,
      children: null,
    };
  }
  if (!tie.homeFeed && !tie.awayFeed) return { cell: cellFrom(tie, seeds, finalist), span: 1, children: null };
  const home = nodeFrom(tie.homeFeed, tie.match.home, seeds, finalist);
  const away = nodeFrom(tie.awayFeed, tie.match.away, seeds, finalist);
  return { cell: cellFrom(tie, seeds, finalist), span: home.span + away.span, children: [home, away] };
}

function placeDraw(node: DrawNode, top: number, boxes: DrawBox[], parent: number | null): number {
  const key = boxes.length;
  boxes.push({ cell: node.cell, top, span: node.span, depth: 0, key, parent });
  if (!node.children) return 0;
  const [home, away] = node.children;
  const homeDepth = home.cell.bye && !home.children ? -1 : placeDraw(home, top, boxes, key);
  const awayDepth = away.cell.bye && !away.children ? -1 : placeDraw(away, top + home.span, boxes, key);
  const depth = Math.max(homeDepth, awayDepth) + 1;
  boxes[key].depth = depth;
  return depth;
}

function cellBody(cell: DrawCell) {
  if (!cell.home && !cell.away) return '<span class="line"></span><span class="line"></span>';
  const row = (name: string, seed: string, winner: boolean) => {
    if (!name) return '<span class="line is-bye"><span class="who">Bye</span></span>';
    const shown = /^\d+$/.test(seed) ? seed : '';
    return `<a class="line${winner ? ' is-winner' : ''}" href="${playerHref(name)}">${shown ? `<span class="seed">${esc(shown)}</span>` : ''}<span class="who">${esc(name)}</span></a>`;
  };
  const score = cell.score ? `<span class="pts" title="${esc(cell.score)}">${esc(cell.score)}</span>` : '';
  return `${row(cell.home, cell.seedHome, cell.winner === cell.home)}${row(cell.away, cell.seedAway, cell.winner === cell.away)}${score}`;
}

function sheetHtml(boxes: DrawBox[]) {
  const drawn = boxes.filter((box) => !box.cell.bye);
  if (!drawn.length) return '';
  const columns = Math.max(...drawn.map((box) => box.depth)) + 1;
  const span = Math.max(...drawn.map((box) => box.top + box.span));
  const width = columns * (CELL_W + COL_GAP) - COL_GAP;
  const height = LABEL + span * UNIT;
  const xOf = (depth: number) => depth * (CELL_W + COL_GAP);
  const yOf = (box: DrawBox) => LABEL + box.top * UNIT + (box.span * UNIT - CELL_H) / 2;
  const byKey = new Map(boxes.map((box) => [box.key, box]));
  const wires = drawn
    .filter((box) => box.parent != null)
    .map((box) => {
      const parent = byKey.get(box.parent ?? -1);
      if (!parent || parent.cell.bye) return '';
      const y1 = yOf(box) + CELL_H / 2;
      const y2 = yOf(parent) + CELL_H / 2;
      const x1 = xOf(box.depth) + CELL_W;
      const mid = x1 + COL_GAP / 2;
      const hot = box.cell.onPath && parent.cell.onPath ? ' is-path' : '';
      return `<path d="M${x1} ${y1.toFixed(1)} H${mid} V${y2.toFixed(1)} H${xOf(parent.depth)}" class="${hot.trim()}" />`;
    })
    .join('');
  const labels = [...new Set(drawn.map((box) => box.depth))]
    .map((depth) => {
      const round = drawn.find((box) => box.depth === depth && box.cell.round)?.cell.round ?? '';
      return `<span class="col-label" style="left:${xOf(depth)}px">${esc(round)}</span>`;
    })
    .join('');
  const cells = drawn
    .map((box) => {
      const blank = !box.cell.home && !box.cell.away ? ' is-blank' : '';
      const path = box.cell.onPath ? ' is-path' : '';
      return `<div class="cell${path}${blank}" style="left:${xOf(box.depth)}px;top:${yOf(box).toFixed(1)}px">${cellBody(box.cell)}</div>`;
    })
    .join('');
  return `<div class="bracket-scroll"><div class="sheet" style="width:${width}px;height:${height}px"><svg class="wires" width="${width}" height="${height}" aria-hidden="true">${wires}</svg>${labels}${cells}</div></div>`;
}

function blankDraw() {
  const empty = (top: number, span: number, depth: number, key: number, parent: number | null): DrawBox => ({
    cell: { home: '', away: '', seedHome: '', seedAway: '', winner: null, score: '', round: depth === 0 ? 'Round 1' : 'Final', onPath: false, bye: false },
    top,
    span,
    depth,
    key,
    parent,
  });
  return sheetHtml([empty(0, 1, 0, 1, 0), empty(1, 1, 0, 2, 0), empty(0, 2, 1, 0, null)]);
}

/** The two sides of one grade, in the shape of the Sport Manager draw. */
export function renderDraw(data: TournamentData, grade: string) {
  const grades = data.grades
    .map((name) => `<button type="button" class="pill${name === grade ? ' is-active' : ''}" data-draw-grade="${esc(name)}">${esc(name)}</button>`)
    .join('');
  const filters = grades ? `<div class="filters draw-filters" role="group" aria-label="Draw">${grades}</div>` : '';
  const matches = data.matches.filter((match) => match.grade === grade);
  if (matches.length === 0) {
    return `<div class="section-head"><h2>The draw</h2></div>${filters}<p class="draw-note"><sub>Sign in to open a player's profile.</sub></p><p class="notice">The two sides of the draw will appear here once it is made.</p><div class="sides sides--blank" aria-hidden="true"><section class="side"><h3><span>Top half</span></h3>${blankDraw()}</section><section class="side"><h3><span>Bottom half</span></h3>${blankDraw()}</section></div>`;
  }

  const final = [...matches].sort((a, b) => roundNumber(b.round) - roundNumber(a.round) || a.id - b.id)[0];
  const used = new Set<number>();
  const tree = buildTie(final, matches, used);
  const call = matchCall(final);
  const seeds = drawSeeds(data.entries, grade);
  const finalist = call.winner ?? '';
  const sideSheet = (feed: DrawTie | null, player: string) => {
    if (!feed) return '<p class="muted">Bye to the final.</p>';
    const boxes: DrawBox[] = [];
    placeDraw(nodeFrom(feed, player, seeds, finalist), 0, boxes, null);
    return sheetHtml(boxes);
  };
  const champion = call.winner
    ? `<div class="champion"><span class="eyebrow">Champion</span><strong>${linkedName(call.winner)}</strong><p>beat ${linkedName(call.loser ?? '')} <span>${esc(call.score)}</span></p></div>`
    : `<div class="champion champion--open"><span class="eyebrow">Final</span><strong>${linkedName(final.home)} <span class="v">v</span> ${linkedName(final.away)}</strong></div>`;
  const side = (label: string, player: string, feed: DrawTie | null) =>
    `<section class="side"><h3><span>${label}</span><strong>${linkedName(player)}</strong></h3>${sideSheet(feed, player)}</section>`;
  const orphans = matches.filter((match) => !used.has(match.id));
  const extra = orphans.length
    ? `<section class="side side--extra"><h3><span>Also played</span></h3><div class="also">${orphans.map((match) => cellBody(cellFrom({ match, homeFeed: null, awayFeed: null }, seeds, finalist))).map((body) => `<div class="cell">${body}</div>`).join('')}</div></section>`
    : '';
  const note = `<p class="draw-note"><sub>Sign in to open a player's profile.</sub></p>`;
  return `<div class="section-head"><h2>The draw</h2></div>${filters}${note}${champion}<div class="sides">${side('Top half', final.home, tree.homeFeed)}${side('Bottom half', final.away, tree.awayFeed)}</div>${extra}`;
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

  const live = state.nowMinutes != null && state.day === state.today ? courtsNow(data.matches.filter((match) => match.date === state.day), state.nowMinutes) : null;
  const clock = state.nowMinutes == null ? '' : `${String(Math.floor(state.nowMinutes / 60)).padStart(2, '0')}:${String(state.nowMinutes % 60).padStart(2, '0')}`;
  const liveHtml = live
    ? `<section class="on-now"><div class="on-now__head"><h3>${esc(live.heading)}</h3>${clock ? `<span class="muted">${esc(clock)}</span>` : ''}</div>${
        live.note
          ? `<p class="notice">${esc(live.note)}</p>`
          : `<div class="courts">${live.cards
              .map(({ court, match }) => {
                const players = `${linkedName(match.home)} <span class="v">v</span> ${linkedName(match.away)}`;
                const until = slotEnd(match);
                const finish = `${String(Math.floor(until / 60)).padStart(2, '0')}:${String(until % 60).padStart(2, '0')}`;
                return `<article class="court-card${live.heading.startsWith('Who') ? ' court-card--live' : ''}"><span class="eyebrow">${esc(court)}</span><strong>${esc(match.start)}–${esc(finish)}</strong><p>${players}</p><p class="muted">${esc(match.grade)}${match.round ? ` · ${esc(roundLabel(match.round))}` : ''}</p></article>`;
              })
              .join('')}</div>`
      }</section>`
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
    ${liveHtml}
    ${days ? `<div class="filters" role="group" aria-label="Day">${days}</div>` : ''}
    ${data.grades.length > 1 ? `<div class="filters" role="group" aria-label="Grade">${grades}</div>` : ''}
    ${data.matches.length > 0 && state.day ? `<h3 class="day-heading">${esc(dayHeading(state.day))}</h3>${list}` : ''}
    ${players}`;
}
