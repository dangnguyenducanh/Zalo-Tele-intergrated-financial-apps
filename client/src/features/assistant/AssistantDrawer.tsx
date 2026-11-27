import { Box, Button, Chip, CircularProgress, Drawer, IconButton, Paper, TextField, Typography, useMediaQuery, useTheme } from '@mui/material';
import { useEffect, useId, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { assistantAskTaken, assistantClosed } from '@/app/uiSlice';
import { ChevronDown, SendHorizontal, Trash2, X } from '@/components/icons';
import { apiErrorMessage } from '@/features/categories/helpers';
import { isApiError } from '@/types/api';
import { useChatMutation, useClearThreadMutation, useGetThreadQuery, type Fact, type ThreadTurn } from './assistantApi';
import CaptureCard from './CaptureCard';

// The "Hỏi Sổ chi tiêu" drawer (docs/05 §5.10.1, docs/02 §2.11.5). It is mounted once in AppLayout and opened by the Dashboard button
// or the QuickAdd question chip. Express is the only API it talks to; the answers, facts, sources and follow-ups are written by the
// server in the user's language, so the client formats nothing inside an answer.
export default function AssistantDrawer() {
  const dispatch = useAppDispatch();
  const open = useAppSelector((s) => s.ui.assistant.open);
  const titleId = useId();
  const input = useRef<HTMLTextAreaElement>(null);
  // Focus goes to the input on open (docs/05 §5.10.8). `autoFocus` alone is not enough in a browser: while the drawer slides in it is
  // still `visibility: hidden` at mount, and a hidden element cannot take focus. So the input also asks again once the slide has ended,
  // unless the user has already moved on to something inside the drawer.
  const focusInput = () => {
    const active = document.activeElement;
    if (!active || active === document.body || active.getAttribute('role') === 'dialog') input.current?.focus();
  };
  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={() => dispatch(assistantClosed())}
      slotProps={{
        paper: { role: 'dialog', 'aria-labelledby': titleId, sx: { width: { xs: '100%', sm: 420 }, maxWidth: '100%' } },
        transition: { onEntered: focusInput },
      }}
    >
      <Panel titleId={titleId} inputRef={input} />
    </Drawer>
  );
}

// Why the last send did not give an answer. "down" covers the agent service (503 AGENT_UNAVAILABLE), the network and any 5xx.
// The error is kept, not its text: the text is translated when it is drawn, so a language switch changes it too.
type Failure = { requestId: string; message: string; kind: 'down' | 'busy' | 'other'; error: unknown };

const visuallyHidden = { position: 'absolute', width: '1px', height: '1px', margin: '-1px', overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' } as const;

// Everything inside the drawer; it exists only while the drawer is open, so closing and reopening loads the thread again.
function Panel({ titleId, inputRef }: { titleId: string; inputRef: RefObject<HTMLTextAreaElement | null> }) {
  const { t } = useTranslation('assistant');
  const dispatch = useAppDispatch();
  const month = useAppSelector((s) => s.ui.month);
  const ask = useAppSelector((s) => s.ui.assistant.ask);
  const thread = useGetThreadQuery(undefined, { refetchOnMountOrArgChange: true });
  const [chat] = useChatMutation();
  const [clearThread] = useClearThreadMutation();
  const [input, setInput] = useState('');
  const [sending, setSending] = useState<{ requestId: string; message: string } | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [announcement, setAnnouncement] = useState({ key: 0, text: '' });
  // The next three change at once, between two renders, so they are refs: a double click must not send twice.
  const busy = useRef(false);
  const stopped = useRef(false);
  const abort = useRef<(() => void) | null>(null);
  const taken = useRef<string | null>(null); // the chip's question this drawer already sent
  const scroller = useRef<HTMLDivElement>(null);

  const turns = thread.data?.turns ?? [];
  const remaining = thread.data?.ai.remainingToday;
  const capped = remaining === 0; // the web cap (30 a day, docs/02 §2.11.4) is used up
  const loading = thread.isFetching; // sending waits for the thread, so its answer is never overwritten by an older load
  const empty = !loading && turns.length === 0 && !sending && !failure;

  const announce = (text: string) => setAnnouncement((old) => ({ key: old.key + 1, text }));

  const failureText = ({ kind, error }: Failure) => (kind === 'busy' ? t('error.busy') : kind === 'down' ? t('error.unavailable') : apiErrorMessage(error));

  function failureOf(error: unknown, requestId: string, message: string): Failure | 'duplicate' {
    const code = isApiError((error as { data?: unknown })?.data) ? (error as { data: { error: { code: string } } }).data.error.code : null;
    const status = (error as { status?: unknown })?.status;
    if (code === 'DUPLICATE') return 'duplicate';
    if (code === 'AGENT_BUSY') return { requestId, message, kind: 'busy', error };
    // The agent is down, the network is, or something in between answered with an error page: all "try again later".
    if (code === 'AGENT_UNAVAILABLE' || code === null || (typeof status === 'number' && status >= 500)) return { requestId, message, kind: 'down', error };
    return { requestId, message, kind: 'other', error };
  }

  // One question. `requestId` is new per message; Thử lại passes the failed one again, so a question the server already answered is
  // not answered (or counted) twice.
  async function send(message: string, requestId: string = crypto.randomUUID()) {
    if (busy.current) return;
    busy.current = true;
    stopped.current = false;
    setFailure(null);
    setSending({ requestId, message });
    const request = chat({ message, month, requestId });
    abort.current = () => {
      stopped.current = true;
      request.abort();
    };
    try {
      const answer = await request.unwrap();
      setInput((current) => (current === message ? '' : current)); // a retried question comes back to the input after a failure: answered now
      announce(answer.text ? t('announce.answer', { text: answer.text }) : t('announce.capture'));
    } catch (error) {
      if (stopped.current) {
        setInput((current) => current || message); // a stop is not an error: the question goes back to the input
      } else {
        const result = failureOf(error, requestId, message);
        if (result === 'duplicate') {
          void thread.refetch(); // the server had answered: show its row
        } else {
          setFailure(result);
          setInput((current) => current || message);
          announce(t('announce.error', { text: failureText(result) }));
        }
      }
    } finally {
      busy.current = false;
      setSending(null);
    }
  }

  const canSend = !sending && !loading;
  function submit() {
    const message = input.trim();
    if (!message || !canSend) return;
    setInput(''); // it moves into the thread; a failure or a stop puts it back
    void send(message);
  }

  // A question handed over by the QuickAdd chip: sent once the thread has loaded, then forgotten.
  useEffect(() => {
    if (!ask || loading || taken.current === ask.id) return;
    taken.current = ask.id;
    dispatch(assistantAskTaken());
    void send(ask.text);
  });

  // The newest message is always in view.
  useEffect(() => {
    scroller.current?.scrollTo?.({ top: scroller.current.scrollHeight });
  }, [turns.length, sending, failure]);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Enter' || event.shiftKey) return; // Shift+Enter adds a line
    event.preventDefault();
    if (event.nativeEvent.isComposing || event.keyCode === 229) return; // an IME is confirming a word
    submit();
  }

  async function clear() {
    try {
      await clearThread().unwrap();
      setFailure(null);
    } catch (error) {
      announce(t('announce.error', { text: apiErrorMessage(error) }));
    }
  }

  const newest = turns.at(-1)?.id;
  const quiet = !sending && !failure; // chips and buttons under the newest answer wait while a question is on its way
  const starters = ['category', 'compare', 'wallets', 'budget'].map((key) => ({ label: t(`starters.${key}`), value: t(`starters.${key}`) }));

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 1.5, borderBottom: 1, borderColor: 'divider' }}>
        <Typography id={titleId} variant="h6" component="h2" sx={{ flexGrow: 1, minWidth: 0 }}>
          {t('title')}
        </Typography>
        <Button size="small" color="inherit" startIcon={<Trash2 size={16} strokeWidth={1.75} aria-hidden />} onClick={() => void clear()} disabled={turns.length === 0 || Boolean(sending)}>
          {t('clear')}
        </Button>
        <IconButton aria-label={t('close')} onClick={() => dispatch(assistantClosed())} edge="end">
          <X size={20} strokeWidth={1.75} aria-hidden />
        </IconButton>
      </Box>

      <Box ref={scroller} sx={{ flex: 1, minHeight: 0, overflowY: 'auto', px: 2, py: 2 }}>
        {thread.isError && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
            <Typography variant="body2" sx={{ color: 'text.secondary', flexGrow: 1 }}>
              {t('threadError')}
            </Typography>
            <Button size="small" onClick={() => void thread.refetch()}>
              {t('retry')}
            </Button>
          </Box>
        )}
        {empty && <Chips label={t('starters.label')} items={starters} onPick={(text) => void send(text)} disabled={!canSend} />}
        <Box role="log" aria-label={t('thread')} aria-live="off" sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          {turns.map((turn) => (
            <TurnView key={turn.id} turn={turn} active={turn.id === newest && quiet} onAsk={(text) => void send(text)} />
          ))}
          {sending && (
            <>
              <UserBubble text={sending.message} />
              <Paper variant="outlined" aria-busy="true" sx={bubbleSx}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <CircularProgress size={16} aria-hidden sx={calmSx} />
                  <Typography variant="body2" sx={{ flexGrow: 1 }}>
                    {t('pending')}
                  </Typography>
                  <Button size="small" onClick={() => abort.current?.()}>
                    {t('stop')}
                  </Button>
                </Box>
              </Paper>
            </>
          )}
          {failure && (
            <>
              <UserBubble text={failure.message} />
              <Paper variant="outlined" sx={{ ...bubbleSx, borderColor: 'error.main' }}>
                <Typography variant="body2">{failureText(failure)}</Typography>
                {failure.kind === 'down' && (
                  <Typography variant="caption" component="p" sx={{ color: 'text.secondary', mt: 0.5 }}>
                    {t('error.stillWorks')}
                  </Typography>
                )}
                {failure.kind !== 'other' && (
                  <Button size="small" onClick={() => void send(failure.message, failure.requestId)} disabled={!canSend} sx={{ mt: 1 }}>
                    {t('retry')}
                  </Button>
                )}
              </Paper>
            </>
          )}
        </Box>
      </Box>

      <Box sx={visuallyHidden} role="status">
        <span key={announcement.key}>{announcement.text}</span>
      </Box>

      <Box component="form" noValidate onSubmit={(event) => event.preventDefault()} sx={{ px: 2, pt: 1.5, pb: 2, borderTop: 1, borderColor: 'divider' }}>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
          <TextField
            label={t('input.label')}
            placeholder={t('input.placeholder')}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={onKeyDown}
            helperText={capped ? t('capped') : t('input.hint')}
            multiline
            maxRows={5}
            fullWidth
            autoFocus
            inputRef={inputRef}
            slotProps={{ htmlInput: { maxLength: 500, enterKeyHint: 'send' } }}
          />
          <IconButton aria-label={t('input.send')} color="primary" onClick={submit} disabled={!input.trim() || !canSend} sx={{ mt: 0.75 }}>
            <SendHorizontal size={20} strokeWidth={1.75} aria-hidden />
          </IconButton>
        </Box>
        {capped && (
          <Typography variant="caption" component="p" sx={{ color: 'text.secondary', mt: 0.5 }}>
            {t('cappedCommands')}
          </Typography>
        )}
        {remaining !== undefined && (
          <Typography variant="caption" component="p" sx={{ color: 'text.secondary', mt: 0.5 }}>
            {t('remaining', { count: remaining })}
          </Typography>
        )}
      </Box>
    </Box>
  );
}

const bubbleSx = { p: 1.5, maxWidth: '100%', bgcolor: 'panel2', borderRadius: '16px', overflowWrap: 'anywhere' } as const;
// No spinner animation for people who asked for less motion; the text beside it says the answer is on its way.
const calmSx = { '@media (prefers-reduced-motion: reduce)': { animation: 'none', '& .MuiCircularProgress-circle': { animation: 'none' } } } as const;

function UserBubble({ text }: { text: string }) {
  return (
    <Box sx={{ alignSelf: 'flex-end', maxWidth: '85%', px: 1.5, py: 1, borderRadius: '16px', bgcolor: 'primary.main', color: 'primary.contrastText', whiteSpace: 'pre-line', overflowWrap: 'anywhere' }}>
      {text}
    </Box>
  );
}

// A row of buttons that each send a text as the next message: the chip's own words (starters, follow-ups) or an ask-back option's number.
type Choice = { label: string; value: string };
function Chips({ label, items, onPick, disabled }: { label: string; items: Choice[]; onPick: (value: string) => void; disabled?: boolean }) {
  return (
    <Box role="group" aria-label={label} sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mt: 1 }}>
      {items.map((item, i) => (
        <Chip key={`${i}-${item.label}`} label={item.label} variant="outlined" onClick={() => onPick(item.value)} disabled={disabled} sx={{ height: 'auto', py: 0.5, '& .MuiChip-label': { whiteSpace: 'normal' } }} />
      ))}
    </Box>
  );
}

// One question and what came back: the answer with its badge, or the capture card. `active`: the newest answer, the only one with chips.
function TurnView({ turn, active, onAsk }: { turn: ThreadTurn; active: boolean; onAsk: (text: string) => void }) {
  return (
    <>
      {turn.question && <UserBubble text={turn.question} />}
      {turn.capture ? <CaptureCard result={turn.capture} /> : turn.text ? <Answer turn={turn} active={active} onAsk={onAsk} /> : null}
    </>
  );
}

// "Nguồn: Giao dịch…" and "Giao dịch…" are both seen in sources; the line is built here, so the prefix is dropped.
const bare = (source: string) => source.replace(/^(Nguồn|Source)\s*:\s*/i, '');

function Answer({ turn, active, onAsk }: { turn: ThreadTurn; active: boolean; onAsk: (text: string) => void }) {
  const { t } = useTranslation('assistant');
  const ai = turn.route === 'agent'; // the local model worded it; every other route is a template
  const options = turn.card?.kind === 'ask_back' ? (turn.card.options ?? []) : [];
  return (
    <Paper variant="outlined" sx={bubbleSx}>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 0.5 }}>
        <Box component="span" sx={{ px: 1, border: 1, borderColor: 'divider', borderRadius: 999, fontSize: '0.6875rem', fontWeight: 600, color: ai ? 'primary.main' : 'text.secondary' }}>
          {ai ? t('badge.ai') : t('badge.template')}
        </Box>
        {ai && <Box component="span" sx={visuallyHidden}>{t('badge.aiDescription')}</Box>}
      </Box>
      <Typography sx={{ whiteSpace: 'pre-line' }}>{turn.text}</Typography>
      {turn.facts.length > 0 && <Facts facts={turn.facts} />}
      {turn.sources.length > 0 && (
        <Typography variant="caption" component="p" sx={{ color: 'text.secondary', mt: 1 }}>
          {t('sources', { list: turn.sources.map(bare).join('; ') })}
        </Typography>
      )}
      {active && options.length > 0 && <Chips label={t('askBack')} items={options.map((option) => ({ label: option.label, value: String(option.n) }))} onPick={onAsk} />}
      {active && turn.followups.length > 0 && <Chips label={t('followups')} items={turn.followups.map((text) => ({ label: text, value: text }))} onPick={onAsk} />}
    </Paper>
  );
}

// The numbers behind an answer: a real list, folded on phones (the drawer is full width there) behind a button that says so.
function Facts({ facts }: { facts: Fact[] }) {
  const { t } = useTranslation('assistant');
  const theme = useTheme();
  const wide = useMediaQuery(theme.breakpoints.up('sm'), { noSsr: true });
  const [open, setOpen] = useState(wide);
  const id = useId();
  return (
    <Box sx={{ mt: 1 }}>
      <Button size="small" color="inherit" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)} endIcon={<ChevronDown size={16} strokeWidth={1.75} aria-hidden style={{ transform: open ? 'rotate(180deg)' : undefined }} />} sx={{ px: 0.5 }}>
        {t('facts')}
      </Button>
      <Box id={id} component="ul" hidden={!open} aria-label={t('facts')} sx={{ m: 0, mt: 0.5, pl: 2.5, fontSize: '0.8125rem' }}>
        {facts.map((fact) => (
          <li key={fact.id}>{`${fact.label}: ${fact.display}`}</li>
        ))}
      </Box>
    </Box>
  );
}
