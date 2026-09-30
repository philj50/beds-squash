/** Site colour theme. Navy is default; set PUBLIC_SITE_THEME=default (charcoal) or light at build time. */

export type SiteTheme = 'default' | 'light' | 'navy';

export function siteTheme(): SiteTheme {
  const raw = import.meta.env.PUBLIC_SITE_THEME;
  if (raw === 'light') return 'light';
  if (raw === 'default') return 'default';
  return 'navy';
}

export const THEME_COLOR: Record<SiteTheme, string> = {
  default: '#0f1115',
  light: '#f5f5f0',
  navy: '#0a1628',
};
