import { createTheme } from '@mui/material/styles';

/**
 * Light, minimal shell for MUI (developer panels, dialogs).
 * Bridge chrome uses Tailwind; keep palette aligned for cohesion.
 */
const fontSans = '"Plus Jakarta Sans", system-ui, -apple-system, sans-serif';
const fontMono = '"IBM Plex Mono", ui-monospace, "Cascadia Code", monospace';

const accent = '#0f766e'; // teal-700 — single calm accent (Symbiosis-adjacent: clean DeFi, not neon)

export const theme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      main: accent,
      light: '#14b8a6',
      dark: '#0d9488',
    },
    secondary: {
      main: '#64748b',
      light: '#94a3b8',
      dark: '#475569',
    },
    background: {
      default: '#f8fafc',
      paper: '#ffffff',
    },
    divider: 'rgba(15, 23, 42, 0.08)',
    text: {
      primary: '#0f172a',
      secondary: '#64748b',
    },
    warning: {
      main: '#b45309',
    },
    error: {
      main: '#b91c1c',
    },
    success: {
      main: '#047857',
    },
    info: {
      main: '#0369a1',
    },
  },
  shape: {
    borderRadius: 12,
  },
  typography: {
    fontFamily: fontSans,
    htmlFontSize: 16,
    fontWeightRegular: 400,
    fontWeightMedium: 500,
    fontWeightBold: 600,
    h1: { fontSize: '2rem', fontWeight: 600, lineHeight: 1.2, letterSpacing: '-0.02em' },
    h2: { fontSize: '1.75rem', fontWeight: 600, lineHeight: 1.22, letterSpacing: '-0.015em' },
    h3: { fontSize: '1.5rem', fontWeight: 600, lineHeight: 1.25 },
    h4: { fontSize: '1.375rem', fontWeight: 600, lineHeight: 1.3 },
    h5: { fontSize: '1.25rem', fontWeight: 600, lineHeight: 1.35 },
    h6: { fontSize: '1.0625rem', fontWeight: 600, lineHeight: 1.4 },
    subtitle1: { fontSize: '1rem', fontWeight: 500, lineHeight: 1.5 },
    subtitle2: { fontSize: '0.875rem', fontWeight: 600, lineHeight: 1.45 },
    body1: { fontSize: '1rem', lineHeight: 1.65 },
    body2: { fontSize: '0.875rem', lineHeight: 1.62 },
    button: { fontWeight: 600, letterSpacing: '0.01em', textTransform: 'none' as const },
    caption: { fontSize: '0.75rem', lineHeight: 1.5 },
    overline: {
      fontSize: '0.6875rem',
      fontWeight: 600,
      letterSpacing: '0.06em',
      textTransform: 'uppercase' as const,
    },
    dataMono: {
      fontFamily: fontMono,
      fontSize: '0.8125rem',
      lineHeight: 1.55,
      fontFeatureSettings: '"tnum" 1, "liga" 0',
    },
    dataMonoDense: {
      fontFamily: fontMono,
      fontSize: '0.75rem',
      lineHeight: 1.5,
      fontFeatureSettings: '"tnum" 1, "liga" 0',
    },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: { fontFeatureSettings: '"kern" 1' },
        'code, kbd': {
          fontFamily: fontMono,
          fontSize: '0.9em',
          padding: '0.125em 0.35em',
          borderRadius: 4,
          backgroundColor: 'rgba(15, 23, 42, 0.06)',
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: { backgroundImage: 'none', boxShadow: '0 1px 3px rgba(15,23,42,0.06)' },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: {
          transition: 'background-color 0.15s ease, color 0.15s ease, border-color 0.15s ease',
        },
      },
    },
  },
});
