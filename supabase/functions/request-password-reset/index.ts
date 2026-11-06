import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.117.2';
import net from 'node:net';
import tls from 'node:tls';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const OUTBOUND_TO = 'dulltown@gmail.com';
const RESET_LIVE_NAME = 'alex buckhurst';
const SMTP_HOST = 'smtp.gmail.com';
const SMTP_PORT = 587;

const REDIRECTS = new Set([
  'https://bedfordshiresquash.co.uk/login/reset/',
  'https://philj50.github.io/beds-squash/login/reset/',
  'http://127.0.0.1:4323/beds-squash/login/reset/',
  'http://localhost:4323/beds-squash/login/reset/',
]);

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

/** Keep in step with resetRecipient in scripts/outbound-mail.mjs. */
function resetRecipient(email: string, live: boolean, name: string) {
  const real = email.trim().toLowerCase();
  const person = name.trim().replace(/\s+/g, ' ').toLowerCase();
  const looksReal = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(real) && !real.endsWith('@players.invalid');
  if (live && person === RESET_LIVE_NAME && looksReal) return real;
  return OUTBOUND_TO;
}

function utf8Base64(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function buildMessage(from: string, recipient: string, subject: string, text: string) {
  const safeSubject = subject.replace(/[\r\n]+/g, ' ').trim();
  const body = text.replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..');
  return [
    `From: Bedfordshire Squash <${from}>`,
    `To: ${recipient}`,
    `Subject: =?UTF-8?B?${utf8Base64(safeSubject)}?=`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    '',
    body,
  ].join('\r\n');
}

function readReply(socket: net.Socket) {
  return new Promise<number>((resolve, reject) => {
    let data = '';
    const timer = setTimeout(() => finish(new Error('Mail server timed out.')), 20000);
    const onData = (chunk: Buffer | string) => {
      data += chunk.toString();
      const lines = data.split(/\r?\n/).filter(Boolean);
      const last = lines[lines.length - 1] || '';
      if (last.length < 4 || last[3] === '-') return;
      finish(null, Number(last.slice(0, 3)));
    };
    const onError = (error: Error) => finish(error);
    function finish(error: Error | null, code = 0) {
      clearTimeout(timer);
      socket.off('data', onData);
      socket.off('error', onError);
      if (error) reject(error);
      else if (code >= 400) reject(new Error(`Mail server refused the message (${code}).`));
      else resolve(code);
    }
    socket.on('data', onData);
    socket.on('error', onError);
  });
}

function command(socket: net.Socket, line: string) {
  socket.write(`${line}\r\n`);
  return readReply(socket);
}

async function sendMail(from: string, user: string, pass: string, recipient: string, subject: string, text: string) {
  const message = buildMessage(from, recipient, subject, text);
  if (!message.includes(`To: ${recipient}`)) throw new Error('The message has no recipient.');
  const plain = net.connect({ host: SMTP_HOST, port: SMTP_PORT });
  plain.setTimeout(20000);
  try {
    await readReply(plain);
    await command(plain, 'EHLO bedfordshiresquash.co.uk');
    await command(plain, 'STARTTLS');
    const secure = tls.connect({ socket: plain, servername: SMTP_HOST });
    secure.setTimeout(20000);
    await new Promise<void>((resolve, reject) => {
      secure.once('secureConnect', () => resolve());
      secure.once('error', reject);
    });
    await command(secure, 'EHLO bedfordshiresquash.co.uk');
    await command(secure, 'AUTH LOGIN');
    await command(secure, utf8Base64(user));
    await command(secure, utf8Base64(pass));
    await command(secure, `MAIL FROM:<${user}>`);
    await command(secure, `RCPT TO:<${recipient}>`);
    await command(secure, 'DATA');
    secure.write(`${message}\r\n.\r\n`);
    await readReply(secure);
    await command(secure, 'QUIT');
    secure.end();
  } catch (error) {
    plain.destroy();
    const detail = error instanceof Error ? error.message : '';
    const code = detail.match(/\((\d+)\)/)?.[1];
    if (code) throw new Error(`Gmail refused the message (${code}).`);
    throw new Error('The message could not be sent.');
  }
}

async function emailKey(email: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(email));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const key = secretKey();
  const gmailUser = Deno.env.get('GMAIL_USERNAME') ?? '';
  const gmailPass = Deno.env.get('GMAIL_PASSWORD') ?? '';
  if (!url || !key || !gmailUser || !gmailPass) return json({ error: 'The reset message could not be sent. Try again in a minute.' }, 500);

  let body: { email?: string; redirectTo?: string } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const email = String(body.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ ok: true });

  const requested = String(body.redirectTo || '').trim();
  const redirectTo = REDIRECTS.has(requested) ? requested : 'https://bedfordshiresquash.co.uk/login/reset/';

  const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  const keyHash = await emailKey(email);
  const { data: recent } = await admin
    .from('password_reset_throttle')
    .select('requested_at')
    .eq('email_key', keyHash)
    .maybeSingle();
  const last = recent?.requested_at ? Date.parse(recent.requested_at) : 0;
  if (Number.isFinite(last) && Date.now() - last < 60_000) return json({ ok: true });

  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
    type: 'recovery',
    email,
    options: { redirectTo },
  });
  if (linkError || !linkData?.properties?.action_link || !linkData.user?.id) return json({ ok: true });

  const { data: profile } = await admin
    .from('profiles')
    .select('display_name')
    .eq('id', linkData.user.id)
    .maybeSingle();
  const name = String(profile?.display_name || 'this login').trim() || 'this login';
  const { data: delivery } = await admin.from('password_reset_delivery').select('live').eq('id', 1).maybeSingle();
  const recipient = resetRecipient(email, delivery?.live === true, name);
  const text = [
    `Someone asked to reset the password for ${name} on Bedfordshire Squash.`,
    '',
    'Open this link to choose a new password. It works once and lasts about an hour.',
    '',
    linkData.properties.action_link,
    '',
    'If you did not ask, ignore this message. The password stays as it is.',
  ].join('\n');

  try {
    await sendMail(gmailUser, gmailUser, gmailPass, recipient, 'Reset your Bedfordshire Squash password', text);
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'reset mail failed');
    return json({ error: 'The reset message could not be sent. Try again in a minute.' }, 500);
  }

  await admin.from('password_reset_throttle').upsert({ email_key: keyHash, requested_at: new Date().toISOString() });
  console.log(recipient === OUTBOUND_TO ? 'reset mail: test' : 'reset mail: account');
  return json({ ok: true });
});
