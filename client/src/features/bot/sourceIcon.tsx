import EditNoteIcon from '@mui/icons-material/EditNote';
import ReceiptIcon from '@mui/icons-material/Receipt';
import SmsIcon from '@mui/icons-material/Sms';
import TelegramIcon from '@mui/icons-material/Telegram';
import type { Transaction } from '@/features/transactions/transactionsApi';

// Where a draft or a chat link came from. The icon is decorative: the label text next to it says the same.
export function sourceIcon(source: Transaction['source']) {
  if (source === 'telegram') return <TelegramIcon />;
  if (source === 'zalo') return <SmsIcon />; // Material has no Zalo logo
  if (source === 'receipt') return <ReceiptIcon />;
  return <EditNoteIcon />;
}
