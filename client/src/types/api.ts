// Response shapes of the REST API (docs/04 §4.4). Features add their own types here.

export type Language = 'vi' | 'en';
export type ThemeMode = 'light' | 'dark' | 'system';

export type User = {
  id: string;
  email: string;
  name: string;
  role: 'user' | 'admin';
  status: 'active' | 'locked';
  language: Language;
  theme: ThemeMode;
  defaultWalletId: string | null;
};

// POST /auth/register, /auth/login and /auth/refresh all answer with this.
export type AuthResponse = { accessToken: string; user: User };

export type RegisterInput = { name: string; email: string; password: string; language: Language };

export type UpdateMeInput = Partial<Pick<User, 'name' | 'language' | 'theme' | 'defaultWalletId'>>;

// POST /chat-links/claim/preview: the chat a claim token ("tap to link" in a chat) would link.
export type ClaimPreview = { platform: 'telegram' | 'zalo' | 'whatsapp'; displayName: string };

// Every API error has this shape (docs/04 §4.5).
export type ApiError = { error: { code: string; message: string; details?: unknown } };

export function isApiError(value: unknown): value is ApiError {
  if (typeof value !== 'object' || value === null || !('error' in value)) return false;
  const { error } = value as { error: unknown };
  return typeof error === 'object' && error !== null && typeof (error as { code?: unknown }).code === 'string';
}
