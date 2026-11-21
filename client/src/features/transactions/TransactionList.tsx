import {
  alpha,
  Box,
  Chip,
  IconButton,
  List,
  ListItem,
  ListItemAvatar,
  ListItemText,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import { createElement } from 'react';
import { Pencil, Trash2 } from '@/components/icons';
import { useTranslation } from 'react-i18next';
import { useAppSelector } from '@/app/hooks';
import { categoryName, useGetCategoriesQuery } from '@/features/categories/categoriesApi';
import { DEFAULT_COLOR, iconOf } from '@/features/categories/icons';
import { useGetWalletsQuery } from '@/features/wallets/walletsApi';
import { formatDate } from '@/i18n/format';
import { signedMoney } from './helpers';
import type { Transaction } from './transactionsApi';

type Props = { items: Transaction[]; onEdit: (transaction: Transaction) => void; onDelete: (transaction: Transaction) => void };

// One page of transactions: a table from `sm` up, a card list on phones (docs/05 §5.4).
export default function TransactionList({ items, onEdit, onDelete }: Props) {
  const { t } = useTranslation('transactions');
  const language = useAppSelector((s) => s.ui.language);
  const phone = useMediaQuery(useTheme().breakpoints.down('sm'));
  const { data: categories = [] } = useGetCategoriesQuery();
  const { data: wallets = [] } = useGetWalletsQuery({ includeArchived: true });

  const rows = items.map((transaction) => {
    const category = categories.find((c) => c.id === transaction.categoryId);
    const categoryLabel = category ? categoryName(category, language) : '';
    const name = transaction.note || categoryLabel; // what the edit/delete buttons are called
    return {
      transaction,
      categoryLabel,
      avatar: (
        // A round soft tile with the category's icon in its colour (draft 3).
        <Box aria-hidden sx={{ width: 34, height: 34, borderRadius: '50%', flexShrink: 0, display: 'grid', placeItems: 'center', color: category?.color || DEFAULT_COLOR, bgcolor: alpha(category?.color || DEFAULT_COLOR, 0.14) }}>
          {createElement(iconOf(category?.icon ?? ''), { fontSize: 'small' })}
        </Box>
      ),
      wallet: wallets.find((w) => w.id === transaction.walletId)?.name ?? '',
      date: formatDate(transaction.occurredAt, language),
      amount: (
        <Typography component="span" sx={{ fontWeight: 500, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', color: transaction.type === 'income' ? 'success.main' : 'text.primary' }}>
          {signedMoney(transaction.type, transaction.amount, language)}
        </Typography>
      ),
      draft: transaction.status === 'draft' && <Chip size="small" color="warning" variant="outlined" label={t('draft')} sx={{ ml: 1 }} />,
      actions: (
        <>
          <IconButton aria-label={t('actions.edit', { name })} onClick={() => onEdit(transaction)}>
            <Pencil size={16} strokeWidth={1.75} aria-hidden />
          </IconButton>
          <IconButton aria-label={t('actions.delete', { name })} onClick={() => onDelete(transaction)}>
            <Trash2 size={16} strokeWidth={1.75} aria-hidden />
          </IconButton>
        </>
      ),
    };
  });

  if (phone) {
    return (
      <Paper variant="outlined">
        <List aria-label={t('listLabel')}>
          {rows.map((row) => (
            <ListItem key={row.transaction.id} secondaryAction={row.actions} sx={{ pr: 13 }}>
              <ListItemAvatar sx={{ minWidth: 48 }}>{row.avatar}</ListItemAvatar>
              <ListItemText
                primary={
                  <>
                    {row.amount} {row.draft}
                  </>
                }
                secondary={[row.transaction.note, row.categoryLabel, row.wallet, row.date].filter(Boolean).join(' · ')}
              />
            </ListItem>
          ))}
        </List>
      </Paper>
    );
  }

  // A focusable, named region so keyboard users can scroll a wide table (modern-web-guidance `responsive-table`).
  return (
    <TableContainer component={Paper} variant="outlined" role="region" aria-label={t('listLabel')} tabIndex={0}>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>{t('columns.date')}</TableCell>
            <TableCell>{t('columns.description')}</TableCell>
            <TableCell>{t('columns.wallet')}</TableCell>
            <TableCell align="right">{t('columns.amount')}</TableCell>
            <TableCell align="right">{t('columns.actions')}</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.transaction.id} hover>
              <TableCell sx={{ whiteSpace: 'nowrap' }}>{row.date}</TableCell>
              <TableCell component="th" scope="row">
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                  {row.avatar}
                  <div>
                    <Typography component="span" variant="body2" sx={{ fontWeight: 500 }}>
                      {row.categoryLabel}
                    </Typography>
                    {row.draft}
                    <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                      {row.transaction.note || t('noNote')}
                    </Typography>
                  </div>
                </Box>
              </TableCell>
              <TableCell>{row.wallet}</TableCell>
              <TableCell align="right">{row.amount}</TableCell>
              <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                {row.actions}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
