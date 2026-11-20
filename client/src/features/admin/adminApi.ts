import { api } from '@/app/api';
import { isApiError, type User } from '@/types/api';

// Response shapes of /api/admin/* (docs/04 §4.4 Admin). They are used only by the admin pages, so they
// live here instead of types/api.ts.

export type CategoryType = 'expense' | 'income';

export type UserFilters = { q?: string; role?: User['role']; status?: User['status'] };

export type AdminUserList = { items: User[]; total: number };

// A default category (userId null). Register copies every template to the new user.
export type CategoryTemplate = {
  id: string;
  type: CategoryType;
  names: { vi: string; en: string };
  keywords: string[];
  icon: string;
  color: string;
  isFallback: boolean;
};

export type TemplateInput = Pick<CategoryTemplate, 'names' | 'keywords' | 'icon' | 'color'>;

export type AdminStats = {
  users: number;
  activeUsers7d: number;
  chatLinks: { telegram: number; zalo: number };
  transactionsBySource: { web: number; telegram: number; zalo: number; receipt: number };
};

export const adminApi = api.injectEndpoints({
  endpoints: (builder) => ({
    getAdminUsers: builder.query<AdminUserList, UserFilters & { page: number; limit: number }>({
      query: (params) => ({ url: '/admin/users', params }),
      providesTags: ['AdminUser'],
    }),
    updateAdminUser: builder.mutation<User, { id: string; changes: Partial<Pick<User, 'role' | 'status'>> }>({
      query: ({ id, changes }) => ({ url: `/admin/users/${id}`, method: 'PATCH', body: changes }),
      invalidatesTags: ['AdminUser'],
    }),
    getAdminStats: builder.query<AdminStats, void>({
      query: () => '/admin/stats',
      providesTags: ['AdminUser'], // refetched with the user list
    }),
    getTemplates: builder.query<CategoryTemplate[], CategoryType>({
      query: (type) => ({ url: '/admin/categories', params: { type } }),
      providesTags: ['AdminCategory'],
    }),
    createTemplate: builder.mutation<CategoryTemplate, TemplateInput & { type: CategoryType }>({
      query: (body) => ({ url: '/admin/categories', method: 'POST', body }),
      invalidatesTags: ['AdminCategory'],
    }),
    updateTemplate: builder.mutation<CategoryTemplate, { id: string; changes: TemplateInput }>({
      query: ({ id, changes }) => ({ url: `/admin/categories/${id}`, method: 'PATCH', body: changes }),
      invalidatesTags: ['AdminCategory'],
    }),
    deleteTemplate: builder.mutation<void, string>({
      query: (id) => ({ url: `/admin/categories/${id}`, method: 'DELETE' }),
      invalidatesTags: ['AdminCategory'],
    }),
  }),
});

export const {
  useGetAdminUsersQuery,
  useUpdateAdminUserMutation,
  useGetAdminStatsQuery,
  useGetTemplatesQuery,
  useCreateTemplateMutation,
  useUpdateTemplateMutation,
  useDeleteTemplateMutation,
} = adminApi;

// The API error code of a failed mutation (shown with errorMessage), e.g. "LAST_ADMIN".
export function errorCodeOf(error: unknown): string {
  const { status, data } = (error ?? {}) as { status?: unknown; data?: unknown };
  if (status === 'FETCH_ERROR') return 'NETWORK_ERROR';
  return isApiError(data) ? data.error.code : 'GENERIC';
}
