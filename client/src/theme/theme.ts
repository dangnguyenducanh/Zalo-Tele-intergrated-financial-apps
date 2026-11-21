import { alpha, createTheme, useMediaQuery, type Theme } from '@mui/material';
import { useAppSelector } from '@/app/hooks';

export type ColorScheme = 'light' | 'dark';

declare module '@mui/material/styles' {
  interface Palette {
    sidebar: string; // the side drawer
    panel2: string; // a soft step above a card: tiles, hover rows, chips
    track: string; // empty part of a progress bar or chart
    spend: string; // money going out (draft 3: pink)
    income: string; // money coming in (draft 3: sky)
  }
  interface PaletteOptions {
    sidebar?: string;
    panel2?: string;
    track?: string;
    spend?: string;
    income?: string;
  }
}

// Self-hosted Be Vietnam Pro (main.tsx imports 300–600); its Vietnamese subset draws every diacritic.
export const FONT_SANS = '"Be Vietnam Pro", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
export const FONT_MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

// Draft 3 (T18): soft, rounded consumer-finance look. Inputs 12px, cards 20px, buttons and chips are pills.
export const RADIUS = { control: 12, panel: 20, pill: 999 } as const;

// The brand gradient, sky to pink. Deep enough that white text on it keeps 4.5:1 in both themes;
// the pastel version is only used behind large text or as decoration.
export const GRADIENT = 'linear-gradient(120deg, #0369a1 0%, #2563eb 50%, #be185d 100%)';
export const GRADIENT_SOFT = 'linear-gradient(120deg, #38bdf8 0%, #f472b6 100%)';

// Amounts use tabular digits, so columns of money line up.
export const moneySx = { fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.01em' } as const;

// The round outlined icon buttons of the app bar.
export const squareButtonSx = { width: 36, height: 36, borderRadius: '50%', border: 1, borderColor: (theme: Theme) => strongLine(theme), bgcolor: 'background.paper' } as const;

// Motion tokens: quick to answer the pointer, a little slower to let go (design-taste-frontend motion.md).
const EASE = 'cubic-bezier(.2,.8,.2,1)';
const HOVER_MS = 140;
const PRESS_MS = 90;
// Spatial hover/press moves only for a fine pointer and only when the user has not asked for less motion;
// colour changes stay on for everyone (modern-web-guidance `motion`, `natural-interactions`).
export const POINTER_MOTION = '@media (hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)';

// Light: white cards on a pale sky ground. Dark: navy cards on a deep navy ground. Same roles in both.
// Every text colour keeps 4.5:1 on its ground (checked by the axe suite, TC-NF-03).
const PALETTES = {
  light: {
    primary: { main: '#0369a1', dark: '#075985', light: '#0ea5e9', contrastText: '#ffffff' },
    secondary: { main: '#475569' },
    success: { main: '#047857' },
    error: { main: '#dc2626' },
    warning: { main: '#b45309' },
    info: { main: '#0369a1' },
    background: { default: '#f3f8fd', paper: '#ffffff' },
    sidebar: '#eaf4fc',
    panel2: '#f1f6fb',
    track: '#e2e8f0',
    spend: '#db2777',
    income: '#0369a1',
    text: { primary: '#0f172a', secondary: '#475569' },
    divider: '#e2e8f0',
  },
  dark: {
    primary: { main: '#38bdf8', dark: '#0ea5e9', light: '#7dd3fc', contrastText: '#082f49' },
    secondary: { main: '#94a3b8' },
    success: { main: '#34d399' },
    error: { main: '#f87171' },
    warning: { main: '#fbbf24' },
    info: { main: '#7dd3fc' },
    background: { default: '#0a1222', paper: '#111b2e' },
    sidebar: '#0d1628',
    panel2: '#17233b',
    track: '#1e2a40',
    spend: '#f472b6',
    income: '#38bdf8',
    text: { primary: '#e2e8f0', secondary: '#94a3b8' },
    divider: '#1e2a40',
  },
} as const;

// Text-coloured links and selected states: deep sky on light grounds, light sky on navy.
export const linkColor = (theme: Theme) => (theme.palette.mode === 'dark' ? theme.palette.primary.light : theme.palette.primary.main);
export const strongLine = (theme: Theme) => (theme.palette.mode === 'dark' ? '#2a3a57' : '#cbd5e1');

const softShadow = (theme: Theme) =>
  theme.palette.mode === 'light' ? '0 10px 30px -18px rgba(15, 23, 42, 0.25)' : '0 10px 30px -14px rgba(0, 0, 0, 0.6)';
const popupShadow = (theme: Theme) =>
  theme.palette.mode === 'light' ? '0 18px 40px -16px rgba(15, 23, 42, 0.28)' : '0 18px 40px -12px rgba(0, 0, 0, 0.75)';

export function getTheme(mode: ColorScheme) {
  return createTheme({
    palette: { mode, ...PALETTES[mode] },
    shape: { borderRadius: RADIUS.control },
    typography: {
      fontFamily: FONT_SANS,
      fontSize: 14,
      h1: { fontWeight: 300, letterSpacing: '-0.025em' },
      h2: { fontWeight: 300, letterSpacing: '-0.02em' },
      h3: { fontWeight: 300, letterSpacing: '-0.02em' },
      h4: { fontWeight: 300, fontSize: '2rem', letterSpacing: '-0.02em', lineHeight: 1.2 },
      h5: { fontWeight: 300, fontSize: '1.625rem', letterSpacing: '-0.02em', lineHeight: 1.25 },
      h6: { fontWeight: 500, fontSize: '0.9375rem', letterSpacing: '0', lineHeight: 1.4 },
      subtitle1: { fontWeight: 500 },
      subtitle2: { fontWeight: 500 },
      body2: { fontSize: '0.8125rem' },
      button: { textTransform: 'none', fontWeight: 500, letterSpacing: 0 },
      overline: { fontWeight: 600, letterSpacing: '0.06em', fontSize: '0.71875rem', lineHeight: 1.6 },
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: (theme) => ({
          ':root': { '--font-mono': FONT_MONO },
          body: {
            // A pale sky wash behind the top of every page (light) or a navy one (dark), like the draft.
            backgroundImage:
              theme.palette.mode === 'light'
                ? 'linear-gradient(180deg, #e3f1fd 0, #f3f8fd 360px)'
                : 'linear-gradient(180deg, #0f1d36 0, #0a1222 360px)',
            backgroundRepeat: 'no-repeat',
            // The fallback is scaled to Be Vietnam Pro's x-height, so text does not jump when the font arrives
            // (modern-web-guidance `visually-stable-font-fallbacks`).
            fontSizeAdjust: 'from-font',
            WebkitFontSmoothing: 'antialiased',
          },
          '::selection': { backgroundColor: alpha(theme.palette.primary.main, 0.3) },
          // One visible focus ring for plain links and focusable regions; MUI controls get theirs from MuiButtonBase.
          'a:focus-visible, [tabindex]:focus-visible': { outline: `2px solid ${linkColor(theme)}`, outlineOffset: 2 },
        }),
      },
      MuiButtonBase: {
        defaultProps: { disableRipple: true },
        styleOverrides: {
          // With the ripple off, keyboard focus needs its own ring (WCAG 2.4.7, 3:1 against the ground).
          root: ({ theme }) => ({ '&.Mui-focusVisible': { outline: `2px solid ${linkColor(theme)}`, outlineOffset: 2 } }),
        },
      },
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: {
          root: ({ theme }) => ({
            borderRadius: RADIUS.pill,
            paddingInline: 16,
            minHeight: 38,
            transition: theme.transitions.create(['background-color', 'border-color', 'color', 'box-shadow', 'transform'], { duration: HOVER_MS, easing: EASE }),
            [POINTER_MOTION]: {
              '&:hover': { transform: 'translateY(-1px)' },
              '&:active': { transform: 'translateY(1px) scale(0.985)', transitionDuration: `${PRESS_MS}ms` },
            },
          }),
          // The main action carries the brand gradient with white text in both themes.
          contained: ({ ownerState }) =>
            (ownerState.color ?? 'primary') === 'primary'
              ? {
                  backgroundImage: GRADIENT,
                  backgroundColor: '#0369a1',
                  color: '#ffffff',
                  boxShadow: '0 8px 20px -10px rgba(190, 24, 93, 0.55)',
                  '&:hover': { backgroundColor: '#0369a1', boxShadow: '0 10px 24px -10px rgba(190, 24, 93, 0.7)' },
                }
              : {},
          sizeSmall: { minHeight: 30, paddingInline: 12, fontSize: '0.8125rem' },
          sizeLarge: { minHeight: 46, fontSize: '0.9375rem' },
          outlined: ({ theme }) => ({ borderColor: theme.palette.mode === 'dark' ? '#2a3a57' : '#7dd3fc', color: linkColor(theme), backgroundColor: theme.palette.background.paper }),
          text: ({ theme }) => ({ color: linkColor(theme) }),
        },
      },
      MuiIconButton: {
        styleOverrides: {
          root: ({ theme }) => ({
            transition: theme.transitions.create(['background-color', 'color', 'transform'], { duration: HOVER_MS, easing: EASE }),
            [POINTER_MOTION]: { '&:active': { transform: 'scale(0.94)', transitionDuration: `${PRESS_MS}ms` } },
          }),
        },
      },
      MuiPaper: {
        defaultProps: { elevation: 0 },
        styleOverrides: {
          root: { backgroundImage: 'none' },
          rounded: { borderRadius: RADIUS.panel },
          outlined: ({ theme }) => ({ borderColor: theme.palette.divider, boxShadow: softShadow(theme) }),
        },
      },
      MuiCard: { defaultProps: { variant: 'outlined' } },
      MuiCardContent: { styleOverrides: { root: { padding: 18, '&:last-child': { paddingBottom: 18 } } } },
      MuiAppBar: {
        styleOverrides: {
          root: ({ theme }) => ({
            backgroundColor: alpha(theme.palette.background.default, 0.82),
            backdropFilter: 'saturate(1.4) blur(10px)',
            color: theme.palette.text.primary,
          }),
        },
      },
      MuiToolbar: { styleOverrides: { root: { minHeight: 64, '@media (min-width:600px)': { minHeight: 64 } } } },
      MuiDrawer: { styleOverrides: { paper: ({ theme }) => ({ backgroundColor: theme.palette.sidebar, borderColor: theme.palette.divider }) } },
      MuiListItemButton: { styleOverrides: { root: { borderRadius: RADIUS.pill } } },
      MuiListItemIcon: { styleOverrides: { root: { minWidth: 32 } } },
      MuiMenu: { styleOverrides: { paper: ({ theme }) => ({ marginTop: 6, borderRadius: 16, boxShadow: popupShadow(theme), border: `1px solid ${theme.palette.divider}` }) } },
      MuiPopover: { styleOverrides: { paper: ({ theme }) => ({ boxShadow: popupShadow(theme), border: `1px solid ${theme.palette.divider}` }) } },
      MuiMenuItem: { styleOverrides: { root: { borderRadius: 10, marginInline: 6, minHeight: 38, fontSize: '0.875rem' } } },
      MuiDialog: { styleOverrides: { paper: ({ theme }) => ({ borderRadius: 24, boxShadow: popupShadow(theme), border: `1px solid ${theme.palette.divider}` }) } },
      MuiDialogTitle: { styleOverrides: { root: { fontWeight: 400, fontSize: '1.25rem', letterSpacing: '-0.01em' } } },
      MuiOutlinedInput: {
        styleOverrides: {
          root: ({ theme }) => ({
            borderRadius: RADIUS.control,
            backgroundColor: theme.palette.mode === 'light' ? theme.palette.panel2 : theme.palette.background.paper,
            '& .MuiOutlinedInput-notchedOutline': { borderColor: theme.palette.divider },
            '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: strongLine(theme) },
            '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderWidth: 1, borderColor: linkColor(theme) },
            '&.Mui-focused': { boxShadow: `0 0 0 3px ${alpha(theme.palette.primary.light, 0.25)}` },
          }),
        },
      },
      MuiTableCell: {
        styleOverrides: {
          root: ({ theme }) => ({ borderBottomColor: theme.palette.divider, fontSize: '0.8125rem', paddingBlock: 12 }),
          head: ({ theme }) => ({ fontWeight: 600, fontSize: '0.71875rem', letterSpacing: '0.06em', textTransform: 'uppercase', color: theme.palette.text.secondary, backgroundColor: theme.palette.background.paper }),
        },
      },
      MuiTableRow: {
        styleOverrides: {
          root: ({ theme }) => ({
            transition: theme.transitions.create('background-color', { duration: HOVER_MS }),
            'tbody &:hover': { backgroundColor: theme.palette.panel2 },
            'tbody &:last-of-type > td': { borderBottom: 0 },
          }),
        },
      },
      MuiChip: {
        styleOverrides: {
          root: ({ theme }) => ({
            borderRadius: RADIUS.pill,
            fontWeight: 500,
            height: 24,
            fontSize: '0.75rem',
            '&.MuiChip-colorPrimary.MuiChip-outlined, &.MuiChip-outlinedPrimary': { color: linkColor(theme), borderColor: linkColor(theme) },
          }),
          label: { paddingInline: 8 },
        },
      },
      MuiAlert: {
        styleOverrides: {
          root: ({ theme, ownerState }) => ({
            borderRadius: 16,
            border: `1px solid ${alpha(theme.palette[ownerState.severity ?? 'info'].main, 0.35)}`,
            alignItems: 'center',
          }),
        },
      },
      MuiLinearProgress: {
        styleOverrides: {
          root: ({ theme }) => ({ height: 6, borderRadius: 3, backgroundColor: theme.palette.track }),
          bar: { borderRadius: 3 },
        },
      },
      MuiTooltip: {
        styleOverrides: {
          tooltip: { backgroundColor: '#0f2a5f', color: '#ffffff', fontSize: '0.75rem', fontWeight: 400, borderRadius: 10 },
        },
      },
      MuiLink: {
        defaultProps: { underline: 'hover' },
        styleOverrides: {
          root: ({ theme }) => ({
            color: linkColor(theme),
            fontWeight: 500,
            textUnderlineOffset: 3,
            transition: theme.transitions.create('text-decoration-color', { duration: HOVER_MS, easing: EASE }),
          }),
        },
      },
      MuiAvatar: { styleOverrides: { root: { fontWeight: 600 } } },
      MuiBottomNavigation: { styleOverrides: { root: { backgroundColor: 'transparent', height: 64 } } },
      MuiBottomNavigationAction: {
        styleOverrides: { root: ({ theme }) => ({ color: theme.palette.text.secondary, '&.Mui-selected': { color: '#ffffff' } }) },
      },
      MuiToggleButtonGroup: { styleOverrides: { root: ({ theme }) => ({ backgroundColor: theme.palette.panel2, borderRadius: RADIUS.pill, padding: 3, gap: 2 }) } },
      MuiToggleButton: {
        styleOverrides: {
          root: ({ theme }) => ({
            textTransform: 'none',
            fontWeight: 500,
            border: 0,
            borderRadius: `${RADIUS.pill}px !important`,
            paddingBlock: 5,
            paddingInline: 14,
            color: theme.palette.text.secondary,
            '&.Mui-selected': { color: linkColor(theme), backgroundColor: theme.palette.background.paper, boxShadow: softShadow(theme) },
            '&.Mui-selected:hover': { backgroundColor: theme.palette.background.paper },
          }),
        },
      },
      MuiTab: { styleOverrides: { root: ({ theme }) => ({ textTransform: 'none', fontWeight: 500, '&.Mui-selected': { color: linkColor(theme) } }) } },
      // Small text in the accent colour (focused labels) uses the readable sky on navy.
      MuiFormLabel: { styleOverrides: { root: ({ theme }) => ({ '&.Mui-focused': { color: linkColor(theme) } }) } },
    },
  });
}

// The scheme actually on screen: the user's choice, or the OS preference when the choice is "system".
// useMediaQuery listens for changes, so switching the OS theme updates the app live.
export function useColorScheme(): { scheme: ColorScheme; systemScheme: ColorScheme } {
  const themeMode = useAppSelector((s) => s.ui.themeMode);
  const systemScheme = useMediaQuery('(prefers-color-scheme: dark)') ? 'dark' : 'light';
  return { scheme: themeMode === 'system' ? systemScheme : themeMode, systemScheme };
}
