import { Alert, Snackbar } from '@mui/material';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { hideSnackbar } from '@/app/uiSlice';

// Shows uiSlice.snackbar. Any page can call dispatch(showSnackbar({ message, severity })).
export default function AppSnackbar() {
  const dispatch = useAppDispatch();
  const snackbar = useAppSelector((s) => s.ui.snackbar);
  const close = () => dispatch(hideSnackbar());
  return (
    <Snackbar open={snackbar !== null} autoHideDuration={6000} onClose={close} sx={{ bottom: { xs: 80, md: 24 } }}>
      {snackbar ? (
        // Messages can name a chat or a category, user text with no spaces: wrap it, never run off the screen (BUG-030).
        <Alert severity={snackbar.severity} onClose={close} variant="filled" sx={{ '& .MuiAlert-message': { overflowWrap: 'anywhere' } }}>
          {snackbar.message}
        </Alert>
      ) : undefined}
    </Snackbar>
  );
}
