import type { CollectionEntry } from 'astro:content';
import type { MapClub } from '@/components/ClubMap.astro';

/**
 * Resolve lat/lng for a club. If the editor entered coordinates in the CMS we use them;
 * otherwise we geocode the UK postcode at build time using postcodes.io (free, no key).
 * Failures are logged and the club is simply left off the map.
 */
const cache = new Map<string, { lat: number; lng: number } | null>();

export async function geocodePostcode(postcode: string): Promise<{ lat: number; lng: number } | null> {
  const key = postcode.replace(/\s+/g, '').toUpperCase();
  if (cache.has(key)) return cache.get(key)!;
  try {
    const res = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(key)}`);
    if (!res.ok) throw new Error(`postcodes.io ${res.status}`);
    const json = (await res.json()) as { result?: { latitude: number; longitude: number } };
    const out = json.result ? { lat: json.result.latitude, lng: json.result.longitude } : null;
    cache.set(key, out);
    return out;
  } catch (err) {
    console.warn(`[geo] Could not geocode "${postcode}": ${(err as Error).message}`);
    cache.set(key, null);
    return null;
  }
}

export async function toMapClubs(clubs: CollectionEntry<'clubs'>[]): Promise<MapClub[]> {
  const out: MapClub[] = [];
  for (const c of clubs) {
    let { lat, lng } = c.data;
    if (lat === undefined || lng === undefined) {
      const g = await geocodePostcode(c.data.postcode);
      if (!g) continue;
      lat = g.lat;
      lng = g.lng;
    }
    out.push({
      id: c.id,
      name: c.data.name,
      venue: c.data.venue,
      town: c.data.town,
      postcode: c.data.postcode,
      lat,
      lng,
      courts: c.data.courts,
      leagueClub: c.data.leagueClub,
    });
  }
  return out;
}
