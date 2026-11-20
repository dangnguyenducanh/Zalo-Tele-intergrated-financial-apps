import { Button } from '@mui/material';
import { Languages } from '@/components/icons';
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

  const label = next.toUpperCase();
  // WCAG 2.5.3 Label in Name: the accessible name starts with the visible text, so "click EN" works by voice.
  return (
    <Button variant="outlined" aria-label={`${label} – ${t('language.switch')}`} onClick={change} sx={{ minWidth: 48, height: 34, gap: 0.75 }}>
      <Languages size={15} strokeWidth={1.75} aria-hidden />
      {label}
    </Button>
  );
}
