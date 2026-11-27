import { Box, LinearProgress, Paper, Stack, Typography } from '@mui/material';
import { useId, type ReactNode, type Ref } from 'react';
import { Check } from '@/components/icons';
import { useTranslation } from 'react-i18next';
import telegramLogo from '@/assets/telegram.svg'; // the real Telegram mark (SVG Logos, CC0)
import Brand from '@/components/BrandMark';
import LanguageSwitch from '@/components/LanguageSwitch';
import { GRADIENT, moneySx } from '@/theme/theme';
import ThemeToggle from '@/components/ThemeToggle';

// Login and register: the form on the page ground on the left; on wide screens the product itself on the right
// (a month figure, a budget bar and a bot chat, drawn with the app's own components), so a first visitor sees
// what the app does before signing up. Phones get the form alone.
// `headingRef`: a screen with steps (forgot password) moves focus to the heading when its step changes.
export default function AuthLayout({ title, headingRef, children }: { title: string; headingRef?: Ref<HTMLHeadingElement>; children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <>
      <title>{`${title} · ${t('appName')}`}</title>
      <Box sx={{ minHeight: '100dvh', display: 'grid', gridTemplateColumns: { md: 'minmax(0, 1fr) minmax(0, 1.1fr)' } }}>
        <Box sx={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <Stack component="header" direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', px: { xs: 2, sm: 4 }, py: 2 }}>
            <Brand />
            <Stack direction="row" sx={{ alignItems: 'center' }}>
              <LanguageSwitch />
              <ThemeToggle />
            </Stack>
          </Stack>
          <Box component="main" id="main" sx={{ flex: 1, display: 'grid', placeItems: 'center', px: { xs: 2, sm: 4 }, pt: 2, pb: 8 }}>
            <Box sx={{ width: '100%', maxWidth: 400 }}>
              <Typography ref={headingRef} tabIndex={headingRef ? -1 : undefined} variant="h4" component="h1" sx={{ mb: 3, outline: 'none' }}>
                {title}
              </Typography>
              {children}
            </Box>
          </Box>
        </Box>
        <Showcase />
      </Box>
    </>
  );
}

function Showcase() {
  const { t } = useTranslation('auth');
  const titleId = useId();
  const points = [t('showcase.point1'), t('showcase.point2'), t('showcase.point3')];
  return (
    <Box
      component="aside"
      aria-labelledby={titleId}
      sx={(theme) => ({
        display: { xs: 'none', md: 'flex' },
        flexDirection: 'column',
        justifyContent: 'center',
        gap: 4,
        m: 1.5,
        p: { md: 5, lg: 7 },
        borderRadius: '28px',
        border: 1,
        borderColor: theme.palette.mode === 'light' ? 'transparent' : 'divider',
        color: '#ffffff',
        backgroundImage: GRADIENT,
        overflow: 'hidden',
      })}
    >
      <Box sx={{ maxWidth: 480 }}>
        <Typography id={titleId} component="p" sx={{ fontSize: { md: '1.75rem', lg: '2.125rem' }, fontWeight: 500, letterSpacing: '-0.025em', lineHeight: 1.15 }}>
          {t('showcase.title')}
        </Typography>
        <Typography sx={{ mt: 2, color: 'rgba(255, 255, 255, 0.8)', fontSize: '1.0625rem' }}>{t('showcase.body')}</Typography>
        <Stack component="ul" spacing={1} sx={{ listStyle: 'none', p: 0, m: 0, mt: 3 }}>
          {points.map((point) => (
            <Stack component="li" key={point} direction="row" spacing={1.25} sx={{ alignItems: 'center' }}>
              <Check size={16} strokeWidth={2} color="#7da6ff" aria-hidden />
              <Typography component="span">{point}</Typography>
            </Stack>
          ))}
        </Stack>
      </Box>

      {/* The product at work, built from the app's own pieces; decorative for screen readers (the text above says it). */}
      <Box aria-hidden sx={{ display: 'grid', gridTemplateColumns: '1.1fr 1fr', gap: 2, maxWidth: 560, color: 'text.primary' }}>
        <Paper variant="outlined" sx={{ p: 2.5, borderRadius: '18px', gridRow: 'span 2', display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Box>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              {t('showcase.month')}
            </Typography>
            <Typography sx={{ ...moneySx, fontSize: '1.625rem', fontWeight: 500, letterSpacing: '-0.02em', color: 'text.primary' }}>{t('showcase.spentAmount')}</Typography>
          </Box>
          <MiniBars />
          <Box>
            <Stack direction="row" sx={{ justifyContent: 'space-between', mb: 0.75 }}>
              <Typography variant="body2" sx={{ fontWeight: 500 }}>
                {t('showcase.budget')}
              </Typography>
              <Typography variant="body2" sx={{ ...moneySx, color: 'text.secondary' }}>
                81%
              </Typography>
            </Stack>
            <LinearProgress variant="determinate" value={81} />
          </Box>
        </Paper>
        <Paper variant="outlined" sx={{ p: 2, borderRadius: '18px', display: 'flex', flexDirection: 'column', gap: 1.25 }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Box component="img" src={telegramLogo} alt="" sx={{ width: 18, height: 18 }} />
            <Typography variant="body2" sx={{ fontWeight: 500 }}>
              Telegram
            </Typography>
          </Stack>
          <Bubble mine>{t('showcase.chatUser')}</Bubble>
          <Bubble>{t('showcase.chatBot')}</Bubble>
        </Paper>
        <Paper variant="outlined" sx={{ p: 2, borderRadius: '18px' }}>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            {t('showcase.income')}
          </Typography>
          <Typography sx={{ ...moneySx, fontSize: '1.25rem', fontWeight: 500, color: 'success.main' }}>{t('showcase.incomeAmount')}</Typography>
        </Paper>
      </Box>
    </Box>
  );
}

function Bubble({ mine = false, children }: { mine?: boolean; children: ReactNode }) {
  return (
    <Box
      sx={(theme) => ({
        alignSelf: mine ? 'flex-end' : 'flex-start',
        maxWidth: '92%',
        px: 1.5,
        py: 0.75,
        borderRadius: '4px',
        fontSize: '0.8125rem',
        bgcolor: mine ? theme.palette.primary.main : theme.palette.panel2,
        color: mine ? theme.palette.primary.contrastText : theme.palette.text.primary,
      })}
    >
      {children}
    </Box>
  );
}

// Fourteen days of spending as small bars: the shape of the dashboard chart, without its axes.
const DAYS = [30, 55, 20, 80, 45, 35, 60, 25, 90, 40, 50, 30, 70, 45];
function MiniBars() {
  return (
    <Stack direction="row" spacing={0.75} sx={{ alignItems: 'flex-end', height: 72 }}>
      {DAYS.map((height, i) => (
        <Box key={i} sx={{ flex: 1, height: `${height}%`, borderRadius: '2px 2px 0 0', bgcolor: 'primary.main', opacity: i === 8 ? 1 : 0.35 }} />
      ))}
    </Stack>
  );
}
