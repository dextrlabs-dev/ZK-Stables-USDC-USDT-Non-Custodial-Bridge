import { createTheme } from '@mui/material/styles';

/**
 * App UI: fixed rem scale, slightly looser body leading on dark.
 * Source Sans 3 + IBM Plex Mono. Palette: single cool accent (no competing purple/blue pair).
 */
const fontSans = '"Source Sans 3", "Segoe UI", system-ui, -apple-system, sans-serif';
const fontMono = '"IBM Plex Mono", ui-monospace, "Cascadia Code", "Segoe UI Mono", monospace';

const accent = '#58a6ff';
const accentMuted = '#388bfd';

export const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: {
      main: accent,
      light: '#79b8ff',
      dark: accentMuted,
    },
    secondary: {
      // Muted slate for secondary actions — does not compete with primary blue
      main: '#8b949e',
      light: '#b1bac4',
      dark: '#6e7681',
    },
    background: {
      default: '#0d1117',
      paper: '#161b22',
    },
    divider: 'rgba(240, 246, 252, 0.12)',
    text: {
      primary: '#f0f6fc',
      secondary: '#8b949e',
    },
    warning: {
      main: '#d29922',
    },
    error: {
      main: '#f85149',
    },
    success: {
      main: '#3fb950',
    },
    info: {
      main: '#58a6ff',
    },
  },
  shape: {
    borderRadius: 8,
  },
  typography: {
    fontFamily: fontSans,
    htmlFontSize: 16,
    fontWeightRegular: 400,
    fontWeightMedium: 500,
    fontWeightBold: 600,
    h1: {
      fontSize: '2rem',
      fontWeight: 600,
      lineHeight: 1.2,
      letterSpacing: '-0.02em',
    },
    h2: {
      fontSize: '1.75rem',
      fontWeight: 600,
      lineHeight: 1.22,
      letterSpacing: '-0.015em',
    },
    h3: {
      fontSize: '1.5rem',
      fontWeight: 600,
      lineHeight: 1.25,
      letterSpacing: '-0.01em',
    },
    h4: {
      fontSize: '1.375rem',
      fontWeight: 600,
      lineHeight: 1.3,
      letterSpacing: '-0.01em',
    },
    h5: {
      fontSize: '1.25rem',
      fontWeight: 600,
      lineHeight: 1.35,
    },
    h6: {
      fontSize: '1.0625rem',
      fontWeight: 600,
      lineHeight: 1.4,
      letterSpacing: '0.01em',
    },
    subtitle1: {
      fontSize: '1rem',
      fontWeight: 500,
      lineHeight: 1.5,
    },
    subtitle2: {
      fontSize: '0.875rem',
      fontWeight: 600,
      lineHeight: 1.45,
    },
    body1: {
      fontSize: '1rem',
      lineHeight: 1.65,
    },
    body2: {
      fontSize: '0.875rem',
      lineHeight: 1.62,
    },
    button: {
      fontWeight: 600,
      letterSpacing: '0.02em',
      textTransform: 'none' as const,
    },
    caption: {
      fontSize: '0.75rem',
      lineHeight: 1.5,
      letterSpacing: '0.01em',
    },
    overline: {
      fontSize: '0.6875rem',
      fontWeight: 600,
      lineHeight: 1.5,
      letterSpacing: '0.08em',
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
        body: {
          fontFeatureSettings: '"kern" 1',
        },
        'code, kbd': {
          fontFamily: fontMono,
          fontSize: '0.9em',
          padding: '0.125em 0.35em',
          borderRadius: 4,
          backgroundColor: 'rgba(240, 246, 252, 0.08)',
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: {
          transition: 'transform 0.2s cubic-bezier(0.25, 1, 0.5, 1), box-shadow 0.2s ease',
          '@media (prefers-reduced-motion: reduce)': {
            transition: 'background-color 0.15s ease, color 0.15s ease, border-color 0.15s ease',
          },
        },
        containedPrimary: {
          '@media (hover: hover)': {
            '&:hover': {
              '@media (prefers-reduced-motion: no-preference)': {
                transform: 'translateY(-1px)',
                boxShadow: '0 4px 14px rgba(88, 166, 255, 0.28)',
              },
            },
          },
          '&:active': {
            '@media (prefers-reduced-motion: no-preference)': {
              transform: 'translateY(0)',
              boxShadow: 'none',
            },
          },
        },
      },
    },
  },
});
