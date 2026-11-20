import { Stack, Typography } from '@mui/material';
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
      {icon}
      <Typography variant="h5" component={headingLevel}>
        {heading}
      </Typography>
      {description && <Typography sx={{ color: 'text.secondary', maxWidth: 480 }}>{description}</Typography>}
      {action}
    </Stack>
  );
}
