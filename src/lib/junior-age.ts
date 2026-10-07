/** Junior County Closed ages, taken on the tournament date. */

export const AGE_REFERENCE = 'tournament date';
export const TOURNAMENT_ON = '2026-11-08';
export const ENTRY_CLOSES = '2026-10-28';

const GROUPS = [
  { label: 'Under 9', short: 'U9', after: '2017-11-08' },
  { label: 'Under 11', short: 'U11', after: '2015-11-08' },
  { label: 'Under 13', short: 'U13', after: '2013-11-08' },
  { label: 'Under 15', short: 'U15', after: '2011-11-08' },
  { label: 'Under 17', short: 'U17', after: '2009-11-08' },
  { label: 'Under 19', short: 'U19', after: '2007-11-08' },
] as const;

export const AGE_CATEGORIES = GROUPS.map((group) => group.label);

export const ENTRY_GROUPS = [
  { age: 'Under 9', draw: 'Mixed', label: 'Mixed U9' },
  { age: 'Under 11', draw: 'Girls', label: 'Girls U11' },
  { age: 'Under 13', draw: 'Girls', label: 'Girls U13' },
  { age: 'Under 15', draw: 'Girls', label: 'Girls U15' },
  { age: 'Under 17', draw: 'Girls', label: 'Girls U17' },
  { age: 'Under 19', draw: 'Girls', label: 'Girls U19' },
  { age: 'Under 11', draw: 'Boys', label: 'Boys U11' },
  { age: 'Under 13', draw: 'Boys', label: 'Boys U13' },
  { age: 'Under 15', draw: 'Boys', label: 'Boys U15' },
  { age: 'Under 17', draw: 'Boys', label: 'Boys U17' },
  { age: 'Under 19', draw: 'Boys', label: 'Boys U19' },
] as const;

/** Category for a YYYY-MM-DD date of birth, or null when the player is outside the junior ages. */
export function ageCategory(dateOfBirth: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)) return null;
  if (dateOfBirth > TOURNAMENT_ON || dateOfBirth <= '2007-11-08') return null;
  return GROUPS.find((group) => dateOfBirth > group.after)?.label ?? null;
}

export function entryLabel(age: string, draw: string): string {
  return ENTRY_GROUPS.find((group) => group.age === age && group.draw === draw)?.label ?? `${draw} ${age}`;
}
