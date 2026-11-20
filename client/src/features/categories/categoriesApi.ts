import { api } from '@/app/api';
import type { Language } from '@/types/api';

// Response shapes of /api/categories (docs/04 §4.4, server/src/models/Category.js).
export type CategoryType = 'expense' | 'income';

export type Category = {
  id: string;
  type: CategoryType;
  name?: string; // set for user-made categories, or when the user renamed a default copy
  names?: { vi: string; en: string }; // default copies: shown in the UI language
  keywords: string[]; // bot keywords, lower-case without diacritics
  icon: string; // a Material icon name, see icons.ts
  color: string;
  isFallback: boolean; // "Khác / Other": receives the transactions of deleted categories
};

export type CategoryInput = Pick<Category, 'type' | 'name' | 'keywords' | 'icon' | 'color'>;
export type CategoryChanges = Partial<Omit<CategoryInput, 'type'>>; // the type cannot change

// Default categories show names[lang]; user categories show name (docs/05 §5.6).
export function categoryName(category: Category, lang: Language): string {
  return category.name || category.names?.[lang] || category.names?.vi || '';
}

export const categoriesApi = api.injectEndpoints({
  endpoints: (builder) => ({
    getCategories: builder.query<Category[], { type?: CategoryType } | void>({
      query: (arg) => ({ url: '/categories', params: arg?.type ? { type: arg.type } : undefined }),
      providesTags: ['Category'],
    }),
    createCategory: builder.mutation<Category, CategoryInput>({
      query: (body) => ({ url: '/categories', method: 'POST', body }),
      invalidatesTags: ['Category'],
    }),
    updateCategory: builder.mutation<Category, { id: string } & CategoryChanges>({
      query: ({ id, ...body }) => ({ url: `/categories/${id}`, method: 'PATCH', body }),
      invalidatesTags: ['Category'],
    }),
    // The server moves the category's transactions to the fallback, so transaction lists and stats change too.
    deleteCategory: builder.mutation<void, string>({
      query: (id) => ({ url: `/categories/${id}`, method: 'DELETE' }),
      invalidatesTags: ['Category', 'Transaction', 'Stats'],
    }),
  }),
});

export const { useGetCategoriesQuery, useCreateCategoryMutation, useUpdateCategoryMutation, useDeleteCategoryMutation } = categoriesApi;
