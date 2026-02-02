import { createTheme } from '@mui/material/styles';

export const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: { main: '#7c9cff' },
    secondary: { main: '#b794f6' },
  },
  typography: {
    fontFamily: '"DM Sans", "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  },
});
