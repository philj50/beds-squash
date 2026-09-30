import type { SupabaseClient } from '@supabase/supabase-js';

export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 72;

const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

/** Why a password is too weak, or null when it is acceptable. */
export function passwordIssue(password: string, email = ''): string | null {
  if (password.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters.`;
  if (password.length > PASSWORD_MAX) return `Use at most ${PASSWORD_MAX} characters.`;
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) return 'Include a letter and a number.';
  if (email && password.toLowerCase() === email.toLowerCase()) return 'Do not use the email address as the password.';
  return null;
}

export function suggestPassword(length = 16): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let value = Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('');
  if (!/[0-9]/.test(value)) value = `${value.slice(0, -1)}7`;
  if (!/[A-Za-z]/.test(value)) value = `A${value.slice(1)}`;
  return value;
}

export function bindPasswordToggles(root: ParentNode) {
  root.querySelectorAll<HTMLButtonElement>('[data-toggle-password]').forEach((button) => {
    if (button.dataset.bound === 'true') return;
    button.dataset.bound = 'true';
    button.addEventListener('click', () => {
      const field = button.closest('.pw-field')?.querySelector('input');
      if (!field) return;
      const show = field.type === 'password';
      field.type = show ? 'text' : 'password';
      button.textContent = show ? 'Hide' : 'Show';
    });
  });
}

export function fillSuggestedPassword(form: HTMLFormElement) {
  const password = suggestPassword();
  const first = form.querySelector<HTMLInputElement>('[name="password"]');
  const confirm = form.querySelector<HTMLInputElement>('[name="confirm_password"]');
  if (first) {
    first.value = password;
    first.type = 'text';
  }
  if (confirm) {
    confirm.value = password;
    confirm.type = 'text';
  }
  form.querySelectorAll<HTMLButtonElement>('[data-toggle-password]').forEach((button) => {
    button.textContent = 'Hide';
  });
  first?.focus();
  first?.select();
}

/** Signed-in user replaces their own password. Returns an error message, or null. */
export async function changeOwnPassword(
  supabase: SupabaseClient,
  currentPassword: string,
  nextPassword: string,
  confirmPassword: string,
): Promise<string | null> {
  if (nextPassword !== confirmPassword) return 'The new passwords do not match.';
  const { data } = await supabase.auth.getSession();
  const email = data.session?.user.email ?? '';
  if (!email) return 'Sign in again, then change your password.';
  const issue = passwordIssue(nextPassword, email);
  if (issue) return issue;
  if (nextPassword === currentPassword) return 'Choose a different password from the one you use now.';
  const { error: signError } = await supabase.auth.signInWithPassword({ email, password: currentPassword });
  if (signError) return 'Current password is not correct.';
  const { error } = await supabase.auth.updateUser({ password: nextPassword });
  return error ? error.message : null;
}

/** Admin-only account actions. Returns an error message, or null. */
export async function callManageAccounts(
  supabase: SupabaseClient,
  body: Record<string, unknown>,
): Promise<string | null> {
  const { data, error } = await supabase.functions.invoke('manage-accounts', { body });
  if (error) {
    const context = (error as { context?: Response }).context;
    if (context && typeof context.json === 'function') {
      try {
        const payload = (await context.json()) as { error?: string };
        if (payload?.error) return payload.error;
      } catch {
        /* The function body was not JSON. */
      }
    }
    if (/failed to send a request|relay error|failed to fetch/i.test(error.message)) {
      return 'Account tools are not reachable yet. Deploy the manage-accounts function, then try again.';
    }
    return error.message;
  }
  if (data && typeof data === 'object' && 'error' in data && typeof (data as { error?: unknown }).error === 'string') {
    return (data as { error: string }).error;
  }
  return null;
}

/** The original admin account, which cannot be deleted. Null if the function is unavailable. */
export async function fetchProtectedAdmin(supabase: SupabaseClient): Promise<string | null> {
  const { data, error } = await supabase.functions.invoke('manage-accounts', { body: { action: 'protected' } });
  if (error || !data || typeof data !== 'object') return null;
  const id = (data as { user_id?: unknown }).user_id;
  return typeof id === 'string' && id ? id : null;
}
