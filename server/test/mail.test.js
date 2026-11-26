import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspect } from 'node:util';
import nodemailer from 'nodemailer';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { env } from '../src/config/env.js';
import vitestConfig from '../vitest.config.js';
import { canSendCodes, maskEmail, sendCode, setMailSender } from '../src/services/mail.js';

// Nothing here can reach Gmail (docs/07 §7.10.5). nodemailer's `jsonTransport` is the real one: it builds the message
// and sends nothing. Any other transport is replaced: the options it was made with are recorded, and `smtp.sendMail`
// is what a "send" does.
const smtp = vi.hoisted(() => ({ transports: [], sendMail: async () => ({}) }));
vi.mock('nodemailer', async (importOriginal) => {
  const real = await importOriginal();
  const createTransport = (options) => {
    if (options.jsonTransport) return real.default.createTransport(options);
    smtp.transports.push(options);
    return { sendMail: (message) => smtp.sendMail(message) };
  };
  return { ...real, default: { ...real.default, createTransport } };
});

// What the setup file left in the environment, read before any test changes it.
const atStart = { process: [process.env.GMAIL_USER, process.env.GMAIL_APP_PASSWORD], env: [env.GMAIL_USER, env.GMAIL_APP_PASSWORD] };

const ADDRESS = 'an.nguyen@gmail.com';
const CODE = '123456';
const ask = (extra = {}) => ({ to: ADDRESS, purpose: 'signup', code: CODE, language: 'vi', ...extra });
const saved = { NODE_ENV: env.NODE_ENV };
const logSpies = [];
// Every line any console method got, so a test does not depend on which method the mailer picks.
const logged = () => logSpies.flatMap((spy) => spy.mock.calls.map((args) => args.map((a) => (typeof a === 'string' ? a : inspect(a, { depth: 6 }))).join(' '))).join('\n');

beforeEach(() => {
  Object.assign(env, { NODE_ENV: 'test', GMAIL_USER: undefined, GMAIL_APP_PASSWORD: undefined });
  for (const method of ['log', 'info', 'warn', 'error']) logSpies.push(vi.spyOn(console, method).mockImplementation(() => {}));
  smtp.transports.length = 0;
  smtp.sendMail = async () => ({});
});

afterEach(() => {
  Object.assign(env, saved, { GMAIL_USER: undefined, GMAIL_APP_PASSWORD: undefined });
  setMailSender(undefined);
  vi.restoreAllMocks();
  logSpies.length = 0;
});

const mailOn = () => Object.assign(env, { GMAIL_USER: 'sender@gmail.com', GMAIL_APP_PASSWORD: 'abcdefghijklmnop' });

// Builds the real message through the real mailer and turns it into JSON with nodemailer's own jsonTransport.
async function render(args) {
  let json;
  setMailSender(async (_ask, message) => {
    json = JSON.parse((await nodemailer.createTransport({ jsonTransport: true }).sendMail(message)).message);
  });
  await sendCode(args);
  return json;
}

describe('code email', () => {
  const cases = [
    { purpose: 'signup', language: 'vi', subject: 'Mã xác nhận Sổ chi tiêu: 123456', about: 'đăng ký', ten: '10 phút', ignore: 'Nếu bạn không yêu cầu, hãy bỏ qua email này' },
    { purpose: 'signup', language: 'en', subject: 'Your Sổ chi tiêu code: 123456', about: 'sign-up', ten: '10 minutes', ignore: "If you didn't ask for this, ignore this email" },
    { purpose: 'reset', language: 'vi', subject: 'Mã xác nhận Sổ chi tiêu: 123456', about: 'đặt lại mật khẩu', ten: '10 phút', ignore: 'Nếu bạn không yêu cầu, hãy bỏ qua email này' },
    { purpose: 'reset', language: 'en', subject: 'Your Sổ chi tiêu code: 123456', about: 'password reset', ten: '10 minutes', ignore: "If you didn't ask for this, ignore this email" },
  ];

  test.each(cases)('TC-F1-27 the $purpose mail in $language: sender, subject, text and HTML parts, purpose, 10 minutes, ignore line, no link or image', async ({ purpose, language, subject, about, ten, ignore }) => {
    mailOn();
    const mail = await render(ask({ purpose, language }));

    expect(mail.from).toEqual({ name: 'Sổ chi tiêu', address: 'sender@gmail.com' });
    expect(mail.to).toEqual([{ name: '', address: ADDRESS }]);
    expect(mail.subject).toBe(subject);
    for (const part of [mail.text, mail.html]) {
      expect(part).toEqual(expect.any(String));
      expect(part).toContain(CODE);
      expect(part).toContain(about);
      expect(part).toContain(ten);
      expect(part).toContain(ignore);
    }
    expect(mail.html).toContain('<p>'); // simple HTML, not the text again
    expect(mail.text).not.toContain('<');
    // No link to scan (and use up), no image, no tracking: neither part, the subject nor any header holds one
    // (the message id is left out: it is random and may start with an "a").
    expect(mail.headers).toEqual({});
    expect([mail.subject, mail.text, mail.html].join('\n')).not.toMatch(/http|<a|<img/i);
  });

  test('TC-F1-27 the purpose decides the wording, and nothing the user typed is in the mail', async () => {
    mailOn();
    const signup = await render(ask({ purpose: 'signup', language: 'en' }));
    const reset = await render(ask({ purpose: 'reset', language: 'en' }));
    expect(signup.text).not.toBe(reset.text);
    expect(signup.text).not.toContain('password reset');
    expect(reset.text).not.toContain('sign-up');
    // The address is the recipient only: not in the body (and so no name either: sendCode takes none).
    expect(signup.text + signup.html).not.toContain('an.nguyen');
    // Any language but "en" is Vietnamese, the app's default: also one that is a key of Object.prototype.
    for (const language of ['fr', undefined, '', 'constructor', '__proto__', 'toString', 'hasOwnProperty']) {
      expect((await render(ask({ language }))).subject, String(language)).toBe('Mã xác nhận Sổ chi tiêu: 123456');
    }
  });

  test('TC-F1-27 a recipient with CR LF, a comma or a name cannot add a header or a second recipient: only one plain address is sent to', async () => {
    mailOn();
    const sender = vi.fn();
    setMailSender(sender);
    const bad = [
      'victim@gmail.com\r\nBcc: attacker@evil.example', // nodemailer reads this as a group whose member is the attacker
      'a@gmail.com\nBcc: b@evil.example',
      'a@gmail.com, b@evil.example',
      'a@gmail.com;b@evil.example',
      'Name <a@gmail.com>',
      '"a b"@gmail.com',
      'a@b@gmail.com',
      'a@gmail.com\0',
      ' a@gmail.com',
      'a@gmail.com ',
      'nonsense',
      '@gmail.com',
      'a@',
      '',
      undefined,
      null,
      42,
      ['a@gmail.com'],
    ];
    for (const to of bad) {
      const error = await sendCode(ask({ to })).catch((err) => err);
      expect(error, String(to)).toBeInstanceOf(Error);
      expect(error.message, String(to)).toBe('to is one plain address'); // and it repeats nothing the caller sent
    }
    expect(sender).not.toHaveBeenCalled();
    expect(smtp.transports).toHaveLength(0);
    expect(logged()).toBe(''); // log-only mode did not print it either
  });

  test('TC-F1-27 a plain address with dots, a plus or letters beyond ASCII is still sent to as it is', async () => {
    mailOn();
    for (const to of ['an.nguyen@gmail.com', 'đạt.lê@gmail.com', 'a+b@x.vn']) {
      const mail = await render(ask({ to }));
      expect([mail.to.length, mail.to[0].address, mail.cc, mail.bcc], to).toEqual([1, to, undefined, undefined]);
    }
  });

  test('TC-F1-27 a code that is not 6 digits, or an unknown purpose, is refused before anything is sent', async () => {
    mailOn();
    const sender = vi.fn();
    setMailSender(sender);
    for (const bad of [{ code: '<img src=x>' }, { code: '12345' }, { code: '1234567' }, { code: 123456 }, { purpose: 'login' }, { purpose: undefined }]) {
      await expect(sendCode(ask(bad)), JSON.stringify(bad)).rejects.toThrow();
    }
    expect(sender).not.toHaveBeenCalled();
    expect(smtp.transports).toHaveLength(0);
  });
});

describe('no mail configured', () => {
  test.each(['test', 'development'])('TC-F1-28 in %s without GMAIL_* the code goes to the log with a masked address and nothing is sent', async (nodeEnv) => {
    env.NODE_ENV = nodeEnv;
    expect(canSendCodes()).toBe(true);

    await sendCode(ask({ purpose: 'signup', code: '123456' }));
    await sendCode(ask({ purpose: 'reset', code: '654321' }));

    const out = logged();
    expect(out).toContain('[mail] signup code for a***@gmail.com: 123456');
    expect(out).toContain('[mail] reset code for a***@gmail.com: 654321');
    expect(out).not.toContain('an.nguyen');
    expect(smtp.transports).toHaveLength(0);
  });

  test('TC-F1-28 with only one of the two set, outside production, it is still log-only', async () => {
    env.NODE_ENV = 'development';
    for (const one of [{ GMAIL_USER: 'sender@gmail.com' }, { GMAIL_APP_PASSWORD: 'abcdefghijklmnop' }]) {
      Object.assign(env, { GMAIL_USER: undefined, GMAIL_APP_PASSWORD: undefined }, one);
      expect(canSendCodes()).toBe(true);
      await sendCode(ask());
      expect(smtp.transports).toHaveLength(0);
    }
    expect(logged().match(/\[mail\] signup code for a\*\*\*@gmail\.com: 123456/g)).toHaveLength(2);
  });

  test.each([
    ['neither', {}],
    ['only GMAIL_USER', { GMAIL_USER: 'sender@gmail.com' }],
    ['only GMAIL_APP_PASSWORD', { GMAIL_APP_PASSWORD: 'abcdefghijklmnop' }],
  ])('TC-F1-28 in production with %s codes are off: canSendCodes is false and sendCode rejects without logging the code or the address', async (_name, settings) => {
    Object.assign(env, { NODE_ENV: 'production' }, settings);
    expect(canSendCodes()).toBe(false);

    const err = await sendCode(ask()).catch((e) => e);

    expect(err).toBeInstanceOf(Error);
    expect(inspect(err, { depth: 6 })).not.toMatch(/123456|an\.nguyen/);
    expect(logged()).not.toMatch(/123456|an\.nguyen/);
    expect(smtp.transports).toHaveLength(0);
  });

  test('TC-F1-28 with both set it is SMTP in every mode: smtp.gmail.com:465, TLS, 10-20 s timeouts, the app password as typed', async () => {
    mailOn();
    for (const nodeEnv of ['test', 'development', 'production']) {
      env.NODE_ENV = nodeEnv;
      smtp.transports.length = 0;
      let message;
      smtp.sendMail = async (m) => {
        message = m;
        return { accepted: [ADDRESS] };
      };
      expect(canSendCodes()).toBe(true);

      await sendCode(ask());

      expect(smtp.transports).toHaveLength(1);
      expect(smtp.transports[0]).toMatchObject({ host: 'smtp.gmail.com', port: 465, secure: true, auth: { user: 'sender@gmail.com', pass: 'abcdefghijklmnop' } });
      for (const timeout of ['connectionTimeout', 'greetingTimeout', 'socketTimeout']) {
        expect(smtp.transports[0][timeout], `${nodeEnv} ${timeout}`).toBeGreaterThanOrEqual(10_000);
        expect(smtp.transports[0][timeout], `${nodeEnv} ${timeout}`).toBeLessThanOrEqual(20_000);
      }
      expect(message).toMatchObject({ to: ADDRESS, subject: 'Mã xác nhận Sổ chi tiêu: 123456' });
      expect(logged(), nodeEnv).not.toMatch(/123456|an\.nguyen/); // a send that works logs neither the code nor the address
    }
  });
});

describe('mask helper', () => {
  test('TC-F1-29 keeps the first character and the domain: a***@gmail.com', () => {
    expect(maskEmail('an.nguyen@gmail.com')).toBe('a***@gmail.com');
    expect(maskEmail('B@x.vn')).toBe('B***@x.vn');
    expect(maskEmail('đạt.lê@gmail.com')).toBe('đ***@gmail.com'); // one character, not half of a surrogate pair or a byte
  });

  test('TC-F1-29 an address with no local part or no @ shows nothing of it', () => {
    expect(maskEmail('@x.com')).toBe('***@x.com');
    expect(maskEmail('nonsense')).toBe('***');
    expect(maskEmail('')).toBe('***');
  });
});

describe('a failed send', () => {
  // What a rejected RCPT looks like: the server's reply repeats the address, and a bounce text may hold the code.
  const rejection = () =>
    Object.assign(new Error(`Mail command failed: 550 5.1.1 The email account that you tried to reach <${ADDRESS}> does not exist (code ${CODE})`), {
      code: 'EENVELOPE',
      responseCode: 550,
      response: `550 5.1.1 <${ADDRESS}> does not exist`,
      command: 'RCPT TO',
      rejected: [ADDRESS],
    });

  const ways = [
    ['SMTP', () => { mailOn(); smtp.sendMail = async () => { throw rejection(); }; }],
    ['the test seam', () => { setMailSender(async () => { throw rejection(); }); }],
  ];

  test.each(ways)('TC-F1-30 over %s: neither the address nor the code is logged or rethrown; the log names the masked address and the error code', async (_name, arrange) => {
    arrange();

    const err = await sendCode(ask()).catch((e) => e);

    expect(err).toBeInstanceOf(Error);
    expect(err.cause).toBeUndefined(); // the error handler prints a cause with its message and stack
    expect(inspect(err, { depth: 8, showHidden: true })).not.toMatch(/123456|an\.nguyen|does not exist/);
    expect(JSON.stringify(err, Object.getOwnPropertyNames(err))).not.toMatch(/123456|an\.nguyen|does not exist/);
    const out = logged();
    expect(out).not.toMatch(/123456|an\.nguyen|does not exist/);
    expect(out).toContain('a***@gmail.com');
    expect(out).toMatch(/EENVELOPE|550/);
  });

  test('TC-F1-30 an error code or text that is not a code is not copied into the log', async () => {
    setMailSender(async () => {
      throw Object.assign(new Error(ADDRESS), { code: ADDRESS, responseCode: CODE });
    });

    await expect(sendCode(ask())).rejects.toThrow();

    expect(logged()).not.toMatch(/123456|an\.nguyen/);
    expect(logged()).toContain('a***@gmail.com');
  });

  test('TC-F1-30 a failure that has no code at all still logs the masked address, and a send that works logs no code', async () => {
    mailOn();
    smtp.sendMail = async () => {
      throw new Error(`boom ${ADDRESS} ${CODE}`);
    };
    await expect(sendCode(ask())).rejects.toThrow();
    expect(logged()).toContain('a***@gmail.com');
    expect(logged()).not.toMatch(/123456|an\.nguyen|boom/);

    logSpies.forEach((spy) => spy.mockClear());
    smtp.sendMail = async () => ({ accepted: [ADDRESS], response: `250 2.0.0 OK ${CODE}` });
    await expect(sendCode(ask())).resolves.toBeUndefined();
    expect(logged()).not.toMatch(/123456|an\.nguyen/);
  });
});

describe('the test seam', () => {
  test.each([
    ['test', {}],
    ['production', { NODE_ENV: 'production' }],
    ['development with both set', { NODE_ENV: 'development', GMAIL_USER: 'sender@gmail.com', GMAIL_APP_PASSWORD: 'abcdefghijklmnop' }],
  ])('TC-F1-31 setMailSender replaces delivery in every mode (%s): the sender gets the request, nothing is logged or sent over SMTP', async (_name, settings) => {
    Object.assign(env, settings);
    const sender = vi.fn(async () => {});
    setMailSender(sender);

    expect(canSendCodes()).toBe(true);
    await sendCode(ask({ purpose: 'reset', language: 'en' }));

    expect(sender).toHaveBeenCalledTimes(1);
    expect(sender.mock.calls[0][0]).toEqual({ to: ADDRESS, purpose: 'reset', code: CODE, language: 'en' });
    expect(sender.mock.calls[0][1]).toMatchObject({ to: ADDRESS, subject: 'Your Sổ chi tiêu code: 123456' });
    expect(smtp.transports).toHaveLength(0);
    expect(logged()).not.toContain('[mail]');
  });

  test('TC-F1-31 setMailSender() with no argument puts the real delivery back', async () => {
    env.NODE_ENV = 'production';
    setMailSender(async () => {});
    await expect(sendCode(ask())).resolves.toBeUndefined();

    setMailSender();

    expect(canSendCodes()).toBe(false);
    await expect(sendCode(ask())).rejects.toThrow();
  });

  test('TC-F1-31 this run started with no GMAIL_USER and GMAIL_APP_PASSWORD, so a real server/.env cannot turn mail on in a test', () => {
    expect(atStart.process).toEqual([undefined, undefined]);
    expect(atStart.env).toEqual([undefined, undefined]);
  });

  // The check above is green on any machine that exports neither variable, with or without the setup file. These two
  // can fail: the first runs the setup file in a child process whose environment holds both, the second reads the
  // Vitest config that makes every test file start with it.
  test('TC-F1-31 the setup file deletes GMAIL_USER and GMAIL_APP_PASSWORD whatever the shell exported', () => {
    const setup = join(dirname(fileURLToPath(import.meta.url)), 'helpers', 'no-gmail.js');
    const print = 'console.log(JSON.stringify([process.env.GMAIL_USER, process.env.GMAIL_APP_PASSWORD]))';
    const shell = { ...process.env, GMAIL_USER: 'made-up-sender@example.invalid', GMAIL_APP_PASSWORD: 'made-up-app-password' };
    const child = (args) => JSON.parse(execFileSync(process.execPath, [...args, '--eval', print], { env: shell, encoding: 'utf8' }));

    expect(child([]), 'without the setup file the child still sees both').toEqual(['made-up-sender@example.invalid', 'made-up-app-password']);
    expect(child(['--import', setup]), 'with the setup file it sees neither').toEqual([null, null]); // JSON turns undefined into null
  });

  test('TC-F1-31 vitest.config.js runs the setup file before every test file', () => {
    expect(vitestConfig.test.setupFiles).toContain('./test/helpers/no-gmail.js');
  });

  test('TC-F1-31 only test code calls setMailSender: nothing in server/src does', () => {
    const src = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
    const callers = readdirSync(src, { recursive: true })
      .filter((file) => file.endsWith('.js'))
      .filter((file) => /setMailSender\s*\(/.test(readFileSync(join(src, file), 'utf8')))
      .map((file) => relative(src, join(src, file)));
    expect(callers).toEqual(['services/mail.js']); // the definition itself
  });
});
