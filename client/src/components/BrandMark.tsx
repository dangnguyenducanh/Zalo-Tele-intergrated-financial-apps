import { Box, Stack, Typography, useTheme } from '@mui/material';
import { useTranslation } from 'react-i18next';

// The app's own mark: three ledger lines on a square blue tile (index.html uses the same SVG as its icon).
export function BrandMark({ size = 28 }: { size?: number }) {
  const { palette } = useTheme();
  return (
    <Box component="svg" viewBox="0 0 32 32" aria-hidden sx={{ width: size, height: size, flexShrink: 0, display: 'block' }}>
      <rect width="32" height="32" rx="6" fill={palette.primary.main} />
      <path d="M8 10.5h16M8 16h16M8 21.5h9" stroke="#fff" strokeWidth="2.6" strokeLinecap="square" fill="none" />
    </Box>
  );
}

// Mark + name, used in the side drawer, the phone app bar and the sign-in pages. Not a heading: each page has its own h1.
export default function Brand({ size = 28 }: { size?: number }) {
  const { t } = useTranslation();
  return (
    <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center', minWidth: 0 }}>
      <BrandMark size={size} />
      <Typography component="span" noWrap sx={{ fontWeight: 600, fontSize: size >= 28 ? '1.125rem' : '0.9375rem', letterSpacing: '-0.015em' }}>
        {t('appName')}
      </Typography>
    </Stack>
  );
}
