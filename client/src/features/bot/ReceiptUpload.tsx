import PhotoCameraIcon from '@mui/icons-material/PhotoCamera';
import { Alert, Button, Paper, Typography } from '@mui/material';
import { useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiErrorMessage } from '@/features/categories/helpers';
import { errorMessage } from '@/i18n/errors';
import { useUploadReceiptMutation } from './botApi';
import { resizeImage } from './resizeImage';

// Upload a receipt photo (F10): shrink it in the browser (≤ 1600 px JPEG), POST /api/receipts, and the server
// asks KIE to read it (20–40 s) and stores a draft, which then appears in the list below.
export default function ReceiptUpload() {
  const { t } = useTranslation('bot');
  const titleId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [uploadReceipt] = useUploadReceiptMutation();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(''); // read out politely by screen readers
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    setStatus(t('upload.reading'));
    const image = await resizeImage(file).catch(() => null); // null: the browser cannot open it as an image
    const failure = image
      ? await uploadReceipt(image)
          .unwrap()
          .then(() => null, apiErrorMessage) // KIE errors arrive as codes: RECEIPT_UNREADABLE, KIE_TIMEOUT, …
      : errorMessage('UNSUPPORTED_MEDIA_TYPE');
    setBusy(false);
    setStatus(failure ? '' : t('upload.done'));
    setError(failure);
  }

  return (
    <Paper component="section" variant="outlined" aria-labelledby={titleId} sx={{ p: 2 }}>
      <Typography id={titleId} variant="h6" component="h2">
        {t('upload.title')}
      </Typography>
      <Typography sx={{ color: 'text.secondary', mb: 2 }}>{t('upload.description')}</Typography>
      {/* accept="image/*" lets a phone offer its camera; whatever the format, it is re-encoded as JPEG */}
      <input
        ref={input}
        type="file"
        accept="image/*"
        hidden
        aria-label={t('upload.button')}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = ''; // so choosing the same photo again still uploads it
          if (file) void upload(file);
        }}
      />
      <Button variant="contained" startIcon={<PhotoCameraIcon />} loading={busy} loadingPosition="start" onClick={() => input.current?.click()}>
        {t('upload.button')}
      </Button>
      <Typography role="status" sx={{ mt: 1, minHeight: '1.5em' }}>
        {status}
      </Typography>
      {error && <Alert severity="error">{error}</Alert>}
    </Paper>
  );
}
