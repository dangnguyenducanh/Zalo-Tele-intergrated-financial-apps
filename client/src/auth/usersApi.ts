import { api } from '@/app/api';
import type { UpdateMeInput, User } from '@/types/api';

// PATCH /api/users/me: saves the theme and language to the profile so they follow the user.
export const usersApi = api.injectEndpoints({
  endpoints: (builder) => ({
    updateMe: builder.mutation<{ user: User }, UpdateMeInput>({
      query: (body) => ({ url: '/users/me', method: 'PATCH', body }),
      // The server names default categories (in statistics, wallets, budgets and transactions) in the profile's
      // language, so once a new language is saved, everything it named is asked for again (BUG-005).
      invalidatesTags: (_result, error, { language }) =>
        language && !error ? ['Stats', 'Category', 'Wallet', 'Budget', 'Transaction', 'Draft'] : [],
    }),
  }),
});

export const { useUpdateMeMutation } = usersApi;
