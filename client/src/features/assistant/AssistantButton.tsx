import { Box, Button } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { useAppDispatch } from '@/app/hooks';
import { assistantOpened } from '@/app/uiSlice';
import { Sparkles } from '@/components/icons';
import { strongLine } from '@/theme/theme';

// "✨ Hỏi Sổ chi tiêu" beside the month picker on the Dashboard (docs/05 §5.10.1). On phones only the icon shows; its name stays.
export default function AssistantButton() {
  const { t } = useTranslation('assistant');
  const dispatch = useAppDispatch();
  return (
    <Button
      variant="outlined"
      color="inherit"
      aria-label={t('open')}
      onClick={() => dispatch(assistantOpened())}
      startIcon={<Sparkles size={16} strokeWidth={1.75} aria-hidden />}
      sx={(theme) => ({
        height: 34,
        minWidth: 34,
        px: { xs: 0, sm: 1.5 },
        borderColor: strongLine(theme),
        bgcolor: 'background.paper',
        borderRadius: '4px',
        fontSize: '0.8125rem',
        whiteSpace: 'nowrap',
        '& .MuiButton-startIcon': { m: { xs: 0, sm: '0 6px 0 -2px' } },
      })}
    >
      <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>
        {t('open')}
      </Box>
    </Button>
  );
}
