import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  ListItemIcon,
  ListItemText,
  MenuItem,
  TextField,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import { createElement, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { showSnackbar } from '@/app/uiSlice';
import { categoryName, useCreateCategoryMutation, useUpdateCategoryMutation, type Category, type CategoryType } from './categoriesApi';
import { apiErrorMessage } from './helpers';
import { CATEGORY_ICONS, DEFAULT_COLOR, DEFAULT_ICON, ICON_NAMES, iconOf } from './icons';
import KeywordInput from './KeywordInput';

type Props = {
  type: CategoryType; // the tab the dialog was opened from (used when adding)
  category?: Category; // the category to edit; absent = add a new one
  onClose: () => void;
};

// Add/edit dialog for one category: name, icon, colour and bot keywords (docs/05 §5.7).
export default function CategoryDialog({ type, category, onClose }: Props) {
  const { t } = useTranslation('categories');
  const dispatch = useAppDispatch();
  const language = useAppSelector((s) => s.ui.language);
  const fullScreen = useMediaQuery(useTheme().breakpoints.down('sm'));
  const [createCategory, created] = useCreateCategoryMutation();
  const [updateCategory, updated] = useUpdateCategoryMutation();

  const shownName = category ? categoryName(category, language) : '';
  const [name, setName] = useState(shownName);
  const [icon, setIcon] = useState(category?.icon && category.icon in CATEGORY_ICONS ? category.icon : DEFAULT_ICON);
  const [color, setColor] = useState(category?.color || DEFAULT_COLOR);
  const [keywords, setKeywords] = useState(category?.keywords ?? []);
  const [nameError, setNameError] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed.length < 1 || trimmed.length > 40) {
      setNameError(true);
      (event.currentTarget.elements.namedItem('name') as HTMLElement | null)?.focus();
      return;
    }
    setNameError(false);
    try {
      if (category) {
        // A default copy keeps its vi/en names (so it follows the UI language) unless the user renames it.
        const renamed = trimmed !== shownName ? { name: trimmed } : {};
        await updateCategory({ id: category.id, ...renamed, keywords, icon, color }).unwrap();
      } else {
        await createCategory({ type, name: trimmed, keywords, icon, color }).unwrap();
      }
      dispatch(showSnackbar({ message: t('saved'), severity: 'success' }));
      onClose();
    } catch (error) {
      setServerError(apiErrorMessage(error));
    }
  }

  return (
    <Dialog open onClose={onClose} fullScreen={fullScreen} fullWidth maxWidth="sm">
      {/* display: contents keeps the dialog's flex layout (scrolling content, fixed actions) */}
      <form noValidate onSubmit={onSubmit} style={{ display: 'contents' }}>
        <DialogTitle>{category ? t('dialog.editTitle') : t(`dialog.addTitle.${type}`)}</DialogTitle>
        <DialogContent>
          {serverError && <Alert severity="error">{serverError}</Alert>}
          <TextField
            name="name"
            label={t('fields.name')}
            value={name}
            onChange={(event) => setName(event.target.value)}
            error={nameError}
            helperText={nameError ? t('validation.name') : undefined}
            required
            autoFocus
            fullWidth
            margin="normal"
            slotProps={{ htmlInput: { maxLength: 40 } }}
          />
          <TextField
            select
            name="icon"
            label={t('fields.icon')}
            value={icon}
            onChange={(event) => setIcon(event.target.value)}
            fullWidth
            margin="normal"
            sx={{ '& .MuiSelect-select': { display: 'flex', alignItems: 'center' } }} // icon and label on one line
          >
            {ICON_NAMES.map((iconName) => (
              <MenuItem key={iconName} value={iconName}>
                <ListItemIcon>{createElement(iconOf(iconName), { fontSize: 'small' })}</ListItemIcon>
                <ListItemText>{t(`icons.${iconName}`)}</ListItemText>
              </MenuItem>
            ))}
          </TextField>
          <TextField
            type="color"
            name="color"
            label={t('fields.color')}
            value={color}
            onChange={(event) => setColor(event.target.value)}
            fullWidth
            margin="normal"
          />
          <KeywordInput label={t('fields.keywords')} helperText={t('fields.keywordsHelp')} value={keywords} onChange={setKeywords} />
        </DialogContent>
        <DialogActions>
          <Button type="button" onClick={onClose}>
            {t('common:cancel')}
          </Button>
          <Button type="submit" variant="contained" loading={created.isLoading || updated.isLoading}>
            {t('save')}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
