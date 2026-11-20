import { Button } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { applyLanguage, showSnackbar } from '@/app/uiSlice';
import { useAuth } from '@/auth/useAuth';
import { useUpdateMeMutation } from '@/auth/usersApi';

// Switches between Vietnamese and English. When logged in, the choice is also saved to the profile,
// which changes the language the bots reply in.
export default function LanguageSwitch() {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const language = useAppSelector((s) => s.ui.language);
  const { user } = useAuth();
  const [updateMe] = useUpdateMeMutation();
  const next = language === 'vi' ? 'en' : 'vi';

  function change() {
    dispatch(applyLanguage(next));
    if (user) {
      updateMe({ language: next })
        .unwrap()
        .catch(() => dispatch(showSnackbar({ message: t('preferenceNotSaved', { lng: next }), severity: 'warning' })));
    }
  }

  return (
    <Button color="inherit" aria-label={t('language.switch')} onClick={change} sx={{ minWidth: 48 }}>
      {next.toUpperCase()}
    </Button>
  );
}
