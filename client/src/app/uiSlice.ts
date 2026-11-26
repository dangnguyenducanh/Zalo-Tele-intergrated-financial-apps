import { createSlice, type Dispatch, type PayloadAction } from '@reduxjs/toolkit';
import i18n, { currentLanguage } from '@/i18n';
import type { Language, ThemeMode } from '@/types/api';
import { vnThisMonth } from '@/utils/vnToday';

// Shared UI state (docs/05 §5.3). Theme and language are mirrored to localStorage.

export const THEME_KEY = 'themeMode';

// "system" is stored as no value at all, so the app follows the OS until the user picks a theme.
export function readThemeMode(): ThemeMode {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    return saved === 'light' || saved === 'dark' ? saved : 'system';
  } catch {
    return 'system'; // storage blocked: still works, just not remembered
  }
}

function saveThemeMode(mode: ThemeMode) {
  try {
    if (mode === 'system') localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, mode);
  } catch {
    // storage blocked: the theme still applies for this visit
  }
}

export type Snackbar = { message: string; severity: 'success' | 'info' | 'warning' | 'error' };

type UiState = {
  themeMode: ThemeMode;
  language: Language;
  month: string; // "YYYY-MM", shared by the dashboard and budgets
  snackbar: Snackbar | null;
};

const uiSlice = createSlice({
  name: 'ui',
  initialState: (): UiState => ({ themeMode: readThemeMode(), language: currentLanguage(), month: vnThisMonth(), snackbar: null }),
  reducers: {
    themeModeChanged: (state, action: PayloadAction<ThemeMode>) => {
      state.themeMode = action.payload;
    },
    languageChanged: (state, action: PayloadAction<Language>) => {
      state.language = action.payload;
    },
    monthChanged: (state, action: PayloadAction<string>) => {
      state.month = action.payload;
    },
    showSnackbar: (state, action: PayloadAction<Snackbar>) => {
      state.snackbar = action.payload;
    },
    hideSnackbar: (state) => {
      state.snackbar = null;
    },
  },
});

export const { themeModeChanged, languageChanged, monthChanged, showSnackbar, hideSnackbar } = uiSlice.actions;
export default uiSlice.reducer;

// Thunks: change the state and do the side effects that belong with it.
export const applyThemeMode = (mode: ThemeMode) => (dispatch: Dispatch) => {
  saveThemeMode(mode);
  dispatch(themeModeChanged(mode));
};

export const applyLanguage = (language: Language) => (dispatch: Dispatch) => {
  void i18n.changeLanguage(language); // also saves it to localStorage and updates <html lang>
  dispatch(languageChanged(language));
};
