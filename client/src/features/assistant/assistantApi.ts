import { api } from '@/app/api';
import type { ParseResult } from '@/features/transactions/transactionsApi';

// Response shapes of /api/assistant (docs/04 §4.4 Assistant, server/src/routes/assistant.js). The browser only ever talks to
// Express; the agent service behind it is never called from here (docs/05 §5.10).

export type Fact = { id: string; label: string; display: string };

// What a turn carries besides its text. Only the ask-back is drawn here (docs/02 §2.11.3); other kinds (the action card, T69) are ignored.
export type Card = { kind: string; options?: { n: number; label: string }[] };

// rules and agent come from the agent service, fallback is the template after the guard refused the wording, capped is the daily limit,
// off means no agent service is configured (the help text), capture is Express's own answer to "phở 45k" (the quick-add preview).
export type AssistantRoute = 'rules' | 'agent' | 'fallback' | 'capped' | 'off' | 'capture';

export type ChatInput = { message: string; month?: string; requestId: string };
export type ChatAnswer = {
  route: AssistantRoute;
  text?: string; // absent for a capture
  facts?: Fact[];
  sources?: string[];
  followups?: string[];
  card?: Card;
  capture?: ParseResult;
  remainingToday: number;
};

// One question and its answer, from GET /assistant/thread or added here once a chat call answered.
export type ThreadTurn = {
  id: string;
  question: string | null;
  text?: string;
  route: AssistantRoute;
  facts: Fact[];
  sources: string[];
  followups: string[];
  card?: Card;
  capture?: ParseResult; // only a turn answered in this visit: a capture leaves no row for the thread to return
  createdAt: string;
};
export type Thread = { turns: ThreadTurn[]; ai: { remainingToday: number } };

const turnOf = (input: ChatInput, data: ChatAnswer): ThreadTurn => ({
  id: input.requestId, // the server's id is not known yet; the next load of the thread replaces it
  question: input.message,
  text: data.text,
  route: data.route,
  facts: data.facts ?? [],
  sources: data.sources ?? [],
  followups: data.followups ?? [],
  card: data.card,
  capture: data.capture,
  createdAt: new Date().toISOString(),
});

export const assistantApi = api.injectEndpoints({
  endpoints: (builder) => ({
    getThread: builder.query<Thread, void>({
      query: () => '/assistant/thread',
      providesTags: ['AssistantThread'],
    }),
    // The agent keeps its own row for every answered question, so a reload shows it; until then the answer is put into the cached thread.
    chat: builder.mutation<ChatAnswer, ChatInput>({
      query: (body) => ({ url: '/assistant/chat', method: 'POST', body }),
      async onQueryStarted(input, { dispatch, queryFulfilled }) {
        try {
          const { data } = await queryFulfilled;
          const turn = turnOf(input, data);
          const patch = dispatch(
            assistantApi.util.updateQueryData('getThread', undefined, (thread) => {
              thread.turns.push(turn);
              thread.ai.remainingToday = data.remainingToday;
            }),
          );
          // No cached thread (its own request failed): start one, so the answer is still on screen.
          if (patch.patches.length === 0) dispatch(assistantApi.util.upsertQueryData('getThread', undefined, { turns: [turn], ai: { remainingToday: data.remainingToday } }));
        } catch {
          // the caller shows the failure
        }
      },
    }),
    // "Xoá" hides the thread. It gives no question back: the server counts every question of the day (docs/02 §2.11.6).
    clearThread: builder.mutation<void, void>({
      query: () => ({ url: '/assistant/thread', method: 'DELETE' }),
      async onQueryStarted(_arg, { dispatch, queryFulfilled }) {
        try {
          await queryFulfilled;
          dispatch(
            assistantApi.util.updateQueryData('getThread', undefined, (thread) => {
              thread.turns = [];
            }),
          );
        } catch {
          // the caller shows the failure
        }
      },
    }),
  }),
});

export const { useGetThreadQuery, useChatMutation, useClearThreadMutation } = assistantApi;
