import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.117.2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const PASSWORD_MIN = 12;
const PASSWORD_MAX = 72;
/** This login stays an admin so a person can try the other roles on their own account. */
const PERMANENT_ADMIN_EMAIL = 'county-admin@players.invalid';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

function passwordIssue(password: string, email = '') {
  if (password.length > PASSWORD_MAX) return `Use at most ${PASSWORD_MAX} characters.`;
  if (password.length < PASSWORD_MIN) return 'Password needs: at least 12 characters.';
  if (!/[a-z]/.test(password)) return 'Password needs: a lowercase letter.';
  if (!/[A-Z]/.test(password)) return 'Password needs: an uppercase letter.';
  if (!/[0-9]/.test(password)) return 'Password needs: a number.';
  if (!/[^A-Za-z0-9]/.test(password)) return 'Password needs: a symbol.';
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

  const user = userData.user as { id: string; email?: string | null; banned_until?: string | null };
  const bannedUntil = user.banned_until ? Date.parse(user.banned_until) : 0;
  if (Number.isFinite(bannedUntil) && bannedUntil > Date.now()) return json({ error: 'This account is inactive.' }, 403);
  const callerEmail = (user.email ?? '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(callerEmail) || /^p-[a-z0-9]+@players\.invalid$/.test(callerEmail)) {
    return json({ error: 'This account needs an email address.' }, 403);
  }

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
    role?: string;
    club_slug?: string;
    team_id?: number;
    active?: boolean;
    must_change_password?: boolean;
    group_slug?: string;
    member?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid request.' }, 400);
  }

  const protectedAdminId = async () => {
    const { data: admins, error } = await admin.from('profiles').select('id, email').eq('is_admin', true);
    if (error) return { id: null as string | null, error: error.message };
    const rows = (admins ?? []) as { id: string; email: string | null }[];
    const permanent = rows.find((row) => String(row.email ?? '').toLowerCase() === PERMANENT_ADMIN_EMAIL);
    if (permanent?.id) return { id: permanent.id, error: null as string | null };
    const adminIds = new Set(rows.map((row) => row.id));
    let earliest: { id: string; created_at: string } | null = null;
    for (let page = 1; page <= 20; page += 1) {
      const { data, error: listError } = await admin.auth.admin.listUsers({ page, perPage: 200 });
      if (listError) return { id: null, error: listError.message };
      for (const user of data.users) {
        if (!adminIds.has(user.id)) continue;
        if (!earliest || user.created_at < earliest.created_at) earliest = { id: user.id, created_at: user.created_at };
      }
      if (data.users.length < 200) break;
    }
    return { id: earliest?.id ?? null, error: null as string | null };
  };

  if (body.action === 'protected') {
    const found = await protectedAdminId();
    if (found.error) return json({ error: found.error }, 500);
    return json({ user_id: found.id });
  }

  if (body.action === 'create') {
    const email = String(body.email ?? '').trim().toLowerCase();
    const password = String(body.password ?? '');
    const displayName = String(body.display_name ?? '').trim();
    const role = String(body.role ?? '').trim();
    const roles = ['admin', 'club_captain', 'team_captain', 'team_player'];
    if (role && !roles.includes(role)) return json({ error: 'Choose a role.' }, 400);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'Enter a valid email.' }, 400);
    if (displayName.length < 2 || displayName.length > 80) return json({ error: 'Enter a name.' }, 400);
    const issue = passwordIssue(password, email);
    if (issue) return json({ error: issue }, 400);
    const clubSlug = String(body.club_slug ?? '').trim();
    const teamId = Number(body.team_id);
    if (role === 'club_captain' && !clubSlug) return json({ error: 'Choose a club.' }, 400);
    if ((role === 'team_captain' || role === 'team_player') && !Number.isInteger(teamId)) return json({ error: 'Choose a team.' }, 400);

    const mustChange = body.must_change_password === true;
    const { data: created, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: displayName, must_change_password: mustChange },
    });
    if (error || !created.user) return json({ error: error?.message ?? 'Could not create the account.' }, 400);

    const profile = {
      display_name: displayName,
      email,
      is_admin: role === 'admin',
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

    if (role) {
      const membership: { profile_id: string; role: string; club_slug?: string; team_id?: number } = {
        profile_id: created.user.id,
        role,
      };
      if (role === 'club_captain') membership.club_slug = clubSlug;
      if (role === 'team_captain' || role === 'team_player') membership.team_id = teamId;
      const { error: roleError } = await admin.from('memberships').insert(membership);
      if (roleError && roleError.code !== '23505') return json({ error: roleError.message }, 400);
    }
    return json({ ok: true });
  }

  if (body.action === 'states') {
    const accounts: { id: string; last_sign_in_at: string | null; active: boolean }[] = [];
    for (let page = 1; page <= 20; page += 1) {
      const { data, error: listError } = await admin.auth.admin.listUsers({ page, perPage: 200 });
      if (listError) return json({ error: listError.message }, 500);
      for (const user of data.users) {
        const bannedUntil = user.banned_until ? new Date(user.banned_until).getTime() : 0;
        accounts.push({
          id: user.id,
          last_sign_in_at: user.last_sign_in_at ?? null,
          active: !bannedUntil || bannedUntil <= Date.now(),
        });
      }
      if (data.users.length < 200) break;
    }
    return json({ accounts });
  }

  if (body.action === 'set-email') {
    const userId = String(body.user_id ?? '');
    const email = String(body.email ?? '').trim().toLowerCase();
    if (!/^[0-9a-f-]{36}$/i.test(userId)) return json({ error: 'Choose an account.' }, 400);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'Enter a valid email.' }, 400);
    const keeper = await protectedAdminId();
    if (keeper.error) return json({ error: keeper.error }, 500);
    if (userId === keeper.id) return json({ error: 'The county admin email stays as it is.' }, 400);
    const { error } = await admin.auth.admin.updateUserById(userId, { email, email_confirm: true });
    if (error) return json({ error: error.message }, 400);
    const { error: profileError } = await admin.from('profiles').update({ email }).eq('id', userId);
    if (profileError) return json({ error: profileError.message }, 400);
    return json({ ok: true, email });
  }

  if (body.action === 'set-active') {
    const userId = String(body.user_id ?? '');
    const active = Boolean(body.active);
    if (!/^[0-9a-f-]{36}$/i.test(userId)) return json({ error: 'Choose an account.' }, 400);
    const keeper = await protectedAdminId();
    if (keeper.error) return json({ error: keeper.error }, 500);
    if (userId === keeper.id) return json({ error: 'The county admin stays active.' }, 400);
    if (userId === userData.user.id) return json({ error: 'You cannot turn off your own account.' }, 400);
    const { error } = await admin.auth.admin.updateUserById(userId, { ban_duration: active ? 'none' : '876600h' });
    if (error) return json({ error: error.message }, 400);
    return json({ ok: true });
  }

  if (body.action === 'set-password') {
    const userId = String(body.user_id ?? '');
    const password = String(body.password ?? '');
    if (!/^[0-9a-f-]{36}$/i.test(userId)) return json({ error: 'Choose an account.' }, 400);
    const { data: person } = await admin.from('profiles').select('email').eq('id', userId).maybeSingle();
    const issue = passwordIssue(password, person?.email ?? '');
    if (issue) return json({ error: issue }, 400);
    const mustChange = body.must_change_password === true;
    const { data: existing } = await admin.auth.admin.getUserById(userId);
    const metadata = { ...(existing.user?.user_metadata ?? {}), must_change_password: mustChange };
    const { error } = await admin.auth.admin.updateUserById(userId, { password, user_metadata: metadata });
    if (error) return json({ error: error.message }, 400);
    return json({ ok: true });
  }

  if (body.action === 'set-admin') {
    const userId = String(body.user_id ?? '');
    const isAdmin = Boolean(body.is_admin);
    if (!/^[0-9a-f-]{36}$/i.test(userId)) return json({ error: 'Choose an account.' }, 400);
    const keeper = await protectedAdminId();
    if (keeper.error) return json({ error: keeper.error }, 500);
    if (!isAdmin && userId === keeper.id) return json({ error: 'The county admin cannot lose admin access.' }, 400);
    if (!isAdmin && userId === userData.user.id) return json({ error: 'You cannot remove your own admin access.' }, 400);
    const { data: target } = await admin.from('profiles').select('email').eq('id', userId).maybeSingle();
    if (String(target?.email ?? '').toLowerCase() === PERMANENT_ADMIN_EMAIL) {
      return json({ error: 'The county admin stays as it is.' }, 400);
    }
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

  if (body.action === 'delete') {
    const userId = String(body.user_id ?? '');
    if (!/^[0-9a-f-]{36}$/i.test(userId)) return json({ error: 'Choose an account.' }, 400);
    const keeper = await protectedAdminId();
    if (keeper.error) return json({ error: keeper.error }, 500);
    if (userId === keeper.id) return json({ error: 'The county admin cannot be deleted.' }, 400);
    const { error: roleError } = await admin.from('memberships').delete().eq('profile_id', userId);
    if (roleError) return json({ error: roleError.message }, 400);
    const { error } = await admin.auth.admin.deleteUser(userId);
    if (error) return json({ error: error.message }, 400);
    return json({ ok: true });
  }

  if (body.action === 'set-group') {
    const userId = String(body.user_id ?? '');
    const slug = String(body.group_slug ?? '');
    const member = Boolean(body.member);
    const personName = String(body.person_name ?? '').trim();
    const hasUser = /^[0-9a-f-]{36}$/i.test(userId);
    const allowed = new Set(['jc_players', 'junior_organisers', 'bc_players', 'rb_players']);
    if (userId && !hasUser) return json({ error: 'Choose an account.' }, 400);
    if (!hasUser && !personName) return json({ error: 'Choose an account.' }, 400);
    if (!allowed.has(slug)) return json({ error: 'Choose a website role.' }, 400);
    if (!member) {
      const removal = hasUser
        ? admin.from('group_members').delete().eq('profile_id', userId).eq('group_slug', slug)
        : admin.from('group_members').delete().is('profile_id', null).eq('person_name', personName).eq('group_slug', slug);
      const { error } = await removal;
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }
    let name = personName || 'Unnamed';
    if (hasUser) {
      const { data: person, error: personError } = await admin.from('profiles').select('display_name').eq('id', userId).maybeSingle();
      if (personError) return json({ error: personError.message }, 400);
      name = String(person?.display_name ?? '').trim() || personName || 'Unnamed';
      await admin.from('group_members').delete().eq('profile_id', userId).eq('group_slug', slug);
    } else {
      await admin.from('group_members').delete().is('profile_id', null).eq('person_name', personName).eq('group_slug', slug);
    }
    const { error } = await admin.from('group_members').insert({
      profile_id: hasUser ? userId : null,
      person_name: name,
      group_slug: slug,
    });
    if (error) return json({ error: error.message }, 400);
    return json({ ok: true });
  }

  return json({ error: 'Unknown action.' }, 400);
});
