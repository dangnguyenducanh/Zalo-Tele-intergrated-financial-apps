import { api } from '@/app/api';

// Response shapes of /api/budgets (docs/04 §4.4, server/src/services/budgets.js).
export type Budget = {
  id: string;
  month: string; // "YYYY-MM", Vietnamese calendar month
  categoryId: string | null; // null = overall budget (all spending of the month)
  limit: number; // whole VND
  spent: number; // computed by the server: confirmed expenses of the month in this category (or all of them)
  percent: number; // round(spent / limit × 100); may pass 100
};

export type BudgetInput = Pick<Budget, 'month' | 'categoryId' | 'limit'>;

// A budget change also changes the dashboard's "budget left" card, which provides the `Budget` tag too.
export const budgetsApi = api.injectEndpoints({
  endpoints: (builder) => ({
    // Deleting a category hides its budget (server side), so a category change refetches the list too.
    getBudgets: builder.query<Budget[], string>({
      query: (month) => ({ url: '/budgets', params: { month } }),
      providesTags: ['Budget', 'Category'],
    }),
    createBudget: builder.mutation<Budget, BudgetInput>({
      query: (body) => ({ url: '/budgets', method: 'POST', body }),
      invalidatesTags: ['Budget'],
    }),
    updateBudget: builder.mutation<Budget, { id: string; limit: number }>({
      query: ({ id, limit }) => ({ url: `/budgets/${id}`, method: 'PATCH', body: { limit } }),
      invalidatesTags: ['Budget'],
    }),
    deleteBudget: builder.mutation<void, string>({
      query: (id) => ({ url: `/budgets/${id}`, method: 'DELETE' }),
      invalidatesTags: ['Budget'],
    }),
    // "Copy from last month": budgets the target month already has are kept (server side).
    copyBudgets: builder.mutation<{ created: number }, { from: string; to: string }>({
      query: (body) => ({ url: '/budgets/copy', method: 'POST', body }),
      invalidatesTags: ['Budget'],
    }),
  }),
});

export const { useGetBudgetsQuery, useCreateBudgetMutation, useUpdateBudgetMutation, useDeleteBudgetMutation, useCopyBudgetsMutation } =
  budgetsApi;
