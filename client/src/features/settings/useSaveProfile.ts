import { getAccessToken, setSession } from '@/auth/session';
import { useUpdateMeMutation } from '@/auth/usersApi';
import type { UpdateMeInput } from '@/types/api';

// PATCH /users/me, then hands the saved user to AuthContext (same token, same user id), so the new name
// and default wallet show everywhere at once without logging in again. Rejects like RTK Query's unwrap().
export function useSaveProfile() {
  const [updateMe, { isLoading }] = useUpdateMeMutation();
  const save = async (changes: UpdateMeInput) => {
    const { user } = await updateMe(changes).unwrap();
    const accessToken = getAccessToken();
    if (accessToken) setSession({ accessToken, user });
  };
  return [save, isLoading] as const;
}
