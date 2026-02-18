import type { CSSProperties } from 'react';
import '@mui/material/styles';

declare module '@mui/material/styles' {
  interface TypographyVariants {
    dataMono: CSSProperties;
    dataMonoDense: CSSProperties;
  }

  interface TypographyVariantsOptions {
    dataMono?: CSSProperties;
    dataMonoDense?: CSSProperties;
  }
}

declare module '@mui/material/Typography' {
  interface TypographyPropsVariantOverrides {
    dataMono: true;
    dataMonoDense: true;
  }
}
