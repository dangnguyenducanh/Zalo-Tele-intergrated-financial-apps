import { Box, Stack, Typography } from '@mui/material';
import type { ReactNode } from 'react';

type Props = {
  heading: string;
  description?: string;
  icon?: ReactNode;
  action?: ReactNode;
  headingLevel?: 'h1' | 'h2';
};

// A centred message for "nothing here yet", "not allowed" and similar states.
export default function EmptyState({ heading, description, icon, action, headingLevel = 'h1' }: Props) {
  return (
    <Stack spacing={1.5} sx={{ alignItems: 'center', textAlign: 'center', py: 6, px: 2 }}>
      {icon && (
        <Box
          aria-hidden
          sx={{
            width: 48,
            height: 48,
            borderRadius: '6px',
            border: 1,
            borderColor: 'divider',
            display: 'grid',
            placeItems: 'center',
            bgcolor: 'panel2',
            color: 'text.secondary',
            '& .MuiSvgIcon-root': { fontSize: 24 },
          }}
        >
          {icon}
        </Box>
      )}
      <Typography variant="h6" component={headingLevel}>
        {heading}
      </Typography>
      {description && <Typography sx={{ color: 'text.secondary', maxWidth: 480 }}>{description}</Typography>}
      {action}
    </Stack>
  );
}
