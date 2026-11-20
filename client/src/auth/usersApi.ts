import { api } from '@/app/api';
import type { UpdateMeInput, User } from '@/types/api';

// PATCH /api/users/me: saves the theme and language to the profile so they follow the user.
export const usersApi = api.injectEndpoints({
  endpoints: (builder) => ({
    updateMe: builder.mutation<{ user: User }, UpdateMeInput>({
      query: (body) => ({ url: '/users/me', method: 'PATCH', body }),
    }),
  }),
});

export const { useUpdateMeMutation } = usersApi;
