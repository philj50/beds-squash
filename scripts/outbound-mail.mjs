/**
 * Every message sent by the County Closed sync.
 *
 * The recipient is fixed. Mail is delivered here until we explicitly change it.
 */
import net from 'node:net';
import tls from 'node:tls';

export const OUTBOUND_TO = 'dulltown@gmail.com';

const SMTP_HOST = 'smtp.gmail.com';
const SMTP_PORT = 587;

export function buildMessage({ from, subject, text }) {
  const recipient = OUTBOUND_TO;
  const safeSubject = String(subject || '').replace(/[\r\n]+/g, ' ').trim();
  const encodedSubject = `=?UTF-8?B?${Buffer.from(safeSubject, 'utf8').toString('base64')}?=`;
  const body = String(text || '').replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..');
  return [
    `From: Bedfordshire Squash <${from}>`,
    `To: ${recipient}`,
    `Subject: ${encodedSubject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    '',
    body,
  ].join('\r\n');
}

export async function sendOutbound({ from, user, pass, subject, text }) {
  const recipient = OUTBOUND_TO;
  if (!from || !user || !pass) throw new Error('The Gmail account is not set.');
  if (!subject || !text) throw new Error('The message is empty.');
  const message = buildMessage({ from, subject, text });
  if (!message.includes(`To: ${recipient}`)) throw new Error('Outbound mail can only go to the test inbox.');

  const plain = net.connect({ host: SMTP_HOST, port: SMTP_PORT });
  plain.setTimeout(20000);
  try {
    await readReply(plain);
    await command(plain, 'EHLO bedfordshiresquash.co.uk');
    await command(plain, 'STARTTLS');
    const secure = tls.connect({ socket: plain, servername: SMTP_HOST });
    secure.setTimeout(20000);
    await new Promise((resolve, reject) => {
      secure.once('secureConnect', resolve);
      secure.once('error', reject);
    });
    await command(secure, 'EHLO bedfordshiresquash.co.uk');
    await command(secure, 'AUTH LOGIN');
    await command(secure, Buffer.from(user, 'utf8').toString('base64'));
    await command(secure, Buffer.from(pass, 'utf8').toString('base64'));
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

function command(socket, line) {
  socket.write(`${line}\r\n`);
  return readReply(socket);
}

function readReply(socket) {
  return new Promise((resolve, reject) => {
    let data = '';
    const timer = setTimeout(() => finish(new Error('Mail server timed out.')), 20000);
    const onData = (chunk) => {
      data += chunk.toString('utf8');
      const lines = data.split(/\r?\n/).filter(Boolean);
      const last = lines[lines.length - 1] || '';
      if (last.length < 4 || last[3] === '-') return;
      finish(null, Number(last.slice(0, 3)));
    };
    const onError = (error) => finish(error);
    function finish(error, code) {
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
