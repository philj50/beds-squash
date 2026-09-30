import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.117.2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const PASSWORD_MIN = 12;
const PASSWORD_MAX = 72;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

function passwordIssue(password: string, email = '') {
  if (password.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters.`;
  if (password.length > PASSWORD_MAX) return `Use at most ${PASSWORD_MAX} characters.`;
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) return 'Include a letter and a number.';
  if (email && password.toLowerCase() === email.toLowerCase()) return 'Do not use the email address as the password.';
  return null;
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const key = secretKey();
  if (!url || !key) return json({ error: 'Account service is not configured.' }, 500);

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

  let body: {
    action?: string;
    email?: string;
    password?: string;
    display_name?: string;
    is_admin?: boolean;
    user_id?: string;
  };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid request.' }, 400);
  }

  if (body.action === 'create') {
    const email = String(body.email ?? '').trim().toLowerCase();
    const password = String(body.password ?? '');
    const displayName = String(body.display_name ?? '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'Enter a valid email.' }, 400);
    if (displayName.length < 2 || displayName.length > 80) return json({ error: 'Enter a name.' }, 400);
    const issue = passwordIssue(password, email);
    if (issue) return json({ error: issue }, 400);

    const { data: created, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: displayName },
    });
    if (error || !created.user) return json({ error: error?.message ?? 'Could not create the account.' }, 400);

    const profile = {
      display_name: displayName,
      email,
      is_admin: Boolean(body.is_admin),
    };
    const { data: updated, error: updateError } = await admin
      .from('profiles')
      .update(profile)
      .eq('id', created.user.id)
      .select('id');
    if (updateError) return json({ error: updateError.message }, 400);
    if (!updated?.length) {
      const { error: insertError } = await admin.from('profiles').insert({ id: created.user.id, ...profile });
      if (insertError) return json({ error: insertError.message }, 400);
    }

    if (body.is_admin) {
      const { error: roleError } = await admin.from('memberships').insert({ profile_id: created.user.id, role: 'admin' });
      if (roleError && roleError.code !== '23505') return json({ error: roleError.message }, 400);
    }
    return json({ ok: true });
  }

  if (body.action === 'set-password') {
    const userId = String(body.user_id ?? '');
    const password = String(body.password ?? '');
    if (!/^[0-9a-f-]{36}$/i.test(userId)) return json({ error: 'Choose an account.' }, 400);
    const { data: person } = await admin.from('profiles').select('email').eq('id', userId).maybeSingle();
    const issue = passwordIssue(password, person?.email ?? '');
    if (issue) return json({ error: issue }, 400);
    const { error } = await admin.auth.admin.updateUserById(userId, { password });
    if (error) return json({ error: error.message }, 400);
    return json({ ok: true });
  }

  if (body.action === 'set-admin') {
    const userId = String(body.user_id ?? '');
    const isAdmin = Boolean(body.is_admin);
    if (!/^[0-9a-f-]{36}$/i.test(userId)) return json({ error: 'Choose an account.' }, 400);
    if (!isAdmin && userId === userData.user.id) return json({ error: 'You cannot remove your own admin access.' }, 400);

    const { error } = await admin.from('profiles').update({ is_admin: isAdmin }).eq('id', userId);
    if (error) return json({ error: error.message }, 400);
    if (isAdmin) {
      const { error: roleError } = await admin.from('memberships').insert({ profile_id: userId, role: 'admin' });
      if (roleError && roleError.code !== '23505') return json({ error: roleError.message }, 400);
    } else {
      const { error: roleError } = await admin.from('memberships').delete().eq('profile_id', userId).eq('role', 'admin');
      if (roleError) return json({ error: roleError.message }, 400);
    }
    return json({ ok: true });
  }

  return json({ error: 'Unknown action.' }, 400);
});
