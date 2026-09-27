import { SITE, url } from './site';

/** Absolute URL for a site path, including the GitHub Pages or custom-domain base. */
export function abs(site: URL | undefined, path: string): string {
  const origin = site ?? new URL('https://philj50.github.io');
  return new URL(url(path), origin).href;
}

export function organizationId(site: URL | undefined): string {
  return `${abs(site, '/')}#organization`;
}

export function organization(site: URL | undefined) {
  return {
    '@type': 'SportsOrganization',
    '@id': organizationId(site),
    name: SITE.legalName,
    alternateName: [SITE.name, SITE.shortName, 'Beds SRA'],
    url: abs(site, '/'),
    logo: abs(site, '/brand/logo-512.png'),
    email: SITE.email,
    sport: ['Squash', 'Squash 57'],
    areaServed: ['Bedfordshire', 'Luton', 'Milton Keynes'],
    sameAs: [SITE.facebook],
    memberOf: {
      '@type': 'SportsOrganization',
      name: 'England Squash',
      url: SITE.englandSquash,
    },
  };
}

export function website(site: URL | undefined) {
  return {
    '@type': 'WebSite',
    '@id': `${abs(site, '/')}#website`,
    url: abs(site, '/'),
    name: SITE.name,
    description: SITE.description,
    inLanguage: 'en-GB',
    publisher: { '@id': organizationId(site) },
  };
}

export function breadcrumbs(site: URL | undefined, items: { name: string; path: string }[]) {
  const trail = [{ name: 'Home', path: '/' }, ...items];
  return {
    '@type': 'BreadcrumbList',
    itemListElement: trail.map((item, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: item.name,
      item: abs(site, item.path),
    })),
  };
}

export function graph(...nodes: object[]) {
  return { '@context': 'https://schema.org', '@graph': nodes };
}
