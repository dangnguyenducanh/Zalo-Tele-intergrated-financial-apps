import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import TelegramIcon from '@mui/icons-material/Telegram';
import WhatsAppIcon from '@mui/icons-material/WhatsApp';
import { Alert, Box, Button, Paper, Stack, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppDispatch } from '@/app/hooks';
import { apiErrorMessage } from '@/features/categories/helpers';
import { botApi, nameOf, useCreateLinkCodeMutation, useGetChatLinksQuery, type ChatApp, type ChatLink, type LinkCode } from './botApi';
import { qrSvgPath } from './qrCode';

const CHECK_LINKS_MS = 5000; // while a code is live, look for the new chat link every 5 s
const CODE_LIFETIME_MS = 10 * 60 * 1000; // a code was made this long before its expiresAt (CODE_TTL_MS in server/src/services/chatLinks.js)
// The bot checks the expiry first and saves the link a database round trip later (redeemLinkCode), so a code redeemed
// at the very end makes a link dated just after expiresAt.
const LATE_LINK_MS = 5000;
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

// The chat linked while this code was valid, which is how the card knows the bot redeemed it. Both times are the
// server's, so any copy of the list can be judged, however old: a link made before the code, or more than
// LATE_LINK_MS after it expired, did not come from it.
function redeemedLink(code: LinkCode, links: ChatLink[]) {
  const expires = Date.parse(code.expiresAt);
  return links.find((link) => {
    const made = Date.parse(link.createdAt);
    return made >= expires - CODE_LIFETIME_MS && made <= expires + LATE_LINK_MS;
  });
}

// "Generate code" → the one-time code with a countdown, then one button per chat app (docs/02 §2.10.2):
// Telegram and WhatsApp links carry the code; Zalo's can't, so its button copies "/link CODE" and opens the bot.
// The QR code holds the same link for people on a computer. The bot redeems the code; this card only shows it
// and says "Linked ✓" when the 5 s check finds a chat link made while the code was valid.
export default function LinkCard() {
  const { t } = useTranslation('bot');
  const titleId = useId();
  const dispatch = useAppDispatch();
  const [createLinkCode, { isLoading }] = useCreateLinkCodeMutation();
  const [code, setCode] = useState<LinkCode | null>(null);
  const [picked, setPicked] = useState<ChatApp | null>(null); // the app the user chose or opened
  const [linked, setLinked] = useState<ChatLink | null>(null); // the link that redeemed the code
  const [copy, setCopy] = useState<'done' | 'failed' | null>(null);
  const [error, setError] = useState<unknown>(null); // the failed request, translated when shown (BUG-031)
  const [now, setNow] = useState(() => Date.now());
  const codeBox = useRef<HTMLDivElement>(null);
  const linkedBox = useRef<HTMLDivElement>(null);

  // Rounded up, so the code counts as expired only once its expiry time has passed.
  const secondsLeft = code ? Math.max(0, Math.ceil((Date.parse(code.expiresAt) - now) / 1000)) : 0;
  // The account appears under "Linked accounts" as soon as the user has sent the code to the bot.
  const { data: chatLinks, refetch: refetchLinks } = useGetChatLinksQuery(undefined, { pollingInterval: secondsLeft > 0 ? CHECK_LINKS_MS : 0 });
  const live = secondsLeft > 0;
  // Until the user picks or opens one, the first app not linked yet; it follows the list as that arrives.
  const app = code && (picked ?? firstApp(code, chatLinks ?? []));

  // The bot redeemed the code, so the code is spent. Updating state while rendering (React's "previous render"
  // pattern) swaps the code for "Linked ✓" and stops the 5 s checks.
  const newLink = code && redeemedLink(code, chatLinks ?? []);
  if (newLink) {
    setLinked(newLink);
    setCode(null);
  }
  // "Linked ✓" only while that link still exists: unlinking it below takes the message away (no stale "Linked ✓").
  const stillLinked = linked && chatLinks?.some((link) => link.id === linked.id) ? linked : null;

  // A list read from now on. refetch() alone would join a request that is still running, which may have read the
  // list too early, so wait for that one to finish first.
  const reloadLinks = useCallback(async () => {
    await dispatch(botApi.util.getRunningQueryThunk('getChatLinks', undefined));
    await refetchLinks();
  }, [dispatch, refetchLinks]);

  // One last check when the code expires: it may have been redeemed after the last 5 s check.
  const expired = code !== null && !live;
  useEffect(() => {
    if (expired) void reloadLinks().catch(() => undefined); // refetch() throws if the page was left meanwhile
  }, [expired, reloadLinks]);

  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [live]);

  // The Generate button is replaced by the code, so focus follows it instead of falling to <body>.
  useEffect(() => {
    if (code) codeBox.current?.focus();
  }, [code]);
  // "Linked ✓" is read out by its status region and takes focus from nothing that stays on the page (docs/05 §5.9.7).
  // Only if focus was in the code block it replaces, which leaves it on <body>, does it move to the message.
  useEffect(() => {
    if (linked && document.activeElement === document.body) linkedBox.current?.focus();
  }, [linked]);

  async function generate() {
    setError(null);
    try {
      const created = await createLinkCode().unwrap();
      setNow(Date.now());
      setCode(created);
      setPicked(null);
      setLinked(null);
      setCopy(null);
      // The cached list misses chats linked elsewhere, and the starting app depends on it. The code does not wait.
      void reloadLinks().catch(() => undefined);
    } catch (err) {
      setError(err); // e.g. 429 after 5 codes in 10 minutes
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
      {error !== null && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {apiErrorMessage(error)}
        </Alert>
      )}
      {/* There from the moment a code exists, so "Linked ✓" arrives in a region screen readers already watch. */}
      {(code || linked) && (
        <div role="status" ref={linkedBox} tabIndex={-1}>
          {stillLinked && (
            // The chat name is user text with no length limit: it wraps anywhere instead of running out of the card.
            // role="none": the region around it announces it politely, not as an alert.
            <Alert role="none" severity="success" sx={{ mb: 2, '& .MuiAlert-message': { overflowWrap: 'anywhere' } }}>
              {t('link.linked', { name: nameOf(t, stillLinked) })}
            </Alert>
          )}
        </div>
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
              // Beside the side drawer (900–1150 px) the card is narrower than three apps: wrap, never leave the card.
              sx={{ flexWrap: 'wrap', maxWidth: '100%' }}
              onChange={(_, option: ChatApp | null) => {
                if (option) setPicked(option); // pressing the selected app again keeps it
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
                onClick={() => {
                  setPicked(app); // a list that arrives now must not switch the card to another app
                  if (app === 'zalo') copyCommand(`/link ${code.code}`);
                }}
              >
                {t(BUTTON[app].label)}
              </Button>
              {/* Always in the accessibility tree (no display: none), so screen readers announce the copy result.
                  While empty it is taken out of the flow, so it adds no gap. */}
              <Typography role="status" sx={{ color: copy === 'failed' ? 'error.main' : 'text.secondary', '&:empty': { position: 'absolute' } }}>
                {copy === 'done' && t('link.copied', { code: code.code })}
                {copy === 'failed' && t('link.copyFailed')}
              </Typography>
              {/* Zalo's link only opens the bot: it carries no code (docs/02 §2.10.2). */}
              <QrCode text={code.links[app]} label={app === 'zalo' ? t('link.qrZalo') : t('link.qrFor', { app: t(`sources.${app}`) })} />
            </>
          )}
          <Typography>{t('link.manual')}</Typography>
          <Box component="code" sx={{ px: 1.25, py: 0.75, borderRadius: '10px', bgcolor: 'action.hover', fontFamily: 'var(--font-mono)', fontSize: '1.1rem', userSelect: 'all' }}>
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
            {t(code || stillLinked ? 'link.regenerate' : 'link.generate')}
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
