// The letters on a user's avatar: the first letters of the last two words. Vietnamese names put the given
// name last, so "Nguyễn Văn An" → "VA". The app bar and the drawer both use this, so they always match.
export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(-2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');
