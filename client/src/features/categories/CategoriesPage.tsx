import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import {
  Alert,
  Avatar,
  Box,
  Button,
  Chip,
  CircularProgress,
  IconButton,
  List,
  ListItem,
  ListItemAvatar,
  ListItemText,
  Paper,
  Stack,
  Tab,
  Tabs,
  Typography,
} from '@mui/material';
import { createElement, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { showSnackbar } from '@/app/uiSlice';
import ConfirmDialog from '@/components/ConfirmDialog';
import { categoryName, useDeleteCategoryMutation, useGetCategoriesQuery, type Category, type CategoryType } from './categoriesApi';
import CategoryDialog from './CategoryDialog';
import { apiErrorMessage } from './helpers';
import { DEFAULT_COLOR, iconOf } from './icons';

const TYPES: CategoryType[] = ['expense', 'income'];

// /categories: tabs Expense / Income, one row per category with its icon, colour and keyword chips (docs/05 §5.7).
export default function CategoriesPage() {
  const { t } = useTranslation('categories');
  const dispatch = useAppDispatch();
  const language = useAppSelector((s) => s.ui.language);
  const { data: categories = [], isLoading, isError, refetch } = useGetCategoriesQuery();
  const [deleteCategory] = useDeleteCategoryMutation();
  const [type, setType] = useState<CategoryType>('expense');
  const [editing, setEditing] = useState<Category | 'new' | null>(null); // which dialog is open
  const [deleting, setDeleting] = useState<Category | null>(null);

  const shown = categories.filter((category) => category.type === type);
  const fallback = categories.find((category) => category.type === deleting?.type && category.isFallback);

  async function confirmDelete(category: Category) {
    setDeleting(null);
    try {
      await deleteCategory(category.id).unwrap();
      dispatch(showSnackbar({ message: t('deleted'), severity: 'success' }));
    } catch (error) {
      dispatch(showSnackbar({ message: apiErrorMessage(error), severity: 'error' }));
    }
  }

  return (
    <>
      <title>{`${t('title')} · ${t('common:appName')}`}</title>
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 2, mb: 2 }}>
        <Typography variant="h4" component="h1" sx={{ typography: { xs: 'h5', sm: 'h4' } }}>
          {t('title')}
        </Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setEditing('new')}>
          {t('add')}
        </Button>
      </Stack>

      <Tabs value={type} onChange={(_event, value: CategoryType) => setType(value)} aria-label={t('typesLabel')} sx={{ mb: 1 }}>
        {TYPES.map((value) => (
          <Tab key={value} value={value} label={t(`types.${value}`)} id={`category-tab-${value}`} aria-controls="category-panel" />
        ))}
      </Tabs>

      <Box role="tabpanel" id="category-panel" aria-labelledby={`category-tab-${type}`}>
        {isLoading && <CircularProgress aria-label={t('common:loading')} sx={{ display: 'block', mx: 'auto', my: 4 }} />}
        {isError && (
          <Alert severity="error" action={<Button onClick={() => void refetch()}>{t('retry')}</Button>}>
            {t('loadError')}
          </Alert>
        )}
        {shown.length > 0 && (
          <Paper variant="outlined">
            <List>
              {shown.map((category) => (
                <CategoryRow
                  key={category.id}
                  category={category}
                  name={categoryName(category, language)}
                  onEdit={() => setEditing(category)}
                  onDelete={() => setDeleting(category)}
                />
              ))}
            </List>
          </Paper>
        )}
      </Box>

      {editing && <CategoryDialog type={type} category={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
      <ConfirmDialog
        open={deleting !== null}
        title={t('deleteConfirm.title')}
        message={t('deleteConfirm.message', {
          name: deleting ? categoryName(deleting, language) : '',
          fallback: fallback ? categoryName(fallback, language) : '',
        })}
        confirmLabel={t('deleteConfirm.confirm')}
        destructive
        onConfirm={() => deleting && void confirmDelete(deleting)}
        onCancel={() => setDeleting(null)}
      />
    </>
  );
}

type RowProps = { category: Category; name: string; onEdit: () => void; onDelete: () => void };

// One category: coloured icon, name, keyword chips, and edit/delete buttons. The fallback cannot be deleted.
function CategoryRow({ category, name, onEdit, onDelete }: RowProps) {
  const { t } = useTranslation('categories');
  const nameId = `category-${category.id}`;
  return (
    <ListItem
      aria-labelledby={nameId}
      secondaryAction={
        <>
          <IconButton aria-label={t('actions.edit', { name })} onClick={onEdit}>
            <EditIcon />
          </IconButton>
          {!category.isFallback && (
            <IconButton aria-label={t('actions.delete', { name })} onClick={onDelete} edge="end">
              <DeleteIcon />
            </IconButton>
          )}
        </>
      }
      sx={{ pr: 13 }}
    >
      <ListItemAvatar>
        <Avatar sx={{ bgcolor: category.color || DEFAULT_COLOR, color: '#fff' }}>{createElement(iconOf(category.icon))}</Avatar>
      </ListItemAvatar>
      <ListItemText
        primary={name}
        secondary={
          <>
            {category.isFallback && <Chip size="small" variant="outlined" label={t('fallback')} sx={{ mr: 0.5, mt: 0.5 }} />}
            {category.keywords.map((keyword) => (
              <Chip key={keyword} size="small" label={keyword} sx={{ mr: 0.5, mt: 0.5 }} />
            ))}
          </>
        }
        slotProps={{ primary: { id: nameId }, secondary: { component: 'div' } }}
      />
    </ListItem>
  );
}
