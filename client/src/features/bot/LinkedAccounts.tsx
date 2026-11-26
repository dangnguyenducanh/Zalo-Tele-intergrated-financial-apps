import CloseIcon from '@mui/icons-material/Close';
import LinkOffIcon from '@mui/icons-material/LinkOff';
import { Alert, Button, IconButton, List, ListItem, ListItemIcon, ListItemText, Paper, Typography } from '@mui/material';
import { useId, useRef, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { showSnackbar } from '@/app/uiSlice';
import ConfirmDialog from '@/components/ConfirmDialog';
import { apiErrorMessage } from '@/features/categories/helpers';
import { useDismissClaimNoticeMutation } from '@/features/link/linkApi';
import { formatDate } from '@/i18n/format';
import { nameOf, useDeleteChatLinkMutation, useGetChatLinksQuery, type ChatLink } from './botApi';
import { sourceIcon } from './sourceIcon';

// The Telegram/Zalo accounts linked to this web account (GET /chat-links), each with Unlink (DELETE /chat-links/:id).
// A link made from a chat's claim link also gets a "Not you? [Unlink]" notice until it is dismissed (docs/02 §2.10.3).
export default function LinkedAccounts() {
  const { t } = useTranslation('bot');
  const titleId = useId();
  const dispatch = useAppDispatch();
  const language = useAppSelector((s) => s.ui.language);
  // Chats are also linked outside this page (the bots, a claim on another device): reload when the inbox opens.
  const { data: links, isError, refetch } = useGetChatLinksQuery(undefined, { refetchOnMountOrArgChange: true });
  const heading = useRef<HTMLHeadingElement>(null);
  const [deleteChatLink] = useDeleteChatLinkMutation();
  const [dismissClaimNotice] = useDismissClaimNoticeMutation();
  const { t: tLink } = useTranslation('link');
  const [unlinking, setUnlinking] = useState<ChatLink | null>(null);

  async function unlink() {
    const link = unlinking;
    setUnlinking(null);
    if (!link) return;
    try {
      await deleteChatLink(link.id).unwrap();
      heading.current?.focus(); // the Unlink button leaves with its row: keep focus on the page, not <body>
      dispatch(showSnackbar({ message: t('accounts.unlinked', { name: nameOf(t, link) }), severity: 'success' }));
    } catch (error) {
      dispatch(showSnackbar({ message: apiErrorMessage(error), severity: 'error' }));
    }
  }

  async function dismiss(link: ChatLink) {
    try {
      await dismissClaimNotice(link.id).unwrap();
    } catch (error) {
      // 404: unlinked meanwhile, and the reload takes the notice away. Anything else is said; the notice stays.
      if ((error as { status?: unknown }).status !== 404) {
        dispatch(showSnackbar({ message: apiErrorMessage(error), severity: 'error' }));
        return;
      }
    }
    heading.current?.focus(); // the button leaves with its notice
  }

  return (
    <Paper component="section" variant="outlined" aria-labelledby={titleId} sx={{ p: 2 }}>
      <Typography id={titleId} ref={heading} tabIndex={-1} variant="h6" component="h2">
        {t('accounts.title')}
      </Typography>
      {isError && (
        <Alert severity="error" sx={{ mt: 1 }} action={<Button onClick={() => void refetch()}>{t('retry')}</Button>}>
          {t('accounts.loadError')}
        </Alert>
      )}
      {links
        ?.filter((link) => link.viaClaim && !link.claimNoticeDismissedAt)
        .map((link) => (
          // Page content rather than a live alert; each notice is a group named by its own sentence.
          <Alert
            key={link.id}
            role="group"
            aria-labelledby={`${titleId}-${link.id}`}
            severity="warning"
            sx={{ mt: 1, '& .MuiAlert-message': { minWidth: 0, overflowWrap: 'anywhere' } }}
            action={
              <IconButton size="small" color="inherit" aria-label={tLink('notice.dismiss', { name: nameOf(t, link) })} onClick={() => void dismiss(link)}>
                <CloseIcon fontSize="small" />
              </IconButton>
            }
          >
            <Typography id={`${titleId}-${link.id}`} variant="body2">
              <Trans t={tLink} i18nKey="notice.text" components={{ chat: <strong>{nameOf(t, link)}</strong> }} />
            </Typography>
            <Button size="small" variant="outlined" color="inherit" sx={{ mt: 1 }} aria-label={t('accounts.unlink', { name: nameOf(t, link) })} onClick={() => setUnlinking(link)}>
              {tLink('notice.unlink')}
            </Button>
          </Alert>
        ))}
      {links?.length === 0 && <Typography sx={{ color: 'text.secondary', mt: 1 }}>{t('accounts.empty')}</Typography>}
      {links && links.length > 0 && (
        <List aria-labelledby={titleId}>
          {links.map((link) => (
            <ListItem
              key={link.id}
              disableGutters
              secondaryAction={
                <IconButton edge="end" aria-label={t('accounts.unlink', { name: nameOf(t, link) })} onClick={() => setUnlinking(link)}>
                  <LinkOffIcon />
                </IconButton>
              }
            >
              <ListItemIcon sx={{ minWidth: 40 }}>{sourceIcon(link.platform)}</ListItemIcon>
              {/* A chat name can be 64 characters with no spaces: let it break anywhere rather than widen the page. */}
              <ListItemText
                primary={nameOf(t, link)}
                secondary={t('accounts.linkedOn', { date: formatDate(link.createdAt, language) })}
                slotProps={{ primary: { sx: { overflowWrap: 'anywhere' } } }}
              />
            </ListItem>
          ))}
        </List>
      )}
      <ConfirmDialog
        open={unlinking !== null}
        title={t('accounts.unlinkTitle')}
        message={unlinking ? t('accounts.unlinkMessage', { name: nameOf(t, unlinking) }) : ''}
        confirmLabel={t('accounts.unlinkConfirm')}
        destructive
        onConfirm={() => void unlink()}
        onCancel={() => setUnlinking(null)}
      />
    </Paper>
  );
}
