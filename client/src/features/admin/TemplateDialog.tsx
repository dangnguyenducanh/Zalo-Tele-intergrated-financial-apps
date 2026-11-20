import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, TextField, useMediaQuery, useTheme } from '@mui/material';
import { useId, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppDispatch } from '@/app/hooks';
import { showSnackbar } from '@/app/uiSlice';
import { errorMessage } from '@/i18n/errors';
import { errorCodeOf, useCreateTemplateMutation, useUpdateTemplateMutation, type CategoryTemplate, type CategoryType, type TemplateInput } from './adminApi';

type Props = {
  type: CategoryType; // the tab the admin is on; a template keeps its type
  template: CategoryTemplate | null; // null = add a new one
  onClose: () => void;
};

// "phở, Bún bò ,, cafe" → ["phở", "Bún bò", "cafe"]. The server lower-cases and strips the diacritics.
const splitKeywords = (text: string) => text.split(',').map((word) => word.trim()).filter(Boolean);

// Add or edit a default category. Mount it only while open, so every opening starts from fresh values.
// The browser checks the required fields and lengths itself (native constraints) before submit runs.
export default function TemplateDialog({ type, template, onClose }: Props) {
  const { t } = useTranslation('admin');
  const dispatch = useAppDispatch();
  const fullScreen = useMediaQuery(useTheme().breakpoints.down('sm'));
  const titleId = useId();
  const [create, created] = useCreateTemplateMutation();
  const [update, updated] = useUpdateTemplateMutation();
  const [errorCode, setErrorCode] = useState<string | null>(null);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const text = (name: string) => String(form.get(name) ?? '').trim();
    const fields: TemplateInput = {
      names: { vi: text('vi'), en: text('en') },
      keywords: splitKeywords(text('keywords')),
      icon: text('icon'),
      color: text('color'),
    };
    setErrorCode(null);
    try {
      if (template) await update({ id: template.id, changes: fields }).unwrap();
      else await create({ ...fields, type }).unwrap();
      dispatch(showSnackbar({ message: t('categories.saved'), severity: 'success' }));
      onClose();
    } catch (error) {
      setErrorCode(errorCodeOf(error));
    }
  }

  const field = { fullWidth: true, margin: 'normal' as const, slotProps: { htmlInput: { maxLength: 40 } } };
  return (
    <Dialog
      open
      fullScreen={fullScreen}
      // A click outside must not throw away what was typed; Escape and Cancel still close it.
      onClose={(_event, reason) => reason !== 'backdropClick' && onClose()}
      aria-labelledby={titleId}
    >
      <form onSubmit={save}>
        <DialogTitle id={titleId}>{t(template ? 'categories.editTitle' : `categories.addTitle.${type}`)}</DialogTitle>
        <DialogContent>
          {errorCode && (
            <Alert severity="error" role="alert">
              {errorMessage(errorCode)}
            </Alert>
          )}
          <TextField {...field} name="vi" label={t('categories.nameVi')} defaultValue={template?.names.vi} required autoFocus />
          <TextField {...field} name="en" label={t('categories.nameEn')} defaultValue={template?.names.en} required />
          <TextField
            {...field}
            name="keywords"
            label={t('categories.keywords')}
            helperText={t('categories.keywordsHelp')}
            defaultValue={template?.keywords.join(', ')}
            slotProps={{ htmlInput: { autoCapitalize: 'none', spellCheck: false } }}
          />
          <TextField {...field} name="icon" label={t('categories.icon')} helperText={t('categories.iconHelp')} defaultValue={template?.icon} />
          <TextField {...field} name="color" type="color" label={t('categories.color')} defaultValue={template?.color || '#9e9e9e'} />
        </DialogContent>
        <DialogActions>
          <Button type="button" onClick={onClose}>
            {t('common:cancel')}
          </Button>
          <Button type="submit" variant="contained" loading={created.isLoading || updated.isLoading}>
            {t('categories.save')}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
