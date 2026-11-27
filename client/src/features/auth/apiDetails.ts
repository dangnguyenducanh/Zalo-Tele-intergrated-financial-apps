// A number from an API error's `details` (attemptsLeft on CODE_INVALID, retryAfter on RATE_LIMITED), or undefined.
export const numberIn = (details: unknown, key: string) => {
  const value = (details as Record<string, unknown> | null)?.[key];
  return typeof value === 'number' ? value : undefined;
};
