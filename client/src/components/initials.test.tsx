import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { expect, test } from 'vitest';
import { AuthContext, type AuthContextValue } from '@/auth/useAuth';
import { LAN } from '@/test/fakeApi';
import NavDrawer from './NavDrawer';
import UserMenu from './UserMenu';

// BUG-025: at ≥ md the app bar (UserMenu) and the drawer foot (NavDrawer) both show the user's avatar.
test('TC-F12-06 the app bar and the drawer show the same initials for a multi-word name', () => {
  const auth = { user: { ...LAN, name: 'Nguyễn Văn An' }, status: 'authenticated' } as AuthContextValue;
  render(
    <AuthContext value={auth}>
      <MemoryRouter>
        <UserMenu />
        <NavDrawer />
      </MemoryRouter>
    </AuthContext>,
  );

  expect(screen.getByRole('button', { name: 'Tài khoản' })).toHaveTextContent(/^VA$/);
  expect(screen.getAllByText('VA')).toHaveLength(2);
});
