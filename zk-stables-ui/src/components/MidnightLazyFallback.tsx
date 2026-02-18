import React, { useEffect, useState } from 'react';
import { Box, CircularProgress, Fade, Typography, useMediaQuery } from '@mui/material';

/** Product-specific lines — avoid generic "loading" filler (delight skill). */
const LINES = [
  'Loading Midnight ledger WASM and on-chain runtime…',
  'Bundling zk-stables Compact contract for the browser…',
  'Starting wallet SDK — first load downloads the most bytes…',
] as const;

/**
 * Shown while the lazy `MainApp` chunk (Midnight + contract) loads.
 * Rotates status text so the wait feels informed, not stuck.
 */
export function MidnightLazyFallback(): React.ReactElement {
  const [index, setIndex] = useState(0);
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');

  useEffect(() => {
    const id = window.setInterval(() => {
      setIndex((i) => (i + 1) % LINES.length);
    }, 2800);
    return () => window.clearInterval(id);
  }, []);

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '50vh',
        gap: 2,
        py: 6,
        color: 'text.secondary',
        px: 2,
      }}
    >
      <CircularProgress size={36} thickness={4} sx={{ color: 'primary.light' }} />
      {reduceMotion ? (
        <Typography variant="body2" align="center" sx={{ maxWidth: 420, minHeight: 44 }}>
          {LINES[index]}
        </Typography>
      ) : (
        <Fade in timeout={400} key={index}>
          <Typography variant="body2" align="center" sx={{ maxWidth: 420, minHeight: 44 }}>
            {LINES[index]}
          </Typography>
        </Fade>
      )}
    </Box>
  );
}
