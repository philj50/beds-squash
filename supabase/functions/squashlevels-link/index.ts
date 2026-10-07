import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.117.2';
import { createHash } from 'node:crypto';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SL_ROOT = 'https://api-leveltech.squashlevels.com';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

function secretKey() {
  const raw = Deno.env.get('SUPABASE_SECRET_KEYS');
  if (raw) {
    try {
      const keys = JSON.parse(raw) as Record<string, string>;
      if (typeof keys.default === 'string') return keys.default;
      const first = Object.values(keys).find((value) => typeof value === 'string');
      if (first) return first;
    } catch {
      /* Fall through to the older env names. */
    }
  }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SECRET_KEY') ?? '';
}

function nameKey(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function plain(value: string) {
  return value
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&rsquo;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function levelNumber(value: string) {
  const digits = value.replace(/,/g, '').trim();
  if (!/^\d+$/.test(digits)) return null;
  const level = Number(digits);
  return Number.isFinite(level) ? level : null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const key = secretKey();
  const email = Deno.env.get('SQUASHLEVELS_EMAIL') ?? '';
  const password = Deno.env.get('SQUASHLEVELS_PASSWORD') ?? '';
  if (!url || !key || !email || !password) return json({ error: 'SquashLevels lookup is not configured.' }, 500);

  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!jwt) return json({ error: 'Sign in again.' }, 401);

  const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: userData, error: userError } = await admin.auth.getUser(jwt);
  if (userError || !userData.user) return json({ error: 'Sign in again.' }, 401);

  const { data: me, error: meError } = await admin
    .from('profiles')
    .select('is_admin')
    .eq('id', userData.user.id)
    .maybeSingle();
  if (meError) return json({ error: meError.message }, 500);
  if (!me?.is_admin) return json({ error: 'Only an admin can do that.' }, 403);

  let body: { name?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid request.' }, 400);
  }
  const typed = String(body.name ?? '').trim().replace(/\s+/g, ' ');
  if (!typed) return json({ error: 'Type the SquashLevels name.' }, 400);

  const jar = new Map<string, string>();
  const storeCookies = (response: Response) => {
    const list = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [];
    for (const cookie of list) {
      const pair = cookie.split(';')[0];
      jar.set(pair.split('=')[0], pair);
    }
  };
  const sl = async (path: string, init: { method?: string; body?: string; json?: boolean } = {}) => {
    const response = await fetch(`${SL_ROOT}${path}`, {
      method: init.method ?? 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(20000),
      headers: {
        'user-agent': 'Mozilla/5.0 BedsSquash/1.0',
        cookie: [...jar.values()].join('; '),
        ...(init.body
          ? { 'content-type': init.json ? 'application/json' : 'application/x-www-form-urlencoded' }
          : {}),
      },
      body: init.body,
    });
    storeCookies(response);
    return response;
  };

  const login = await sl('/api/classic/menu_login', {
    method: 'POST',
    body: new URLSearchParams({
      stay_logged_in: '1',
      action: 'login',
      referer: '/menu_login',
      email,
      password,
      md5password: createHash('md5').update(password).digest('hex'),
    }).toString(),
  });
  const loginHtml = await login.text();
  if (loginHtml.match(/currentPage = '([^']+)'/)?.[1] !== 'dashboard') {
    return json({ error: 'SquashLevels did not accept the sign-in.' }, 502);
  }

  const search = await sl('/api/search', {
    method: 'POST',
    json: true,
    body: JSON.stringify({ name: typed.toLowerCase(), includeClubs: false, clubsOnly: false }),
  });
  if (!search.ok) return json({ error: 'SquashLevels search did not answer.' }, 502);
  const searchBody = (await search.json()) as { data?: { array?: { playerid?: string | number; player?: string; level?: string }[] } };
  const hits = (searchBody.data?.array ?? []).filter((row) => nameKey(String(row.player ?? '')) === nameKey(typed));
  const unique = [...new Map(hits.map((row) => [Number(row.playerid), row])).values()].filter((row) => Number(row.playerid) > 0);
  if (unique.length !== 1) {
    return json(
      {
        error: unique.length
          ? `More than one SquashLevels player is called ${typed}.`
          : `No SquashLevels player is called ${typed}.`,
      },
      404,
    );
  }

  const found = unique[0];
  const id = Number(found.playerid);
  const detail = await sl(`/api/classic/player_detail?player=${id}&show=last12m&nocss=true&nojs=true`);
  const detailHtml = detail.ok ? await detail.text() : '';
  const displayName =
    plain(detailHtml.match(new RegExp(`player_detail\\?player=${id}(?:&[^"'\\s]*)?["']>([^<]+)`))?.[1] ?? '') ||
    plain(String(found.player ?? typed));
  if (nameKey(displayName) !== nameKey(typed)) {
    return json({ error: `No SquashLevels player is called ${typed}.` }, 404);
  }
  const fromPage = levelNumber(detailHtml.match(/class=['"]headline_player_level['"]>([\d,]+)/)?.[1] ?? '');
  const fromSearch = levelNumber(String(found.level ?? ''));
  const currentLevel = fromPage ?? fromSearch;
  const confidenceSlice = detailHtml.slice(detailHtml.indexOf('confidence__container'), detailHtml.indexOf('confidence__container') + 700);
  const confidence = Number(confidenceSlice.match(/(\d{1,3})\s*%/)?.[1]);
  const row: { id: number; display_name: string; current_level?: number; confidence?: number; updated_at: string } = {
    id,
    display_name: displayName,
    updated_at: new Date().toISOString(),
  };
  if (currentLevel != null) row.current_level = currentLevel;
  if (Number.isFinite(confidence)) row.confidence = confidence;
  const { error: saveError } = await admin.from('squashlevels_players').upsert(row, { onConflict: 'id' });
  if (saveError) return json({ error: saveError.message }, 500);

  return json({ id, display_name: displayName, current_level: currentLevel });
});
