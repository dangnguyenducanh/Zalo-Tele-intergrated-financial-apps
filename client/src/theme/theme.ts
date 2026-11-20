import { alpha, createTheme, useMediaQuery, type Theme } from '@mui/material';
import { useAppSelector } from '@/app/hooks';

export type ColorScheme = 'light' | 'dark';

declare module '@mui/material/styles' {
  interface Palette {
    sidebar: string; // the side drawer and page ground
    panel2: string; // a step above a panel: table heads, selected nav item, segmented "on" state
    track: string; // empty part of a progress bar
  }
  interface PaletteOptions {
    sidebar?: string;
    panel2?: string;
    track?: string;
  }
}

// Self-hosted variable fonts (main.tsx imports them); both cover Vietnamese, so no glyph falls back mid-word.
export const FONT_SANS = '"Chivo Variable", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
export const FONT_MONO = '"Chivo Mono Variable", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

// Sharp corners for a finance tool (design-taste-frontend: radius "sharp" for fintech): 4px controls, 6px panels.
export const RADIUS = { control: 4, panel: 6 } as const;

// Amounts use tabular digits, so columns of money line up like a ledger.
export const moneySx = { fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.01em' } as const;

// The bordered square of the app bar's icon buttons (draft 2: no circles).
export const squareButtonSx = { width: 34, height: 34, border: 1, borderColor: (theme: Theme) => strongLine(theme) } as const;

// Motion tokens: quick to answer the pointer, a little slower to let go (design-taste-frontend motion.md).
const EASE = 'cubic-bezier(.2,.8,.2,1)';
const HOVER_MS = 140;
const PRESS_MS = 90;
// Spatial hover/press moves only for a fine pointer and only when the user has not asked for less motion;
// colour changes stay on for everyone (modern-web-guidance `motion`, `natural-interactions`).
export const POINTER_MOTION = '@media (hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)';

// Near-black or near-white grounds, one blue accent, green/red only for money and status (draft 2, T17).
// Every text colour keeps 4.5:1 on its ground (checked by the axe suite, TC-NF-03).
const PALETTES = {
  light: {
    primary: { main: '#1d5bd8', dark: '#1748ad', light: '#4b7fe3', contrastText: '#ffffff' },
    secondary: { main: '#475467' },
    success: { main: '#067647' },
    error: { main: '#d92d20' },
    warning: { main: '#b54708' },
    info: { main: '#1d5bd8' },
    background: { default: '#f6f7f9', paper: '#ffffff' },
    sidebar: '#f6f7f9',
    panel2: '#f2f4f7',
    track: '#eaecf0',
    text: { primary: '#101828', secondary: '#475467' },
    divider: '#e4e7ec',
  },
  dark: {
    primary: { main: '#2f6fed', dark: '#2559c4', light: '#7da6ff', contrastText: '#ffffff' },
    secondary: { main: '#a3abb5' },
    success: { main: '#3fb950' },
    error: { main: '#f2555a' },
    warning: { main: '#d6a03a' },
    info: { main: '#7da6ff' },
    background: { default: '#0b0d10', paper: '#111418' },
    sidebar: '#0b0d10',
    panel2: '#161a1f',
    track: '#1c2128',
    text: { primary: '#e6e8eb', secondary: '#a3abb5' },
    divider: '#1f252c',
  },
} as const;

// Text-coloured links and selected states need a lighter blue on dark grounds (the fill blue is too dark to read).
export const linkColor = (theme: Theme) => (theme.palette.mode === 'dark' ? theme.palette.primary.light : theme.palette.primary.main);
export const strongLine = (theme: Theme) => (theme.palette.mode === 'dark' ? '#2b323b' : '#d0d5dd');

const popupShadow = (theme: Theme) =>
  theme.palette.mode === 'light' ? '0 12px 32px -12px rgba(16, 24, 40, 0.18), 0 2px 4px rgba(16, 24, 40, 0.05)' : '0 12px 32px -8px rgba(0, 0, 0, 0.7)';

export function getTheme(mode: ColorScheme) {
  return createTheme({
    palette: { mode, ...PALETTES[mode] },
    shape: { borderRadius: RADIUS.control },
    typography: {
      fontFamily: FONT_SANS,
      fontSize: 14,
      h1: { fontWeight: 600, letterSpacing: '-0.025em' },
      h2: { fontWeight: 600, letterSpacing: '-0.02em' },
      h3: { fontWeight: 600, letterSpacing: '-0.02em' },
      h4: { fontWeight: 600, fontSize: '1.625rem', letterSpacing: '-0.02em', lineHeight: 1.25 },
      h5: { fontWeight: 600, fontSize: '1.25rem', letterSpacing: '-0.015em', lineHeight: 1.3 },
      h6: { fontWeight: 600, fontSize: '0.9375rem', letterSpacing: '-0.005em', lineHeight: 1.4 },
      subtitle1: { fontWeight: 500 },
      subtitle2: { fontWeight: 500 },
      body2: { fontSize: '0.8125rem' },
      button: { textTransform: 'none', fontWeight: 500, letterSpacing: 0 },
      overline: { fontWeight: 500, letterSpacing: '0.06em' },
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: (theme) => ({
          ':root': { '--font-mono': FONT_MONO },
          body: {
            // The fallback is scaled to Chivo's x-height, so text does not jump when the font arrives
            // (modern-web-guidance `visually-stable-font-fallbacks`).
            fontSizeAdjust: 'from-font',
            WebkitFontSmoothing: 'antialiased',
          },
          '::selection': { backgroundColor: alpha(theme.palette.primary.main, 0.3) },
          // One visible focus ring for plain links and focusable regions; MUI controls get theirs from MuiButtonBase.
          'a:focus-visible, [tabindex]:focus-visible': { outline: `2px solid ${theme.palette.primary.main}`, outlineOffset: 2 },
        }),
      },
      MuiButtonBase: {
        defaultProps: { disableRipple: true },
        styleOverrides: {
          // With the ripple off, keyboard focus needs its own ring (WCAG 2.4.7, 3:1 against the ground).
          root: ({ theme }) => ({ '&.Mui-focusVisible': { outline: `2px solid ${theme.palette.primary.main}`, outlineOffset: 2 } }),
        },
      },
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: {
          root: ({ theme }) => ({
            borderRadius: RADIUS.control,
            paddingInline: 12,
            minHeight: 34,
            transition: theme.transitions.create(['background-color', 'border-color', 'color', 'transform'], { duration: HOVER_MS, easing: EASE }),
            [POINTER_MOTION]: {
              '&:hover': { transform: 'translateY(-1px)' },
              '&:active': { transform: 'translateY(1px) scale(0.985)', transitionDuration: `${PRESS_MS}ms` },
            },
          }),
          sizeSmall: { minHeight: 28, paddingInline: 10, fontSize: '0.8125rem' },
          sizeLarge: { minHeight: 42, fontSize: '0.9375rem' },
          outlined: ({ theme }) => ({ borderColor: strongLine(theme), color: theme.palette.text.primary, '&:hover': { borderColor: theme.palette.text.secondary } }),
          text: ({ theme }) => ({ color: linkColor(theme) }),
        },
      },
      MuiIconButton: {
        styleOverrides: {
          root: ({ theme }) => ({
            borderRadius: RADIUS.control,
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
          outlined: ({ theme }) => ({ borderColor: theme.palette.divider }),
        },
      },
      MuiCard: { defaultProps: { variant: 'outlined' } },
      MuiCardContent: { styleOverrides: { root: { padding: 16, '&:last-child': { paddingBottom: 16 } } } },
      MuiAppBar: {
        styleOverrides: {
          root: ({ theme }) => ({ backgroundColor: theme.palette.background.default, color: theme.palette.text.primary }),
        },
      },
      MuiToolbar: { styleOverrides: { root: { minHeight: 56, '@media (min-width:600px)': { minHeight: 56 } } } },
      MuiDrawer: { styleOverrides: { paper: ({ theme }) => ({ backgroundColor: theme.palette.sidebar, borderColor: theme.palette.divider }) } },
      MuiListItemButton: { styleOverrides: { root: { borderRadius: RADIUS.control } } },
      MuiListItemIcon: { styleOverrides: { root: { minWidth: 32 } } },
      MuiMenu: { styleOverrides: { paper: ({ theme }) => ({ marginTop: 4, boxShadow: popupShadow(theme), border: `1px solid ${theme.palette.divider}` }) } },
      MuiPopover: { styleOverrides: { paper: ({ theme }) => ({ boxShadow: popupShadow(theme), border: `1px solid ${theme.palette.divider}` }) } },
      MuiMenuItem: { styleOverrides: { root: { borderRadius: RADIUS.control, marginInline: 4, minHeight: 36, fontSize: '0.875rem' } } },
      MuiDialog: { styleOverrides: { paper: ({ theme }) => ({ borderRadius: RADIUS.panel, boxShadow: popupShadow(theme), border: `1px solid ${theme.palette.divider}` }) } },
      MuiDialogTitle: { styleOverrides: { root: { fontWeight: 600, fontSize: '1.0625rem' } } },
      MuiOutlinedInput: {
        styleOverrides: {
          root: ({ theme }) => ({
            borderRadius: RADIUS.control,
            backgroundColor: theme.palette.background.paper,
            '& .MuiOutlinedInput-notchedOutline': { borderColor: strongLine(theme) },
            '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: theme.palette.text.secondary },
            '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderWidth: 1 },
            '&.Mui-focused': { boxShadow: `0 0 0 3px ${alpha(theme.palette.primary.main, 0.2)}` },
          }),
        },
      },
      MuiTableCell: {
        styleOverrides: {
          root: ({ theme }) => ({ borderBottomColor: theme.palette.divider, fontSize: '0.8125rem', paddingBlock: 10 }),
          head: ({ theme }) => ({ fontWeight: 500, fontSize: '0.75rem', color: theme.palette.text.secondary, backgroundColor: theme.palette.background.paper }),
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
            borderRadius: 3,
            fontWeight: 500,
            height: 22,
            fontSize: '0.75rem',
            '&.MuiChip-colorPrimary.MuiChip-outlined, &.MuiChip-outlinedPrimary': { color: linkColor(theme), borderColor: linkColor(theme) },
          }),
          label: { paddingInline: 6 },
        },
      },
      MuiAlert: {
        styleOverrides: {
          root: ({ theme, ownerState }) => ({
            borderRadius: RADIUS.panel,
            border: `1px solid ${alpha(theme.palette[ownerState.severity ?? 'info'].main, 0.35)}`,
            alignItems: 'center',
            paddingBlock: 2,
          }),
        },
      },
      MuiLinearProgress: {
        styleOverrides: {
          root: ({ theme }) => ({ height: 4, borderRadius: 2, backgroundColor: theme.palette.track }),
          bar: { borderRadius: 2 },
        },
      },
      MuiTooltip: {
        styleOverrides: {
          tooltip: ({ theme }) => ({
            backgroundColor: theme.palette.text.primary,
            color: theme.palette.background.paper,
            fontSize: '0.75rem',
            fontWeight: 400,
            borderRadius: RADIUS.control,
          }),
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
        styleOverrides: {
          root: ({ theme }) => ({ color: theme.palette.text.secondary, '&.Mui-selected': { color: linkColor(theme) } }),
        },
      },
      MuiToggleButton: {
        styleOverrides: {
          root: ({ theme }) => ({ textTransform: 'none', fontWeight: 500, borderRadius: RADIUS.control, '&.Mui-selected': { color: linkColor(theme) } }),
        },
      },
      MuiTab: { styleOverrides: { root: ({ theme }) => ({ textTransform: 'none', fontWeight: 500, '&.Mui-selected': { color: linkColor(theme) } }) } },
      // Small text in the accent colour (focused labels) uses the readable link blue on dark grounds.
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
