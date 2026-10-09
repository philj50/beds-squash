/** Site-wide settings and helpers. */

export const SITE = {
  name: 'Bedfordshire Squash',
  shortName: 'Beds Squash',
  legalName: 'Bedfordshire Squash & Racketball Association',
  tagline: 'Squash & Racketball across Bedfordshire',
  description:
    'The official home of squash and racketball in Bedfordshire: clubs, leagues, tournaments, juniors, county teams, events and news from the Bedfordshire Squash & Racketball Association.',
  email: 'bedssquash@gmail.com',
  facebook: 'https://www.facebook.com/groups/532458603934848/',
  leagueMaster: 'https://bedfordshiresquash.leaguemaster.co.uk/',
  englandSquash: 'https://www.englandsquash.com/',
  englandSquashEvents: 'https://www.englandsquash.com/competitions/calendar',
};

export const NAV = [
  { label: 'News', href: '/news/' },
  { label: 'Events', href: '/events/' },
  { label: 'Clubs', href: '/clubs/' },
  { label: 'Leagues', href: '/leagues/' },
  { label: 'Tournaments', href: '/tournaments/' },
  { label: 'Juniors', href: '/juniors/' },
  { label: 'County Teams', href: '/county-teams/' },
  { label: 'Gallery', href: '/gallery/' },
  { label: 'Documents', href: '/documents/' },
  { label: 'About', href: '/about/' },
  { label: 'Contact', href: '/contact/' },
  { label: 'Minigame mk2', href: '/minigame/' },
  { label: 'Administration', href: '/captains/admin/' },
];

/** Prefix a root-relative path with the configured base (works for "/" and "/beds-squash"). */
export function url(path: string): string {
  const base = import.meta.env.BASE_URL.replace(/\/+$/, '');
  if (!path.startsWith('/')) return `${base}/${path}`;
  return `${base}${path}`;
}

const dateFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
const shortFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });
const weekdayFmt = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const timeFmt = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });

export const formatDate = (d: Date) => dateFmt.format(d);
export const formatShort = (d: Date) => shortFmt.format(d);
export const formatWeekday = (d: Date) => weekdayFmt.format(d);
export const formatTime = (d: Date) => timeFmt.format(d);

/** "14–17 Jan 2027" style range. */
export function formatRange(start: Date, end?: Date): string {
  if (!end || sameDay(start, end)) return weekdayFmt.format(start);
  const sameMonth = start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear();
  if (sameMonth) {
    return `${start.getDate()}–${end.getDate()} ${new Intl.DateTimeFormat('en-GB', { month: 'short', year: 'numeric' }).format(end)}`;
  }
  return `${shortFmt.format(start)} – ${new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(end)}`;
}

export function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export const isoDate = (d: Date) => d.toISOString().slice(0, 10);

export const SOURCE_LABEL: Record<string, string> = {
  county: 'Beds SRA',
  club: 'Club event',
  'england-squash': 'England Squash',
  'inter-county': 'Inter-County',
};

export const CATEGORY_LABEL: Record<string, string> = {
  tournament: 'Tournament',
  league: 'League',
  juniors: 'Juniors',
  masters: 'Masters',
  meeting: 'Meeting',
  coaching: 'Coaching',
  social: 'Social',
  racketball: 'Racketball',
  other: 'Event',
  county: 'County',
  leagues: 'Leagues',
  tournaments: 'Tournaments',
  'england-squash': 'England Squash',
  clubs: 'Clubs',
};

export const DOC_CATEGORY_LABEL: Record<string, string> = {
  constitution: 'Constitution',
  safeguarding: 'Safeguarding',
  'code-of-conduct': 'Codes of Conduct',
  'league-rules': 'League Rules',
  forms: 'Forms',
  accounts: 'Accounts',
  other: 'Other',
};
