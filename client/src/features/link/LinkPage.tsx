import { Alert, Box, Button, CircularProgress, Paper, Stack, Typography } from '@mui/material';
import { skipToken } from '@reduxjs/toolkit/query';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { useAppDispatch } from '@/app/hooks';
import { showSnackbar } from '@/app/uiSlice';
import { forgetClaimToken, keepClaimToken, readClaimToken } from '@/auth/claimToken';
import { useAuth } from '@/auth/useAuth';
import AppSnackbar from '@/components/AppSnackbar';
import Brand from '@/components/BrandMark';
import LanguageSwitch from '@/components/LanguageSwitch';
import ThemeToggle from '@/components/ThemeToggle';
import { nameOf } from '@/features/bot/botApi';
import { apiErrorMessage } from '@/features/categories/helpers';
import { isApiError } from '@/types/api';
import { useClaimChatMutation, usePreviewClaimQuery } from './linkApi';

// /link (docs/02 §2.10.3, docs/05 §5.9.2), opened from a chat's "tap to link" message: who would be linked to which
// account, a warning, then Confirm or Cancel.
export default function LinkPage() {
  const [params] = useSearchParams();
  const { status } = useAuth();
  const fromUrl = params.get('t');
  if (fromUrl) {
    // Reached by navigating inside the app; at start-up takeClaimTokenFromAddressBar has done this already.
    keepClaimToken(fromUrl);
    return <Navigate to="/link" replace />;
  }
  // Not behind ProtectedRoute, which would copy "?t=…" into the login redirect before this page could remove it.
  if (status !== 'authenticated') return <Navigate to="/login" replace state={{ from: '/link' }} />;
  return (
    <Frame>
      <Claim />
    </Frame>
  );
}

// The two answers after which a token can do nothing more, each with its own screen.
const DEAD_ENDS: Record<string, 'expired' | 'alreadyLinked'> = { LINK_TOKEN_INVALID: 'expired', CHAT_ALREADY_LINKED: 'alreadyLinked' };
function deadEndOf(error: unknown) {
  const data = (error as { data?: unknown } | undefined)?.data;
  return isApiError(data) ? DEAD_ENDS[data.error.code] : undefined;
}

function Claim() {
  const { t } = useTranslation('link');
  const { t: tBot } = useTranslation('bot');
  const { user } = useAuth();
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const warningId = useId();
  const [token] = useState(readClaimToken);
  const { data: chat, error, isFetching, refetch } = usePreviewClaimQuery(token ?? skipToken);
  const [claimChat, claim] = useClaimChatMutation();
  const deadEnd = token ? (deadEndOf(claim.error) ?? deadEndOf(error)) : 'expired';

  useEffect(() => {
    if (deadEnd) forgetClaimToken();
  }, [deadEnd]);

  function toInbox() {
    forgetClaimToken();
    void navigate('/bot', { replace: true });
  }

  async function confirm() {
    if (!token) return;
    try {
      const link = await claimChat(token).unwrap();
      dispatch(showSnackbar({ message: tBot('link.linked', { name: nameOf(tBot, link) }), severity: 'success' }));
      toInbox();
    } catch {
      // shown from claim.error, translated at render
    }
  }

  if (deadEnd) {
    return (
      <Stack key={deadEnd} spacing={2} sx={{ alignItems: 'flex-start' }}>
        <StateHeading>{t(deadEnd)}</StateHeading>
        <Button component={Link} to="/bot" variant="contained">
          {t('toInbox')}
        </Button>
      </Stack>
    );
  }
  if (isFetching || (!chat && !error)) {
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', py: 4 }}>
        <CircularProgress aria-label={t('loading')} />
      </Box>
    );
  }
  if (error || !chat) {
    return (
      <Stack key="failed" spacing={2} sx={{ alignItems: 'flex-start' }}>
        <StateHeading>{apiErrorMessage(error)}</StateHeading>
        {/* refetch(): the same token again would not restart a failed query (BUG-015) */}
        <Button variant="contained" onClick={() => void refetch()}>
          {t('retry')}
        </Button>
      </Stack>
    );
  }
  return (
    <Stack key="confirm" spacing={2}>
      <StateHeading>
        {/* The names are elements, not text put into the string, so a chat name can never be read as markup. */}
        <Trans
          t={t}
          i18nKey="question"
          components={{ chat: <strong>{nameOf(tBot, chat)}</strong>, account: <strong>{`${user?.name} (${user?.email})`}</strong> }}
        />
      </StateHeading>
      {/* Page content, not a live alert: it is read after the question, and again on Confirm. */}
      <Alert id={warningId} role="none" severity="warning">
        {t('warning')}
      </Alert>
      {claim.error && <Alert severity="error">{apiErrorMessage(claim.error)}</Alert>}
      <Stack direction="row" useFlexGap spacing={1.5} sx={{ flexWrap: 'wrap' }}>
        <Button variant="contained" loading={claim.isLoading} aria-describedby={warningId} onClick={() => void confirm()}>
          {t('confirm')}
        </Button>
        {/* Not while the claim is on its way: it could no longer be called off. The token is left to expire. */}
        <Button variant="outlined" disabled={claim.isLoading} onClick={toInbox}>
          {t('common:cancel')}
        </Button>
      </Stack>
    </Stack>
  );
}

// Each state's heading takes focus when it appears (docs/05 §5.9.7), so a screen reader reads the question or the error.
function StateHeading({ children }: { children: ReactNode }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  // Chat and account names are user text with no spaces to break at: wrap anywhere (BUG-030).
  return (
    <Typography ref={heading} tabIndex={-1} variant="h6" component="h1" sx={{ overflowWrap: 'anywhere' }}>
      {children}
    </Typography>
  );
}

// A page of its own, without the app's navigation: one decision, with the language and theme switches.
function Frame({ children }: { children: ReactNode }) {
  const { t } = useTranslation('link');
  return (
    <Box sx={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}>
      <title>{`${t('title')} · ${t('common:appName')}`}</title>
      <Stack component="header" direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 1, px: { xs: 2, sm: 4 }, py: 2 }}>
        <Brand />
        <Stack direction="row" sx={{ alignItems: 'center' }}>
          <LanguageSwitch />
          <ThemeToggle />
        </Stack>
      </Stack>
      <Box component="main" id="main" sx={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'flex-start', px: 2, pt: { xs: 2, sm: 8 }, pb: 8 }}>
        <Paper variant="outlined" sx={{ width: '100%', maxWidth: 480, p: { xs: 2, sm: 3 } }}>
          {children}
        </Paper>
      </Box>
      <AppSnackbar />
    </Box>
  );
}
