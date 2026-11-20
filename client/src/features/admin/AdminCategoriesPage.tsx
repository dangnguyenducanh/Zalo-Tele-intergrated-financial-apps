import AddIcon from '@mui/icons-material/Add';
import { Alert, Box, Button, Chip, Stack, Tab, Table, TableBody, TableCell, TableHead, TableRow, Tabs, Typography } from '@mui/material';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppDispatch } from '@/app/hooks';
import { showSnackbar } from '@/app/uiSlice';
import ConfirmDialog from '@/components/ConfirmDialog';
import { errorMessage } from '@/i18n/errors';
import { errorCodeOf, useDeleteTemplateMutation, useGetTemplatesQuery, type CategoryTemplate, type CategoryType } from './adminApi';
import { tableWrapperSx } from './tableSx';
import TemplateDialog from './TemplateDialog';

const TYPES: CategoryType[] = ['expense', 'income'];

// /admin/categories (docs/05 §5.7): the default categories every new user gets a copy of.
// Tabs by type; vi/en names, bot keywords and colour; add, edit and delete.
export default function AdminCategoriesPage() {
  const { t } = useTranslation('admin');
  const dispatch = useAppDispatch();
  const id = useId();
  const [type, setType] = useState<CategoryType>('expense');
  const [editing, setEditing] = useState<CategoryTemplate | 'new' | null>(null);
  const [deleting, setDeleting] = useState<CategoryTemplate | null>(null);
  const { data: templates, isError } = useGetTemplatesQuery(type);
  const [deleteTemplate] = useDeleteTemplateMutation();

  async function confirmDelete() {
    if (!deleting) return;
    const template = deleting;
    setDeleting(null);
    try {
      await deleteTemplate(template.id).unwrap();
      dispatch(showSnackbar({ message: t('categories.deleted', { name: template.names.vi }), severity: 'success' }));
    } catch (error) {
      dispatch(showSnackbar({ message: errorMessage(errorCodeOf(error)), severity: 'error' }));
    }
  }

  return (
    <>
      <title>{`${t('categories.title')} · ${t('common:appName')}`}</title>
      <Typography variant="h4" component="h1" gutterBottom>
        {t('categories.title')}
      </Typography>
      <Typography sx={{ color: 'text.secondary', mb: 2 }}>{t('categories.intro')}</Typography>

      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1, mb: 1 }}>
        {/* modern-web-guidance `tabs`: no aria-controls (no screen reader uses it); the indicator also gets a
            border, because forced-colors mode drops its background and would leave no visible selection. */}
        <Tabs
          value={type}
          onChange={(_event, next: CategoryType) => setType(next)}
          aria-label={t('categories.typeTabs')}
          sx={{ '& .MuiTabs-indicator': { borderBottom: 2, borderColor: 'primary.main', boxSizing: 'border-box' } }}
        >
          {TYPES.map((value) => (
            <Tab key={value} value={value} label={t(`categories.types.${value}`)} id={`${id}-tab-${value}`} />
          ))}
        </Tabs>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setEditing('new')}>
          {t('categories.add')}
        </Button>
      </Stack>

      <Box role="tabpanel" aria-labelledby={`${id}-tab-${type}`}>
        {isError && <Alert severity="error">{errorMessage('GENERIC')}</Alert>}
        <Box role="region" aria-labelledby={`${id}-caption`} tabIndex={0} sx={tableWrapperSx}>
          <Table size="small">
            <caption id={`${id}-caption`} style={{ captionSide: 'top', textAlign: 'start', padding: '8px 0' }}>
              {templates ? t('categories.caption', { count: templates.length }) : t('common:loading')}
            </caption>
            <TableHead>
              <TableRow>
                <TableCell>{t('categories.nameVi')}</TableCell>
                <TableCell>{t('categories.nameEn')}</TableCell>
                <TableCell>{t('categories.keywords')}</TableCell>
                <TableCell>{t('categories.actions')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {templates?.map((template) => (
                <TableRow key={template.id}>
                  <TableCell component="th" scope="row">
                    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                      <Box aria-hidden sx={{ width: 14, height: 14, borderRadius: '50%', bgcolor: template.color || 'action.disabled', flexShrink: 0 }} />
                      <strong>{template.names.vi}</strong>
                      {template.isFallback && <Chip size="small" variant="outlined" label={t('categories.fallback')} />}
                    </Stack>
                  </TableCell>
                  <TableCell data-label={t('categories.nameEn')}>{template.names.en}</TableCell>
                  <TableCell data-label={t('categories.keywords')}>
                    {template.keywords.length === 0
                      ? '—'
                      : template.keywords.map((word) => <Chip key={word} size="small" label={word} sx={{ m: 0.25 }} />)}
                  </TableCell>
                  <TableCell>
                    <Stack direction="row" spacing={1}>
                      <Button size="small" aria-label={`${t('categories.edit')} ${template.names.vi}`} onClick={() => setEditing(template)}>
                        {t('categories.edit')}
                      </Button>
                      {/* The fallback "Khác / Other" gets the transactions of deleted categories, so it stays. */}
                      {!template.isFallback && (
                        <Button size="small" color="error" aria-label={`${t('categories.delete')} ${template.names.vi}`} onClick={() => setDeleting(template)}>
                          {t('categories.delete')}
                        </Button>
                      )}
                    </Stack>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
      </Box>

      {editing && <TemplateDialog type={type} template={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      <ConfirmDialog
        open={deleting !== null}
        title={t('categories.confirmDelete.title')}
        message={t('categories.confirmDelete.message', { name: deleting?.names.vi })}
        confirmLabel={t('categories.delete')}
        destructive
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleting(null)}
      />
    </>
  );
}
