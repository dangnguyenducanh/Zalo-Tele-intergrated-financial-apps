import { createTheme, useMediaQuery } from '@mui/material';
import { useAppSelector } from '@/app/hooks';

export type ColorScheme = 'light' | 'dark';

// Green for money and income, red for expenses; each shade is readable on its own background.
export function getTheme(mode: ColorScheme) {
  const light = mode === 'light';
  return createTheme({
    palette: {
      mode,
      primary: { main: light ? '#1b7f3b' : '#66bb6a' },
      success: { main: light ? '#1b7f3b' : '#66bb6a' },
      error: { main: light ? '#c62828' : '#ef6c6c' },
      background: light ? { default: '#f5f7f5', paper: '#ffffff' } : { default: '#121412', paper: '#1c1f1c' },
    },
    shape: { borderRadius: 12 },
  });
}

// The scheme actually on screen: the user's choice, or the OS preference when the choice is "system".
// useMediaQuery listens for changes, so switching the OS theme updates the app live.
export function useColorScheme(): { scheme: ColorScheme; systemScheme: ColorScheme } {
  const themeMode = useAppSelector((s) => s.ui.themeMode);
  const systemScheme = useMediaQuery('(prefers-color-scheme: dark)') ? 'dark' : 'light';
  return { scheme: themeMode === 'system' ? systemScheme : themeMode, systemScheme };
}
