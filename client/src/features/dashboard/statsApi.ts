import { api } from '@/app/api';

// Response shapes of /api/stats (docs/04 §4.4, server/src/services/stats.js). Only confirmed transactions count.
export type MonthSummary = {
  income: number;
  expense: number;
  net: number; // income − expense
  budget: { limit: number; spent: number } | null; // the month's overall budget, null when none is set
};

export type CategoryTotal = { categoryId: string; name: string; total: number; percent: number }; // biggest first

export type DayTotal = { date: string; income: number; expense: number }; // one row per day of the month

// Every transaction write invalidates `Stats` (transactionsApi), so the dashboard refreshes by itself.
export const statsApi = api.injectEndpoints({
  endpoints: (builder) => ({
    getSummary: builder.query<MonthSummary, string>({
      query: (month) => ({ url: '/stats/summary', params: { month } }),
      providesTags: ['Stats', 'Budget'], // includes the overall budget
    }),
    getByCategory: builder.query<CategoryTotal[], string>({
      query: (month) => ({ url: '/stats/by-category', params: { month, type: 'expense' } }),
      providesTags: ['Stats', 'Category'], // the server names each slice
    }),
    getDaily: builder.query<DayTotal[], string>({
      query: (month) => ({ url: '/stats/daily', params: { month } }),
      providesTags: ['Stats'],
    }),
  }),
});

export const { useGetSummaryQuery, useGetByCategoryQuery, useGetDailyQuery } = statsApi;
