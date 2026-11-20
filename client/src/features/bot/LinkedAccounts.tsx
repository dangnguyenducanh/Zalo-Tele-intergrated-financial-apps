import LinkOffIcon from '@mui/icons-material/LinkOff';
import { IconButton, List, ListItem, ListItemIcon, ListItemText, Paper, Typography } from '@mui/material';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { showSnackbar } from '@/app/uiSlice';
import ConfirmDialog from '@/components/ConfirmDialog';
import { apiErrorMessage } from '@/features/categories/helpers';
import { formatDate } from '@/i18n/format';
import { useDeleteChatLinkMutation, useGetChatLinksQuery, type ChatLink } from './botApi';
import { sourceIcon } from './sourceIcon';

// The Telegram/Zalo accounts linked to this web account (GET /chat-links), each with Unlink (DELETE /chat-links/:id).
export default function LinkedAccounts() {
  const { t } = useTranslation('bot');
  const titleId = useId();
  const dispatch = useAppDispatch();
  const language = useAppSelector((s) => s.ui.language);
  const { data: links } = useGetChatLinksQuery();
  const [deleteChatLink] = useDeleteChatLinkMutation();
  const [unlinking, setUnlinking] = useState<ChatLink | null>(null);

  const nameOf = (link: ChatLink) => `${t(`sources.${link.platform}`)} · ${link.displayName || link.platform}`;

  async function unlink() {
    const link = unlinking;
    setUnlinking(null);
    if (!link) return;
    try {
      await deleteChatLink(link.id).unwrap();
      dispatch(showSnackbar({ message: t('accounts.unlinked', { name: nameOf(link) }), severity: 'success' }));
    } catch (error) {
      dispatch(showSnackbar({ message: apiErrorMessage(error), severity: 'error' }));
    }
  }

  return (
    <Paper component="section" variant="outlined" aria-labelledby={titleId} sx={{ p: 2 }}>
      <Typography id={titleId} variant="h6" component="h2">
        {t('accounts.title')}
      </Typography>
      {links?.length === 0 && <Typography sx={{ color: 'text.secondary', mt: 1 }}>{t('accounts.empty')}</Typography>}
      {links && links.length > 0 && (
        <List aria-labelledby={titleId}>
          {links.map((link) => (
            <ListItem
              key={link.id}
              disableGutters
              secondaryAction={
                <IconButton edge="end" aria-label={t('accounts.unlink', { name: nameOf(link) })} onClick={() => setUnlinking(link)}>
                  <LinkOffIcon />
                </IconButton>
              }
            >
              <ListItemIcon sx={{ minWidth: 40 }}>{sourceIcon(link.platform)}</ListItemIcon>
              <ListItemText primary={nameOf(link)} secondary={t('accounts.linkedOn', { date: formatDate(link.createdAt, language) })} />
            </ListItem>
          ))}
        </List>
      )}
      <ConfirmDialog
        open={unlinking !== null}
        title={t('accounts.unlinkTitle')}
        message={unlinking ? t('accounts.unlinkMessage', { name: nameOf(unlinking) }) : ''}
        confirmLabel={t('accounts.unlinkConfirm')}
        destructive
        onConfirm={() => void unlink()}
        onCancel={() => setUnlinking(null)}
      />
    </Paper>
  );
}
