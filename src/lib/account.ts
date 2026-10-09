import type { SupabaseClient } from '@supabase/supabase-js';

/** Send a signed-out visitor to the login page, and bring them back here afterwards. */
export function sendToLogin() {
  const base = import.meta.env.BASE_URL.replace(/\/+$/, '');
  const next = encodeURIComponent(location.pathname + location.search + location.hash);
  location.replace(`${base}/login/?next=${next}`);
}

export type AccountPlace = {
  role: string;
  label: string;
};

const loginAlphabet = 'abcdefghijkmnopqrstuvwxyz23456789';

/** A sign-in address that cannot receive mail. The admin tells the player this by hand. */
export function randomLoginEmail() {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  const local = Array.from(bytes, (byte) => loginAlphabet[byte % loginAlphabet.length]).join('');
  return `p-${local}@players.invalid`;
}

const ROLE_LABEL: Record<string, string> = {
  admin: 'Admin',
  club_captain: 'Club captain',
  team_captain: 'Team captain',
  team_player: 'Player',
};

type MembershipRow = {
  role: string;
  club_slug: string | null;
  teams: { name: string } | { name: string }[] | null;
};

function one<T>(value: T | T[] | null): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

export type AccountGroup = {
  slug: string;
  name: string;
  role: string;
};

export const GROUP_NAME: Record<string, string> = {
  admins: 'Admins',
  lm_club_captains: 'LM Club Captains',
  lm_team_captains: 'LM Team Captains',
  lm_players: 'LM Players',
  sl_players: 'SL Players',
  jc_players: 'JC Players',
  jc_parents: 'JC Parents',
  junior_organisers: 'Junior Organisers',
  bc_players: 'BC Players',
  rb_players: 'RB Players',
};

const GROUP_ORDER = ['admins', 'lm_club_captains', 'lm_team_captains', 'lm_players', 'sl_players', 'jc_players', 'jc_parents', 'junior_organisers', 'bc_players', 'rb_players'];

export type Account = {
  userId: string;
  email: string;
  displayName: string;
  isAdmin: boolean;
  /** Captains and admins manage the squad and the team sheet. */
  canManageSquad: boolean;
  /** A player account with no captain role. */
  playerOnly: boolean;
  places: AccountPlace[];
  groups: AccountGroup[];
};

/** True when this login organises a website group, or is an admin. */
export async function organisesGroup(supabase: SupabaseClient, userId: string, slug: string) {
  const { data: me } = await supabase.from('profiles').select('is_admin').eq('id', userId).maybeSingle();
  if (me?.is_admin) return true;
  const { data, error } = await supabase
    .from('group_members')
    .select('group_slug')
    .eq('profile_id', userId)
    .eq('group_slug', slug)
    .maybeSingle();
  return !error && Boolean(data);
}

export async function loadAccount(supabase: SupabaseClient): Promise<Account | null> {
  const { data } = await supabase.auth.getSession();
  const session = data.session;
  if (!session) return null;

  const [{ data: me }, membershipResult, { data: clubs }, groupResult, catalogResult] = await Promise.all([
    supabase.from('profiles').select('display_name, is_admin').eq('id', session.user.id).maybeSingle(),
    supabase.from('memberships').select('role, club_slug, teams(name)').eq('profile_id', session.user.id),
    supabase.from('clubs').select('slug, name'),
    supabase.from('group_members').select('group_slug, groups(name, position, roles(name))').eq('profile_id', session.user.id),
    supabase.from('groups').select('slug, name, position'),
  ]);

  const clubNames = new Map((clubs ?? []).map((club: { slug: string; name: string }) => [club.slug, club.name]));
  const rows = (membershipResult.data ?? []) as MembershipRow[];
  const isAdmin = Boolean(me?.is_admin);
  const canManageSquad = Boolean(membershipResult.error) || isAdmin || rows.some((row) => row.role !== 'team_player');
  const places: AccountPlace[] = [];
  if (isAdmin) places.push({ role: 'admin', label: 'Admin' });
  for (const row of rows) {
    const team = one(row.teams)?.name ?? null;
    const club = row.club_slug ? clubNames.get(row.club_slug) ?? null : null;
    const title = ROLE_LABEL[row.role] ?? row.role;
    const where = team || club;
    places.push({ role: row.role, label: where ? `${title} · ${where}` : title });
  }

  const groups = ((groupResult.error ? [] : groupResult.data) ?? []) as {
    group_slug: string;
    groups: { name: string; position: number; roles: { name: string } | { name: string }[] | null } | { name: string; position: number; roles: { name: string } | { name: string }[] | null }[] | null;
  }[];
  const catalog = ((catalogResult.error ? [] : catalogResult.data) ?? []) as { slug: string; name: string; position: number }[];
  const catalogBySlug = new Map(catalog.map((group) => [group.slug, group]));
  groups.sort((a, b) => {
    const left = catalogBySlug.get(a.group_slug)?.position ?? GROUP_ORDER.indexOf(a.group_slug);
    const right = catalogBySlug.get(b.group_slug)?.position ?? GROUP_ORDER.indexOf(b.group_slug);
    return left - right;
  });

  return {
    userId: session.user.id,
    email: session.user.email ?? '',
    displayName: me?.display_name || session.user.user_metadata?.display_name || '',
    isAdmin,
    canManageSquad,
    playerOnly: !canManageSquad && rows.some((row) => row.role === 'team_player'),
    places,
    groups: groups.map((group) => {
      const embedded = one(group.groups);
      return {
        slug: group.group_slug,
        name: embedded?.name ?? catalogBySlug.get(group.group_slug)?.name ?? GROUP_NAME[group.group_slug] ?? group.group_slug,
        role: one(embedded?.roles ?? null)?.name ?? '',
      };
    }),
  };
}

/** Save the name on the profile and on the login, so the nav updates. */
export async function saveDisplayName(supabase: SupabaseClient, name: string): Promise<string | null> {
  const trimmed = name.trim();
  if (trimmed.length < 2 || trimmed.length > 80) return 'Enter a name between 2 and 80 characters.';
  const { error: rpcError } = await supabase.rpc('set_my_display_name', { p_name: trimmed });
  if (rpcError) {
    const { data } = await supabase.auth.getSession();
    const id = data.session?.user.id;
    if (!id) return 'Sign in again, then save your name.';
    const { error } = await supabase.from('profiles').update({ display_name: trimmed }).eq('id', id);
    if (error) return error.message;
  }
  const { error: authError } = await supabase.auth.updateUser({ data: { display_name: trimmed } });
  return authError ? authError.message : null;
}
