import { Button, FormControl, FormControlLabel, FormHelperText, FormLabel, Paper, Radio, RadioGroup, Typography } from '@mui/material';
import { useId, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { applyLanguage, applyThemeMode, showSnackbar } from '@/app/uiSlice';
import { LANGUAGES } from '@/i18n';
import type { Language, ThemeMode } from '@/types/api';
import { useSaveProfile } from './useSaveProfile';

const THEMES: ThemeMode[] = ['light', 'dark', 'system'];
const LANGUAGE_NAMES: Record<Language, string> = { vi: 'Tiếng Việt', en: 'English' }; // each in its own language

// Language and theme (light / dark / system). Nothing changes until Save: then the choice applies on this
// device at once (uiSlice + localStorage) and is saved to the profile, so it follows the user and the bots
// reply in the new language. The radios show the current setting until the user picks something else,
// so a change made with the app bar buttons shows up here too.
export default function PreferencesForm() {
  const { t } = useTranslation('settings');
  const titleId = useId();
  const dispatch = useAppDispatch();
  const [save, busy] = useSaveProfile();
  const current = useAppSelector((s) => s.ui);
  const [picked, setPicked] = useState<{ language?: Language; theme?: ThemeMode }>({});
  const language = picked.language ?? current.language;
  const theme = picked.theme ?? current.themeMode;

  async function submit(event: FormEvent) {
    event.preventDefault();
    dispatch(applyThemeMode(theme));
    dispatch(applyLanguage(language));
    setPicked({});
    try {
      await save({ language, theme });
      dispatch(showSnackbar({ message: t('preferences.saved', { lng: language }), severity: 'success' }));
    } catch {
      dispatch(showSnackbar({ message: t('common:preferenceNotSaved', { lng: language }), severity: 'warning' }));
    }
  }

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Typography id={titleId} variant="h6" component="h2">
        {t('preferences.title')}
      </Typography>
      <form noValidate aria-labelledby={titleId} onSubmit={(event) => void submit(event)}>
        <FormControl component="fieldset" margin="normal" sx={{ display: 'flex' }}>
          <FormLabel component="legend">{t('preferences.language')}</FormLabel>
          <RadioGroup row name="language" value={language} onChange={(event) => setPicked({ ...picked, language: event.target.value as Language })}>
            {LANGUAGES.map((value) => (
              <FormControlLabel key={value} value={value} control={<Radio />} label={<span lang={value}>{LANGUAGE_NAMES[value]}</span>} />
            ))}
          </RadioGroup>
          <FormHelperText sx={{ mx: 0 }}>{t('preferences.languageHelp')}</FormHelperText>
        </FormControl>
        <FormControl component="fieldset" margin="normal" sx={{ display: 'flex' }}>
          <FormLabel component="legend">{t('preferences.theme')}</FormLabel>
          <RadioGroup row name="theme" value={theme} onChange={(event) => setPicked({ ...picked, theme: event.target.value as ThemeMode })}>
            {THEMES.map((value) => (
              <FormControlLabel key={value} value={value} control={<Radio />} label={t(`preferences.themes.${value}`)} />
            ))}
          </RadioGroup>
        </FormControl>
        <Button type="submit" variant="contained" loading={busy} sx={{ mt: 1 }}>
          {t('preferences.save')}
        </Button>
      </form>
    </Paper>
  );
}
