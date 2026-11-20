import { Box, Card, CardContent, Stack, Typography } from '@mui/material';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import LanguageSwitch from '@/components/LanguageSwitch';
import ThemeToggle from '@/components/ThemeToggle';

// Centred card for the login and register pages, with the language and theme switches in the corner.
export default function AuthLayout({ title, children }: { title: string; children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <>
      <title>{`${title} · ${t('appName')}`}</title>
      <Stack component="header" direction="row" sx={{ justifyContent: 'flex-end', p: 1 }}>
        <LanguageSwitch />
        <ThemeToggle />
      </Stack>
      <Box component="main" id="main" sx={{ display: 'grid', placeItems: 'center', px: 2, pb: 6 }}>
        <Typography variant="h4" component="p" sx={{ fontWeight: 700, color: 'primary.main', mb: 2 }}>
          {t('appName')}
        </Typography>
        <Card sx={{ width: '100%', maxWidth: 420 }}>
          <CardContent sx={{ p: { xs: 2.5, sm: 4 } }}>
            <Typography variant="h5" component="h1" sx={{ mb: 2 }}>
              {title}
            </Typography>
            {children}
          </CardContent>
        </Card>
      </Box>
    </>
  );
}
