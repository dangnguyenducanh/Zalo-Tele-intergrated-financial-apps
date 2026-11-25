import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import TelegramIcon from '@mui/icons-material/Telegram';
import WhatsAppIcon from '@mui/icons-material/WhatsApp';
import { Alert, Box, Button, Paper, Stack, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiErrorMessage } from '@/features/categories/helpers';
import { useCreateLinkCodeMutation, useGetChatLinksQuery, type ChatApp, type ChatLink, type LinkCode } from './botApi';
import { qrSvgPath } from './qrCode';

const CHECK_LINKS_MS = 5000; // while a code is live, look for the new chat link every 5 s
const APPS: ChatApp[] = ['telegram', 'whatsapp', 'zalo'];
const BUTTON = {
  telegram: { label: 'link.openTelegram', icon: <TelegramIcon /> },
  whatsapp: { label: 'link.openWhatsapp', icon: <WhatsAppIcon /> },
  zalo: { label: 'link.openZalo', icon: <ContentCopyIcon /> },
} as const;

// The apps the server has settings for, in a fixed order; the card starts on the first one not linked yet.
const shownApps = (code: LinkCode) => APPS.filter((app) => code.links[app]);
function firstApp(code: LinkCode, linked: ChatLink[]): ChatApp | null {
  const apps = shownApps(code);
  return apps.find((app) => !linked.some((link) => link.platform === app)) ?? apps[0] ?? null;
}

// "Generate code" → the one-time code with a countdown, then one button per chat app (docs/02 §2.10.2):
// Telegram and WhatsApp links carry the code; Zalo's can't, so its button copies "/link CODE" and opens the bot.
// The QR code holds the same link for people on a computer. The bot redeems the code; this card only shows it
// and says "Linked ✓" when the 5 s check finds a chat link that was not there when the code was made.
export default function LinkCard() {
  const { t } = useTranslation('bot');
  const titleId = useId();
  const [createLinkCode, { isLoading }] = useCreateLinkCodeMutation();
  const [code, setCode] = useState<LinkCode | null>(null);
  const [app, setApp] = useState<ChatApp | null>(null);
  const [linkedBefore, setLinkedBefore] = useState<string[] | null>(null); // link ids when the code was made
  const [linked, setLinked] = useState<ChatLink | null>(null); // the link that redeemed the code
  const [copy, setCopy] = useState<'done' | 'failed' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const codeBox = useRef<HTMLDivElement>(null);
  const linkedBox = useRef<HTMLDivElement>(null);

  const secondsLeft = code ? Math.max(0, Math.round((Date.parse(code.expiresAt) - now) / 1000)) : 0;
  // The account appears under "Linked accounts" as soon as the user has sent the code to the bot.
  const { data: chatLinks, refetch: refetchLinks } = useGetChatLinksQuery(undefined, { pollingInterval: secondsLeft > 0 ? CHECK_LINKS_MS : 0 });
  const live = secondsLeft > 0;

  // A link that was not there when the code was made: the bot redeemed it, so the code is spent. Updating state
  // while rendering (React's "previous render" pattern) swaps the code for "Linked ✓" and stops the 5 s checks.
  // linkedBefore is null when the list could not be loaded then: no "Linked ✓" rather than a wrong one.
  // Only while the code is live: after it expires the list still reloads (an unlink, Retry), and a link made
  // elsewhere then did not redeem this code.
  const newLink = code && live && linkedBefore ? chatLinks?.find((link) => !linkedBefore.includes(link.id)) : undefined;
  if (newLink) {
    setLinked(newLink);
    setCode(null);
  }

  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [live]);

  // The Generate button is replaced by the code, and the code by "Linked ✓", so focus follows instead of <body>.
  useEffect(() => {
    if (code) codeBox.current?.focus();
  }, [code]);
  useEffect(() => {
    if (linked) linkedBox.current?.focus();
  }, [linked]);

  async function generate() {
    setError(null);
    try {
      const created = await createLinkCode().unwrap();
      // The links that exist now, always fetched fresh: the cached list misses links made in another tab or by a
      // code redeemed after the last check, and would report them as "Linked ✓" for this code.
      const before = await refetchLinks().unwrap().catch(() => undefined);
      setNow(Date.now());
      setCode(created);
      setApp(firstApp(created, before ?? []));
      setLinkedBefore(before?.map((link) => link.id) ?? null);
      setLinked(null);
      setCopy(null);
    } catch (err) {
      setError(apiErrorMessage(err)); // e.g. 429 after 5 codes in 10 minutes
    }
  }

  // Zalo: the link opens the bot (an <a>, so no popup blocker), and the click also copies the command.
  // No clipboard (plain-http page) or a refusal shows the failure; the command stays on screen to copy by hand.
  function copyCommand(command: string) {
    setCopy(null);
    const writing = navigator.clipboard?.writeText(command) ?? Promise.reject(new Error('No clipboard'));
    writing.then(
      () => setCopy('done'),
      () => setCopy('failed'),
    );
  }

  const minutes = Math.floor(secondsLeft / 60);
  const time = `${minutes}:${String(secondsLeft % 60).padStart(2, '0')}`;

  return (
    <Paper component="section" variant="outlined" aria-labelledby={titleId} sx={{ p: 2 }}>
      <Typography id={titleId} variant="h6" component="h2">
        {t('link.heading')}
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
          {shownApps(code).length > 1 && (
            <ToggleButtonGroup
              exclusive
              size="small"
              color="primary"
              aria-label={t('link.app')}
              value={app}
              onChange={(_, picked: ChatApp | null) => {
                if (picked) setApp(picked); // pressing the selected app again keeps it
                setCopy(null);
              }}
            >
              {shownApps(code).map((option) => (
                <ToggleButton key={option} value={option} sx={{ px: 2 }}>
                  {t(`sources.${option}`)}
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
          )}
          {app && code.links[app] && (
            <>
              <Typography>{t(`link.steps.${app}`, { code: code.code })}</Typography>
              <Button
                variant="contained"
                startIcon={BUTTON[app].icon}
                href={code.links[app]}
                target="_blank"
                rel="noopener noreferrer"
                onClick={app === 'zalo' ? () => copyCommand(`/link ${code.code}`) : undefined}
              >
                {t(BUTTON[app].label)}
              </Button>
              {/* Always in the accessibility tree (no display: none), so screen readers announce the copy result.
                  While empty it is taken out of the flow, so it adds no gap. */}
              <Typography role="status" sx={{ color: copy === 'failed' ? 'error.main' : 'text.secondary', '&:empty': { position: 'absolute' } }}>
                {copy === 'done' && t('link.copied', { code: code.code })}
                {copy === 'failed' && t('link.copyFailed')}
              </Typography>
              <QrCode text={code.links[app]} label={t('link.qrFor', { app: t(`sources.${app}`) })} />
            </>
          )}
          <Typography>{t('link.manual')}</Typography>
          <Box component="code" sx={{ px: 1.25, py: 0.75, borderRadius: '10px', bgcolor: 'action.hover', fontFamily: 'var(--font-mono)', fontSize: '1.1rem', userSelect: 'all' }}>
            /link {code.code}
          </Box>
        </Stack>
      ) : (
        <>
          {linked ? (
            <Alert ref={linkedBox} tabIndex={-1} severity="success" sx={{ mb: 2 }}>
              {t('link.linked', { name: `${t(`sources.${linked.platform}`)} · ${linked.displayName}` })}
            </Alert>
          ) : (
            code && (
              <Alert severity="info" sx={{ mb: 2 }}>
                {t('link.expired')}
              </Alert>
            )
          )}
          <Button variant="contained" loading={isLoading} onClick={() => void generate()}>
            {t(code || linked ? 'link.regenerate' : 'link.generate')}
          </Button>
        </>
      )}
    </Paper>
  );
}

// The QR code as SVG squares. Always black on white with a 4-module margin, even in the dark theme,
// because phone cameras read dark-on-light codes best.
function QrCode({ text, label }: { text: string; label: string }) {
  const { size, path } = qrSvgPath(text);
  return (
    <svg role="img" aria-label={label} viewBox={`0 0 ${size} ${size}`} width={176} height={176} shapeRendering="crispEdges">
      <rect width={size} height={size} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}
