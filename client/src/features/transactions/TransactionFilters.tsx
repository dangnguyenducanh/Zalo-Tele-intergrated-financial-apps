import { Box, Button, Grid, TextField, type TextFieldProps } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { useAppSelector } from '@/app/hooks';
import { categoryName, useGetCategoriesQuery } from '@/features/categories/categoriesApi';
import { useGetWalletsQuery } from '@/features/wallets/walletsApi';
import type { FilterKey, Filters } from './helpers';
import type { TransactionType } from './transactionsApi';

const TYPES: TransactionType[] = ['expense', 'income'];

type Props = { filters: Filters; onChange: (key: FilterKey, value: string) => void; onClear: () => void };

// The filter bar (docs/05 §5.7): search, date range, type, wallet, category, status. The page keeps the values
// in the URL query string, so a filtered list can be bookmarked, shared, or reached with Back.
export default function TransactionFilters({ filters, onChange, onClear }: Props) {
  const { t } = useTranslation('transactions');
  const language = useAppSelector((s) => s.ui.language);
  const { data: categories = [] } = useGetCategoriesQuery();
  const { data: wallets = [] } = useGetWalletsQuery({ includeArchived: true }); // old transactions may use archived ones

  const field = (key: FilterKey): TextFieldProps => ({
    name: key,
    label: t(`filters.${key === 'walletId' ? 'wallet' : key === 'categoryId' ? 'category' : key}`),
    value: filters[key] ?? '',
    onChange: (event) => onChange(key, event.target.value),
    size: 'small',
    fullWidth: true,
    slotProps: { select: { native: true }, inputLabel: { shrink: true } }, // native <select>: the phone's own picker
  });
  const all = <option value="">{t('filters.all')}</option>;

  return (
    <Box role="search" aria-label={t('filters.label')} sx={{ mb: 2 }}>
      <Grid container spacing={1.5}>
        <Grid size={{ xs: 12, md: 4 }}>
          <TextField {...field('q')} type="search" slotProps={{ htmlInput: { enterKeyHint: 'search', spellCheck: false } }} />
        </Grid>
        <Grid size={{ xs: 6, md: 2 }}>
          <TextField {...field('from')} type="date" />
        </Grid>
        <Grid size={{ xs: 6, md: 2 }}>
          <TextField {...field('to')} type="date" />
        </Grid>
        <Grid size={{ xs: 6, md: 2 }}>
          <TextField {...field('type')} select>
            {all}
            {TYPES.map((type) => (
              <option key={type} value={type}>
                {t(`types.${type}`)}
              </option>
            ))}
          </TextField>
        </Grid>
        <Grid size={{ xs: 6, md: 2 }}>
          <TextField {...field('status')} select>
            {all}
            <option value="confirmed">{t('statuses.confirmed')}</option>
            <option value="draft">{t('statuses.draft')}</option>
          </TextField>
        </Grid>
        <Grid size={{ xs: 6, md: 4 }}>
          <TextField {...field('walletId')} select>
            {all}
            {wallets.map((wallet) => (
              <option key={wallet.id} value={wallet.id}>
                {wallet.name}
              </option>
            ))}
          </TextField>
        </Grid>
        <Grid size={{ xs: 6, md: 4 }}>
          <TextField {...field('categoryId')} select>
            {all}
            {TYPES.filter((type) => !filters.type || filters.type === type).map((type) => (
              <optgroup key={type} label={t(`types.${type}`)}>
                {categories
                  .filter((category) => category.type === type)
                  .map((category) => (
                    <option key={category.id} value={category.id}>
                      {categoryName(category, language)}
                    </option>
                  ))}
              </optgroup>
            ))}
          </TextField>
        </Grid>
        <Grid size={{ xs: 12, md: 4 }} sx={{ display: 'flex', alignItems: 'center' }}>
          <Button onClick={onClear}>{t('filters.clear')}</Button>
        </Grid>
      </Grid>
    </Box>
  );
}
