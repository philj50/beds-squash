import type { APIRoute } from 'astro';
import { getEvents } from '@/lib/content';
import { SITE, isoDate, url } from '@/lib/site';

/**
 * iCalendar feed of all published events. Subscribe from Google/Apple/Outlook calendars
 * at /events.ics — the feed updates whenever the site is rebuilt.
 */

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const fold = (line: string) => {
  // RFC 5545: lines should be no longer than 75 octets
  const out: string[] = [];
  let rest = line;
  while (rest.length > 74) {
    out.push(rest.slice(0, 74));
    rest = ' ' + rest.slice(74);
  }
  out.push(rest);
  return out.join('\r\n');
};
const stamp = (d: Date) => d.toISOString().replace(/[-:]|\.\d{3}/g, '');
const dateOnly = (d: Date) => isoDate(d).replace(/-/g, '');

export const GET: APIRoute = async ({ site }) => {
  const events = await getEvents();
  const now = stamp(new Date());
  const origin = site ?? new URL('https://example.invalid');

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:-//${SITE.legalName}//Events//EN`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${esc(SITE.name)} events`,
    'X-WR-TIMEZONE:Europe/London',
  ];

  for (const e of events) {
    const { title, start, end, allDay, venue, cancelled, link } = e.data;
    const pageUrl = new URL(url(`/events/${e.id}/`), origin).href;
    const description = [e.body?.trim(), link ? `More: ${link}` : '', `Details: ${pageUrl}`].filter(Boolean).join('\n\n');
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${e.id}@${origin.host}`);
    lines.push(`DTSTAMP:${now}`);
    if (allDay) {
      const endEx = new Date((end ?? start).getTime() + 86400000); // DTEND exclusive
      lines.push(`DTSTART;VALUE=DATE:${dateOnly(start)}`);
      lines.push(`DTEND;VALUE=DATE:${dateOnly(endEx)}`);
    } else {
      lines.push(`DTSTART:${stamp(start)}`);
      lines.push(`DTEND:${stamp(end ?? new Date(start.getTime() + 2 * 3600000))}`);
    }
    lines.push(fold(`SUMMARY:${esc(cancelled ? `CANCELLED: ${title}` : title)}`));
    if (venue) lines.push(fold(`LOCATION:${esc(venue)}`));
    lines.push(fold(`DESCRIPTION:${esc(description)}`));
    lines.push(fold(`URL:${pageUrl}`));
    lines.push(`STATUS:${cancelled ? 'CANCELLED' : 'CONFIRMED'}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');

  return new Response(lines.join('\r\n') + '\r\n', {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'inline; filename="beds-squash-events.ics"',
    },
  });
};
