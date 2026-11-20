import { useGetTransactionsQuery } from './transactionsApi';

// Drafts waiting in the bot inbox, for the badge in the navigation. Same cached query as the dashboard banner.
export function useDraftCount(): number {
  const { data } = useGetTransactionsQuery({ status: 'draft' });
  return data?.total ?? 0;
}
