/** Site colour theme. Set PUBLIC_SITE_THEME=light or navy at build time (default: charcoal). */

export type SiteTheme = 'default' | 'light' | 'navy';

export function siteTheme(): SiteTheme {
  const raw = import.meta.env.PUBLIC_SITE_THEME;
  if (raw === 'light' || raw === 'navy') return raw;
  return 'default';
}

export const THEME_COLOR: Record<SiteTheme, string> = {
  default: '#0f1115',
  light: '#f5f5f0',
  navy: '#0a1628',
};
