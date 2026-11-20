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

export const fake = {
  account: null as User | null, // the registered user, if any
  loggedIn: false, // whether the browser holds a valid refresh cookie
  patches: [] as unknown[], // bodies sent to PATCH /users/me
};

export function resetFake(account: User | null = LAN, loggedIn = false) {
  fake.account = account && { ...account };
  fake.loggedIn = loggedIn;
  fake.patches = [];
}

const fail = (status: number, code: string) => HttpResponse.json({ error: { code, message: code } }, { status });
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
    fake.account = { ...LAN, id: 'u2', name: body.name, email: body.email, language: body.language };
    fake.loggedIn = true;
    return HttpResponse.json({ accessToken: 'access-1', user: fake.account }, { status: 201 });
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
