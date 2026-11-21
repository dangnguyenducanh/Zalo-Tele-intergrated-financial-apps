import { api } from '@/app/api';
import type { UpdateMeInput, User } from '@/types/api';

// PATCH /api/users/me: saves the theme and language to the profile so they follow the user.
export const usersApi = api.injectEndpoints({
  endpoints: (builder) => ({
    updateMe: builder.mutation<{ user: User }, UpdateMeInput>({
      query: (body) => ({ url: '/users/me', method: 'PATCH', body }),
      // GET /stats/by-category names each category in the profile's language (server stats.js); everything else
      // sends both names and the browser picks one. So a saved language change reloads the statistics (BUG-005).
      invalidatesTags: (_result, error, { language }) => (language && !error ? ['Stats'] : []),
    }),
  }),
});

export const { useUpdateMeMutation } = usersApi;
