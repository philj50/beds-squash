/** Junior age groups for the 2026/27 season, taken on 1 September 2026. */

export const AGE_REFERENCE = '1 September 2026';

const GROUPS = [
  { label: 'Under 11', after: '2015-09-01' },
  { label: 'Under 13', after: '2013-09-01' },
  { label: 'Under 15', after: '2011-09-01' },
  { label: 'Under 17', after: '2009-09-01' },
  { label: 'Under 19', after: '2007-09-01' },
] as const;

export const AGE_CATEGORIES = GROUPS.map((group) => group.label);

/** Category for a YYYY-MM-DD date of birth, or null when the player is outside the junior ages. */
export function ageCategory(dateOfBirth: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)) return null;
  if (dateOfBirth > '2026-09-01' || dateOfBirth <= '2007-09-01') return null;
  return GROUPS.find((group) => dateOfBirth > group.after)?.label ?? null;
}
