import { Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle } from '@mui/material';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';

type Props = {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

// A modal yes/no question. MUI Dialog gives what a native modal <dialog> gives: the page behind is
// inert, focus stays inside, Escape cancels and focus returns to the button that opened it.
// Focus starts on Cancel, so pressing Enter by accident never runs a destructive action.
export default function ConfirmDialog({ open, title, message, confirmLabel, destructive, onConfirm, onCancel }: Props) {
  const { t } = useTranslation();
  const id = useId();
  return (
    <Dialog open={open} onClose={onCancel} aria-labelledby={`${id}-title`} aria-describedby={`${id}-message`}>
      <DialogTitle id={`${id}-title`}>{title}</DialogTitle>
      <DialogContent>
        <DialogContentText id={`${id}-message`}>{message}</DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel} autoFocus>
          {t('cancel')}
        </Button>
        <Button onClick={onConfirm} variant="contained" color={destructive ? 'error' : 'primary'}>
          {confirmLabel ?? t('confirm')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
