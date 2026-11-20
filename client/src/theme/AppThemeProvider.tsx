import { CssBaseline, ThemeProvider } from '@mui/material';
import { useEffect, useMemo, type ReactNode } from 'react';
import { useAppDispatch } from '@/app/hooks';
import { readThemeMode, THEME_KEY, themeModeChanged } from '@/app/uiSlice';
import { getTheme, useColorScheme } from './theme';

export function AppThemeProvider({ children }: { children: ReactNode }) {
  const dispatch = useAppDispatch();
  const { scheme } = useColorScheme();
  const theme = useMemo(() => getTheme(scheme), [scheme]);

  // Another tab changed the theme: follow it.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === THEME_KEY || event.key === null) dispatch(themeModeChanged(readThemeMode()));
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [dispatch]);

  return (
    <ThemeProvider theme={theme}>
      {/* enableColorScheme sets `color-scheme` on <html>, so scrollbars and form controls follow the theme */}
      <CssBaseline enableColorScheme />
      {children}
    </ThemeProvider>
  );
}
