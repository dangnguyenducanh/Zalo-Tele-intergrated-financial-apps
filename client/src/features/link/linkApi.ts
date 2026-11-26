import { api } from '@/app/api';
import type { ChatLink } from '@/features/bot/botApi';
import type { ClaimPreview } from '@/types/api';

// The claim endpoints (docs/04 §4.4). A claim token travels in the request body only, never in a URL.
export const linkApi = api.injectEndpoints({
  endpoints: (builder) => ({
    previewClaim: builder.query<ClaimPreview, string>({
      query: (token) => ({ url: '/chat-links/claim/preview', method: 'POST', body: { token } }),
      keepUnusedDataFor: 0, // a token can die at any moment: ask again every time the screen opens
    }),
    claimChat: builder.mutation<ChatLink, string>({
      query: (token) => ({ url: '/chat-links/claim', method: 'POST', body: { token } }),
      invalidatesTags: ['ChatLink'],
    }),
    // Invalidates after an error too, so the notice of a link unlinked meanwhile (404) leaves with the reload.
    dismissClaimNotice: builder.mutation<void, string>({
      query: (id) => ({ url: `/chat-links/${id}/claim-notice`, method: 'PATCH' }),
      invalidatesTags: ['ChatLink'],
    }),
  }),
});

export const { usePreviewClaimQuery, useClaimChatMutation, useDismissClaimNoticeMutation } = linkApi;
