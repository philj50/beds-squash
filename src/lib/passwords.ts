import type { SupabaseClient } from '@supabase/supabase-js';

export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 72;
/** Tells Safari and other browsers how strong a suggested password must be. */
export const PASSWORD_RULES = 'minlength: 12; required: lower; required: upper; required: digit; required: special;';

const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
const symbols = '!@#$%&*?';

export type PasswordCheck = { id: string; label: string; met: boolean };

/** The checklist shown beside a new password, the same kind of prompt other sites use. */
export function passwordChecks(password: string): PasswordCheck[] {
  return [
    { id: 'length', label: 'At least 12 characters', met: password.length >= PASSWORD_MIN && password.length <= PASSWORD_MAX },
    { id: 'lower', label: 'A lowercase letter', met: /[a-z]/.test(password) },
    { id: 'upper', label: 'An uppercase letter', met: /[A-Z]/.test(password) },
    { id: 'number', label: 'A number', met: /[0-9]/.test(password) },
    { id: 'symbol', label: 'A symbol', met: /[^A-Za-z0-9]/.test(password) },
  ];
}

export function passwordStrength(password: string): 'empty' | 'weak' | 'fair' | 'strong' {
  if (!password) return 'empty';
  const met = passwordChecks(password).filter((check) => check.met).length;
  if (met <= 2) return 'weak';
  if (met < passwordChecks(password).length) return 'fair';
  return 'strong';
}

/** Why a password is too weak, or null when it is acceptable. */
export function passwordIssue(password: string, email = ''): string | null {
  if (password.length > PASSWORD_MAX) return `Use at most ${PASSWORD_MAX} characters.`;
  const missing = passwordChecks(password).find((check) => !check.met);
  if (missing) return `Password needs: ${missing.label.charAt(0).toLowerCase()}${missing.label.slice(1)}.`;
  if (email && password.toLowerCase() === email.toLowerCase()) return 'Do not use the email address as the password.';
  return null;
}

export function suggestPassword(length = 16): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let value = Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('');
  if (!/[0-9]/.test(value)) value = `${value.slice(0, -1)}7`;
  if (!/[a-z]/.test(value)) value = `a${value.slice(1)}`;
  if (!/[A-Z]/.test(value)) value = `A${value.slice(1)}`;
  if (!/[^A-Za-z0-9]/.test(value)) value = `${value.slice(0, -1)}${symbols[bytes[0] % symbols.length]}`;
  return value;
}

/** Live strength checklist for each new-password field in a form. */
export function bindPasswordRules(root: ParentNode) {
  root.querySelectorAll<HTMLElement>('[data-password-rules]').forEach((list) => {
    if (list.dataset.bound === 'true') return;
    list.dataset.bound = 'true';
    const form = list.closest('form');
    const input = form?.querySelector<HTMLInputElement>('[name="password"]');
    const meter = form?.querySelector<HTMLElement>('[data-password-strength]');
    if (!input) return;
    input.setAttribute('passwordrules', PASSWORD_RULES);
    const paint = () => {
      const password = input.value;
      const checks = passwordChecks(password);
      list.hidden = password.length === 0;
      if (meter) meter.hidden = password.length === 0;
      list.querySelectorAll<HTMLElement>('[data-rule]').forEach((item) => {
        const check = checks.find((entry) => entry.id === item.dataset.rule);
        item.classList.toggle('met', Boolean(check?.met));
      });
      const level = passwordStrength(password);
      if (!meter) return;
      meter.dataset.level = level;
      meter.textContent = level === 'weak' ? 'Weak' : level === 'fair' ? 'Fair' : level === 'strong' ? 'Strong' : '';
    };
    input.addEventListener('input', paint);
    form?.addEventListener('reset', () => {
      window.setTimeout(paint, 0);
    });
    paint();
  });
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
  first?.dispatchEvent(new Event('input', { bubbles: true }));
  first?.focus();
  first?.select();
}

/**
 * Ask the browser to save or update this password, then give it a moment to show the prompt.
 * Callers must ignore the follow-up submit marked with data-password-save.
 */
export async function offerToSavePassword(form: HTMLFormElement): Promise<void> {
  form.querySelectorAll<HTMLInputElement>('input[name="password"], input[name="current_password"], input[name="confirm_password"]').forEach((input) => {
    if (input.type !== 'password') input.type = 'password';
  });
  const email =
    form.querySelector<HTMLInputElement>('[name="email"]')?.value ||
    form.querySelector<HTMLInputElement>('[name="username"]')?.value ||
    '';
  const password = form.querySelector<HTMLInputElement>('[name="password"]')?.value ?? '';
  const Ctor = (window as Window & { PasswordCredential?: new (data: { id: string; password: string; name?: string }) => Credential }).PasswordCredential;
  if (email && password && Ctor && navigator.credentials?.store) {
    try {
      await navigator.credentials.store(new Ctor({ id: email, password, name: email }));
      return;
    } catch {
      /* This browser wants a real form post instead. */
    }
  }
  const frame = document.createElement('iframe');
  frame.name = 'password-save';
  frame.setAttribute('aria-hidden', 'true');
  frame.tabIndex = -1;
  frame.style.cssText = 'position:absolute;width:0;height:0;border:0;opacity:0';
  document.body.append(frame);
  const previousTarget = form.target;
  const previousAction = form.action;
  form.dataset.passwordSave = '1';
  form.target = frame.name;
  form.method = 'post';
  form.action = `${location.origin}${location.pathname}`;
  form.requestSubmit();
  await new Promise((resolve) => window.setTimeout(resolve, 1200));
  form.target = previousTarget;
  form.action = previousAction;
  delete form.dataset.passwordSave;
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
