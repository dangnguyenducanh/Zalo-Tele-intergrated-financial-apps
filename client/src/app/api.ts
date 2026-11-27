import { createApi, fetchBaseQuery, type BaseQueryFn, type FetchArgs, type FetchBaseQueryError } from '@reduxjs/toolkit/query/react';
import { API_URL, getAccessToken, refreshSession } from '@/auth/session';
import { isApiError } from '@/types/api';

const rawBaseQuery = fetchBaseQuery({
  baseUrl: API_URL,
  prepareHeaders: (headers) => {
    const token = getAccessToken();
    if (token) headers.set('Authorization', `Bearer ${token}`);
    return headers;
  },
});

// Adds the access token; on 401 TOKEN_EXPIRED refreshes once (parallel requests share the same
// refresh, see refreshSession) and retries. If the refresh fails, refreshSession clears the session,
// so AuthContext turns anonymous and ProtectedRoute sends the user to /login.
export const baseQueryWithRefresh: BaseQueryFn<string | FetchArgs, unknown, FetchBaseQueryError> = async (args, api, extra) => {
  const result = await rawBaseQuery(args, api, extra);
  const expired = result.error?.status === 401 && isApiError(result.error.data) && result.error.data.error.code === 'TOKEN_EXPIRED';
  if (!expired) return result;
  return (await refreshSession()) ? rawBaseQuery(args, api, extra) : result;
};

// The base API only. Each feature adds its endpoints in its own file with api.injectEndpoints (docs/08 §8.5).
export const api = createApi({
  reducerPath: 'api',
  baseQuery: baseQueryWithRefresh,
  tagTypes: ['Wallet', 'Category', 'Transaction', 'Budget', 'Stats', 'Draft', 'Session', 'ChatLink', 'AdminUser', 'AdminCategory', 'AssistantThread'],
  endpoints: () => ({}),
});
