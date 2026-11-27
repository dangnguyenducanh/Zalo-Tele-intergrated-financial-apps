import nodemailer from 'nodemailer';
import { env } from '../config/env.js';

// Sends the 6-digit email codes (docs/02 §2.12, docs/04 §4.12). Nothing calls it yet: sign-up and password reset come later.
//
// Where a code goes depends on the settings, read at call time so a test can change them:
//   GMAIL_USER and GMAIL_APP_PASSWORD both set     -> Gmail SMTP, in every mode
//   not both set, NODE_ENV is not production       -> the server log, "[mail] signup code for a***@gmail.com: 123456"
//   not both set, NODE_ENV is production           -> codes are off: sendCode() rejects, and callers ask canSendCodes() first
// Where mail is on, neither the code nor the full address is ever logged.

const SENDER_NAME = 'Sổ chi tiêu';
const SMTP_TIMEOUT_MS = 15_000; // connecting (DNS included), the greeting and an idle socket: a hung Gmail must not hold a request for minutes

// Any language but "en" is Vietnamese, the app's default.
const COPY = {
  vi: {
    subject: (code) => `Mã xác nhận Sổ chi tiêu: ${code}`,
    about: { signup: 'Dùng mã này để hoàn tất đăng ký Sổ chi tiêu.', reset: 'Dùng mã này để đặt lại mật khẩu Sổ chi tiêu.' },
    valid: 'Mã có hiệu lực trong 10 phút.',
    ignore: 'Nếu bạn không yêu cầu, hãy bỏ qua email này.',
  },
  en: {
    subject: (code) => `Your Sổ chi tiêu code: ${code}`,
    about: { signup: 'Use this code to finish your Sổ chi tiêu sign-up.', reset: 'Use this code for your Sổ chi tiêu password reset.' },
    valid: 'The code is valid for 10 minutes.',
    ignore: "If you didn't ask for this, ignore this email.",
  },
};

let sender; // set only by tests, see setMailSender

// One plain address: no space, control character, comma, semicolon, colon, angle bracket, quote, parenthesis or second "@".
// Anything else would let nodemailer read a group, a name or a second recipient (CR LF + "Bcc: ..." is a group), not one address.
const PLAIN_ADDRESS = /^[^\s\p{Cc},;:<>"()[\]\\@]+@[^\s\p{Cc},;:<>"()[\]\\@]+$/u;

// "an.nguyen@gmail.com" -> "a***@gmail.com". Logs and API answers show an address only like this. Nothing of an address
// with no local part or no "@" is shown.
export function maskEmail(email) {
  const at = email.lastIndexOf('@');
  if (at < 0) return '***';
  return `${[...email.slice(0, at)][0] ?? ''}***${email.slice(at)}`;
}

const smtpOn = () => Boolean(env.GMAIL_USER && env.GMAIL_APP_PASSWORD);

// Can a code reach the user? False only in production without both settings: then callers skip the code step (docs/02 §2.12.4).
export const canSendCodes = () => Boolean(sender) || smtpOn() || env.NODE_ENV !== 'production';

// Test seam: replaces delivery in every mode, also with GMAIL_* unset. `deliver(request, message)` gets the request as
// sendCode() was called, { to, purpose, code, language }, and the nodemailer message built from it. Only test code calls
// this (server/test/mail.test.js checks that nothing in src/ does). Called with nothing, it puts the real delivery back.
export function setMailSender(deliver) {
  sender = deliver;
}

function buildMessage({ to, purpose, code, language }) {
  const copy = language === 'en' ? COPY.en : COPY.vi; // not COPY[language]: "constructor" or "__proto__" would find a member of Object.prototype
  const lines = [copy.about[purpose], code, copy.valid, copy.ignore];
  return {
    // The address is the sender's own: GMAIL_USER is unset only when a test seam replaces delivery.
    from: { name: SENDER_NAME, address: env.GMAIL_USER ?? 'noreply@localhost' },
    to,
    subject: copy.subject(code),
    // Plain text plus simple HTML. No link, image or tracking, and nothing the user typed, not even their name (§2.12.1).
    text: lines.join('\n\n'),
    html: `<p>${lines[0]}</p><p style="font-size:28px;font-weight:bold;letter-spacing:6px">${code}</p><p>${lines[2]}</p><p>${lines[3]}</p>`,
  };
}

// A fresh transport per send: an open connection would not survive the instance going idle between requests.
const sendOverSmtp = (_request, message) =>
  nodemailer
    .createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: { user: env.GMAIL_USER, pass: env.GMAIL_APP_PASSWORD },
      connectionTimeout: SMTP_TIMEOUT_MS,
      greetingTimeout: SMTP_TIMEOUT_MS,
      socketTimeout: SMTP_TIMEOUT_MS,
    })
    .sendMail(message);

// Only a short error code is safe to log: an SMTP reply and the error's own message can repeat the address.
function safeErrorCode(err) {
  const name = typeof err?.code === 'string' && /^[A-Z_]{3,40}$/.test(err.code) ? err.code : '';
  const reply = Number.isInteger(err?.responseCode) && err.responseCode >= 100 && err.responseCode <= 599 ? err.responseCode : '';
  return `${name} ${reply}`.trim() || 'unknown';
}

// Sends one code. purpose: 'signup' | 'reset'; language: 'vi' | 'en'. Resolves when the mail has been handed over
// (or logged), and rejects with a plain Error that holds no address or code when it was not: codes off, or a refused
// send. A failed send logs the masked address and the error code, and the error that caused it is dropped.
export async function sendCode({ to, purpose, code, language }) {
  if (purpose !== 'signup' && purpose !== 'reset') throw new Error('unknown purpose');
  if (typeof code !== 'string' || !/^\d{6}$/.test(code)) throw new Error('a code is 6 digits'); // it goes into HTML as it is
  if (typeof to !== 'string' || !PLAIN_ADDRESS.test(to)) throw new Error('to is one plain address'); // it goes into a header as it is

  const deliver = sender ?? (smtpOn() ? sendOverSmtp : undefined);
  if (!deliver) {
    if (env.NODE_ENV === 'production') throw new Error('mail is not set up: codes are off');
    console.info(`[mail] ${purpose} code for ${maskEmail(to)}: ${code}`);
    return;
  }
  try {
    await deliver({ to, purpose, code, language }, buildMessage({ to, purpose, code, language }));
  } catch (err) {
    console.error(`[mail] send failed for ${maskEmail(to)}: ${safeErrorCode(err)}`);
    // eslint-disable-next-line preserve-caught-error -- on purpose: a cause is printed with its message, which can repeat the address
    throw new Error('the email could not be sent');
  }
}
