import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import type { User } from '@/types/api';

// A small in-memory stand-in for the docs/04 auth endpoints, used by the component tests (MSW).

export const LAN: User = {
  id: 'u1',
  email: 'lan@example.com',
  name: 'Lan',
  role: 'user',
  status: 'active',
  language: 'vi',
  theme: 'system',
  defaultWalletId: null,
};
export const PASSWORD = 'secret123';

// A sign-up waiting for its emailed code (docs/04 §4.4): what the server keeps after a 202.
type PendingSignup = { name: string; email: string; language: User['language']; code: string; signupToken: string; attemptsLeft: number };

export const fake = {
  account: null as User | null, // the registered user, if any
  loggedIn: false, // whether the browser holds a valid refresh cookie
  patches: [] as unknown[], // bodies sent to PATCH /users/me
  mailOn: false, // true: register answers 202 and "mails" a code, like the server with GMAIL_* set; false: 201 as today
  pending: null as PendingSignup | null,
  verifyBodies: [] as unknown[], // bodies sent to POST /auth/register/verify
  resendBodies: [] as unknown[], // bodies sent to POST /auth/register/resend
};

export const CODE = '123456'; // the code the fake "mails"

export function resetFake(account: User | null = LAN, loggedIn = false) {
  fake.account = account && { ...account };
  fake.loggedIn = loggedIn;
  fake.patches = [];
  fake.mailOn = false;
  fake.pending = null;
  fake.verifyBodies = [];
  fake.resendBodies = [];
}

const fail = (status: number, code: string, details?: unknown) => HttpResponse.json({ error: { code, message: code, details } }, { status });
const session = () => HttpResponse.json({ accessToken: 'access-1', user: fake.account });

export const server = setupServer(
  http.post('*/api/auth/refresh', () => (fake.loggedIn && fake.account ? session() : fail(401, 'INVALID_REFRESH'))),
  http.post('*/api/auth/login', async ({ request }) => {
    const { email, password } = (await request.json()) as { email: string; password: string };
    if (email !== fake.account?.email || password !== PASSWORD) return fail(401, 'INVALID_CREDENTIALS');
    fake.loggedIn = true;
    return session();
  }),
  http.post('*/api/auth/register', async ({ request }) => {
    const body = (await request.json()) as { name: string; email: string; language: User['language'] };
    if (body.email === fake.account?.email) return fail(409, 'EMAIL_TAKEN');
    if (fake.mailOn) {
      // Registering again replaces the earlier sign-up and its code (D1), so the earlier tab's token stops working.
      fake.pending = { ...body, code: CODE, signupToken: `token-${Date.now()}-${Math.random()}`, attemptsLeft: 5 };
      return HttpResponse.json({ email: 'm***@example.com', resendAfter: 60, signupToken: fake.pending.signupToken }, { status: 202 });
    }
    fake.account = { ...LAN, id: 'u2', name: body.name, email: body.email, language: body.language };
    fake.loggedIn = true;
    return HttpResponse.json({ accessToken: 'access-1', user: fake.account }, { status: 201 });
  }),
  http.post('*/api/auth/register/verify', async ({ request }) => {
    const body = (await request.json()) as { email: string; code: string; signupToken: string };
    fake.verifyBodies.push(body);
    const { pending } = fake;
    if (!pending || pending.signupToken !== body.signupToken || pending.email !== body.email || pending.attemptsLeft === 0) return fail(400, 'CODE_EXPIRED');
    if (body.code !== pending.code) {
      pending.attemptsLeft -= 1;
      return pending.attemptsLeft === 0 ? fail(400, 'CODE_EXPIRED') : fail(400, 'CODE_INVALID', { attemptsLeft: pending.attemptsLeft });
    }
    fake.account = { ...LAN, id: 'u2', name: pending.name, email: pending.email, language: pending.language };
    fake.loggedIn = true;
    fake.pending = null;
    return HttpResponse.json({ accessToken: 'access-1', user: fake.account }, { status: 201 });
  }),
  http.post('*/api/auth/register/resend', async ({ request }) => {
    fake.resendBodies.push(await request.json());
    if (fake.pending) fake.pending.code = CODE; // a resend replaces the code
    return HttpResponse.json({ resendAfter: 60 }, { status: 202 }); // the same answer whether or not a sign-up is pending (D6)
  }),
  http.post('*/api/auth/logout', () => {
    fake.loggedIn = false;
    return new HttpResponse(null, { status: 204 });
  }),
  http.patch('*/api/users/me', async ({ request }) => {
    if (request.headers.get('Authorization') !== 'Bearer access-1' || !fake.account) return fail(401, 'UNAUTHENTICATED');
    const body = (await request.json()) as Partial<User>;
    fake.patches.push(body);
    fake.account = { ...fake.account, ...body };
    return HttpResponse.json({ user: fake.account });
  }),
);
