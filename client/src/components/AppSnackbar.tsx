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
        <Alert severity={snackbar.severity} onClose={close} variant="filled">
          {snackbar.message}
        </Alert>
      ) : undefined}
    </Snackbar>
  );
}
