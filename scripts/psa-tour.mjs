/**
 * Refresh the public PSA England calendar and the latest SquashTV YouTube highlights.
 *
 *   node scripts/psa-tour.mjs
 *
 * Writes src/data/psa-tour.json only when the events or the videos have changed.
 * A failed fetch leaves the last good file in place.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'src/data/psa-tour.json');
const TOURNAMENTS_URL = 'https://www.psasquashtour.com/tournaments/';
const VIDEOS_URL = 'https://www.youtube.com/feeds/videos.xml?user=psasquashtv';
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

function londonToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: { 'user-agent': 'BedsSquash/1.0 (public calendar and highlights)', accept: 'text/html,application/xml,text/xml' },
    signal: AbortSignal.timeout(25000),
  });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.text();
}

function decode(value) {
  return value
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/\s+/g, ' ')
    .trim();
}

function cell(row, className) {
  const match = row.match(new RegExp(`class="[^"]*${className}[^"]*"[^>]*>([\\s\\S]*?)</td>`));
  return match ? decode(match[1]) : '';
}

/** Public tournament table. Dates have no year, so the year rolls when the months wrap. */
export function parseTournaments(html) {
  const rows = [...html.matchAll(/<tr class="tour-row"([\s\S]*?)<\/tr>/g)].map((match) => match[1]);
  if (rows.length < 50) throw new Error(`PSA page had ${rows.length} tournament rows.`);
  const yearInName = html.match(/tournament\/[^"']+?(20\d{2})/);
  let year = yearInName ? Number(yearInName[1]) : Number(londonToday().slice(0, 4));
  let previousMonth = -1;
  const events = [];
  for (const row of rows) {
    const dates = [...row.matchAll(/tours-page-date">([A-Z]{3})\s+(\d{1,2})/g)].map((match) => ({
      month: MONTHS.indexOf(match[1]),
      day: Number(match[2]),
    }));
    if (!dates.length || dates.some((date) => date.month < 0)) continue;
    if (previousMonth >= 0 && dates[0].month < previousMonth) year += 1;
    previousMonth = dates[0].month;
    const start = iso(year, dates[0]);
    const endDate = dates[1] ?? dates[0];
    const endYear = endDate.month < dates[0].month ? year + 1 : year;
    const link = row.match(/<a href="(https:\/\/www\.psasquashtour\.com\/tournament\/[^"]+)">([^<]+)<\/a>/);
    if (!link) continue;
    const levelRaw = row.match(/class="level-image[^"]*"[^>]*title="([^"]+)"/)?.[1] ?? '';
    const level = /^\d+$/.test(levelRaw) ? '' : levelRaw;
    const prizes = [...row.matchAll(/class="prize-cell">([^<]*)</g)].map((match) => decode(match[1])).filter((prize) => /\$/.test(prize));
    events.push({
      title: decode(link[2]),
      start,
      end: iso(endYear, endDate),
      venue: cell(row, 'location-cell').replace(/, ENG$/, ''),
      country: /,\s*ENG$/.test(cell(row, 'location-cell')) ? 'ENG' : '',
      level,
      prize: prizes[0] ?? '',
      url: link[1],
      status: row.match(/data-status="([^"]+)"/)?.[1] ?? '',
    });
  }
  return events;
}

function iso(year, date) {
  return `${year}-${String(date.month + 1).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`;
}

export function parseVideos(xml) {
  const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map((match) => match[1]);
  return entries.flatMap((entry) => {
    const id = entry.match(/<yt:videoId>([^<]+)<\/yt:videoId>/)?.[1] ?? '';
    const title = decode(entry.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? '');
    const published = entry.match(/<published>([^<]+)<\/published>/)?.[1] ?? '';
    if (!id || !title) return [];
    return [{ id, title, published, url: `https://www.youtube.com/watch?v=${id}` }];
  });
}

function readPrevious() {
  try {
    return JSON.parse(fs.readFileSync(OUT, 'utf8'));
  } catch {
    return null;
  }
}

function stable(data) {
  return JSON.stringify({ events: data.events, videos: data.videos });
}

async function main() {
  const today = londonToday();
  const html = await fetchText(TOURNAMENTS_URL);
  const events = parseTournaments(html)
    .filter((event) => event.country === 'ENG' && event.status === 'upcoming' && event.end >= today)
    .slice(0, 8)
    .map(({ title, start, end, venue, level, prize, url }) => ({ title, start, end, venue, level, prize, url }));
  const previous = readPrevious();
  let videos = previous?.videos ?? [];
  try {
    const parsed = parseVideos(await fetchText(VIDEOS_URL)).slice(0, 4);
    if (parsed.length) videos = parsed;
  } catch (error) {
    console.error(`YouTube feed skipped: ${error instanceof Error ? error.message : error}`);
  }
  const next = { events, videos };
  const changed = stable(previous ?? {}) !== stable(next);
  if (changed) {
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, `${JSON.stringify({ checkedAt: new Date().toISOString(), ...next }, null, 2)}\n`);
  }
  console.log(JSON.stringify({ changed, events: events.length, videos: videos.length, next: events[0]?.title ?? null, video: videos[0]?.title ?? null }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
