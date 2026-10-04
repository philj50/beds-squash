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
};

export async function loadAccount(supabase: SupabaseClient): Promise<Account | null> {
  const { data } = await supabase.auth.getSession();
  const session = data.session;
  if (!session) return null;

  const [{ data: me }, membershipResult, { data: clubs }] = await Promise.all([
    supabase.from('profiles').select('display_name, is_admin').eq('id', session.user.id).maybeSingle(),
    supabase.from('memberships').select('role, club_slug, teams(name)').eq('profile_id', session.user.id),
    supabase.from('clubs').select('slug, name'),
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

  return {
    userId: session.user.id,
    email: session.user.email ?? '',
    displayName: me?.display_name || session.user.user_metadata?.display_name || '',
    isAdmin,
    canManageSquad,
    playerOnly: !canManageSquad && rows.some((row) => row.role === 'team_player'),
    places,
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
