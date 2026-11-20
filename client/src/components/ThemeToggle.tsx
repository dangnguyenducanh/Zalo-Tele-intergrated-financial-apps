import { IconButton, Tooltip } from '@mui/material';
import { Moon, Sun } from '@/components/icons';
import { useTranslation } from 'react-i18next';
import { useAppDispatch } from '@/app/hooks';
import { applyThemeMode, showSnackbar } from '@/app/uiSlice';
import { useAuth } from '@/auth/useAuth';
import { useUpdateMeMutation } from '@/auth/usersApi';
import { squareButtonSx, useColorScheme } from '@/theme/theme';
import type { ThemeMode } from '@/types/api';

// Two-state toggle (modern-web-guidance `dark-mode-toggle`): it always switches to the opposite of
// what is on screen. Picking the scheme the OS already uses means "follow the system" again, so
// "system" is stored instead of pinning the theme. The full light/dark/system choice is in Settings.
export default function ThemeToggle() {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const { user } = useAuth();
  const [updateMe] = useUpdateMeMutation();
  const { scheme, systemScheme } = useColorScheme();
  const target = scheme === 'dark' ? 'light' : 'dark';
  const label = t(target === 'dark' ? 'theme.toDark' : 'theme.toLight');

  function toggle() {
    const next: ThemeMode = target === systemScheme ? 'system' : target;
    dispatch(applyThemeMode(next));
    if (user) {
      updateMe({ theme: next })
        .unwrap()
        .catch(() => dispatch(showSnackbar({ message: t('preferenceNotSaved'), severity: 'warning' })));
    }
  }

  return (
    <Tooltip title={label}>
      <IconButton color="inherit" aria-label={label} onClick={toggle} sx={squareButtonSx}>
        {target === 'dark' ? <Moon size={17} strokeWidth={1.75} aria-hidden /> : <Sun size={17} strokeWidth={1.75} aria-hidden />}
      </IconButton>
    </Tooltip>
  );
}
