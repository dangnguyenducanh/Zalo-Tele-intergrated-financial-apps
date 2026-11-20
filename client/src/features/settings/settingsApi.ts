import { api } from '@/app/api';

// One logged-in device (GET /api/sessions, docs/04 §4.4). `current` marks the device making the request.
export type Session = {
  id: string;
  userAgent: string;
  ip: string;
  lastUsedAt: string;
  current: boolean;
};

export type ChangePasswordInput = { currentPassword: string; newPassword: string };

// Sessions and password change. Every call that logs devices out invalidates `Session`, so the list refetches.
// The profile and preferences use PATCH /users/me from auth/usersApi.ts.
export const settingsApi = api.injectEndpoints({
  endpoints: (builder) => ({
    getSessions: builder.query<Session[], void>({
      query: () => '/sessions',
      providesTags: ['Session'],
    }),
    revokeSession: builder.mutation<void, string>({
      query: (id) => ({ url: `/sessions/${id}`, method: 'DELETE' }),
      invalidatesTags: ['Session'],
    }),
    revokeOtherSessions: builder.mutation<void, void>({
      query: () => ({ url: '/sessions', method: 'DELETE', params: { others: 'true' } }),
      invalidatesTags: ['Session'],
    }),
    // The server also logs out every other device after a password change.
    changePassword: builder.mutation<void, ChangePasswordInput>({
      query: (body) => ({ url: '/users/me/password', method: 'PATCH', body }),
      invalidatesTags: ['Session'],
    }),
  }),
});

export const { useGetSessionsQuery, useRevokeSessionMutation, useRevokeOtherSessionsMutation, useChangePasswordMutation } = settingsApi;
