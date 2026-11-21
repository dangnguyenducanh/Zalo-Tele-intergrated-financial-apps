import TelegramIcon from '@mui/icons-material/Telegram';
import { Alert, Box, Button, Paper, Stack, Typography } from '@mui/material';
import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiErrorMessage } from '@/features/categories/helpers';
import { useCreateLinkCodeMutation, useGetChatLinksQuery, type LinkCode } from './botApi';
import { qrMatrix } from './qrCode';

const CHECK_LINKS_MS = 5000; // while a code is live, look for the new chat link every 5 s

// "Generate code" → the one-time code with a countdown, the Telegram deep link with its QR code, and the
// "/link CODE" message for Zalo (docs/05 §5.7). The bot redeems the code; this card only shows it.
export default function LinkCard() {
  const { t } = useTranslation('bot');
  const titleId = useId();
  const [createLinkCode, { isLoading }] = useCreateLinkCodeMutation();
  const [code, setCode] = useState<LinkCode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const codeBox = useRef<HTMLDivElement>(null);

  const secondsLeft = code ? Math.max(0, Math.round((Date.parse(code.expiresAt) - now) / 1000)) : 0;
  const live = secondsLeft > 0;
  // The account appears under "Linked accounts" as soon as the user has sent the code to the bot.
  useGetChatLinksQuery(undefined, { pollingInterval: live ? CHECK_LINKS_MS : 0 });

  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [live]);

  // The Generate button is replaced by the code, so focus goes to the code instead of <body>.
  useEffect(() => {
    if (code) codeBox.current?.focus();
  }, [code]);

  async function generate() {
    setError(null);
    try {
      const created = await createLinkCode().unwrap();
      setNow(Date.now());
      setCode(created);
    } catch (err) {
      setError(apiErrorMessage(err)); // e.g. 429 after 5 codes in 10 minutes
    }
  }

  const minutes = Math.floor(secondsLeft / 60);
  const time = `${minutes}:${String(secondsLeft % 60).padStart(2, '0')}`;

  return (
    <Paper component="section" variant="outlined" aria-labelledby={titleId} sx={{ p: 2 }}>
      <Typography id={titleId} variant="h6" component="h2">
        {t('link.title')}
      </Typography>
      <Typography sx={{ color: 'text.secondary', mb: 2 }}>{t('link.description')}</Typography>
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {code && live ? (
        <Stack spacing={2} sx={{ alignItems: 'flex-start' }}>
          <div ref={codeBox} tabIndex={-1}>
            <Typography variant="caption" component="p" sx={{ color: 'text.secondary' }}>
              {t('link.code')}
            </Typography>
            <Typography component="p" sx={{ fontFamily: 'monospace', fontSize: '2rem', fontWeight: 700, letterSpacing: '0.2em' }}>
              {code.code}
            </Typography>
            {/* role="timer" is not announced every second; the user can read it when they want */}
            <Typography role="timer" sx={{ color: 'text.secondary' }}>
              {t('link.expiresIn', { time })}
            </Typography>
          </div>
          {code.telegramDeepLink && (
            <>
              <Typography>{t('link.telegram')}</Typography>
              <Button variant="contained" startIcon={<TelegramIcon />} href={code.telegramDeepLink} target="_blank" rel="noopener noreferrer">
                {t('link.openTelegram')}
              </Button>
              <QrCode text={code.telegramDeepLink} label={t('link.qr')} />
            </>
          )}
          <Typography>{t('link.zalo')}</Typography>
          <Box component="code" sx={{ px: 1.25, py: 0.75, borderRadius: '10px', bgcolor: 'action.hover', fontFamily: 'var(--font-mono)', fontSize: '1.1rem' }}>
            /link {code.code}
          </Box>
        </Stack>
      ) : (
        <>
          {code && (
            <Alert severity="info" sx={{ mb: 2 }}>
              {t('link.expired')}
            </Alert>
          )}
          <Button variant="contained" loading={isLoading} onClick={() => void generate()}>
            {t(code ? 'link.regenerate' : 'link.generate')}
          </Button>
        </>
      )}
    </Paper>
  );
}

// The QR code as SVG squares. Always black on white with a 4-module margin, even in the dark theme,
// because phone cameras read dark-on-light codes best.
function QrCode({ text, label }: { text: string; label: string }) {
  const modules = qrMatrix(text);
  const size = modules.length + 8;
  const path = modules.flatMap((row, y) => row.map((dark, x) => (dark ? `M${x + 4} ${y + 4}h1v1h-1z` : ''))).join('');
  return (
    <svg role="img" aria-label={label} viewBox={`0 0 ${size} ${size}`} width={176} height={176} shapeRendering="crispEdges">
      <rect width={size} height={size} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}
