import { TextField, type TextFieldProps } from '@mui/material';
import type { ClipboardEvent, Ref } from 'react';

export const CODE_LENGTH = 6;

const digitsOnly = (text: string) => text.replace(/\D/g, '').slice(0, CODE_LENGTH);

type Props = Pick<TextFieldProps, 'label' | 'error' | 'helperText' | 'autoFocus' | 'disabled'> & {
  value: string;
  onChange: (value: string) => void;
  // Called with the code once its 6th digit is typed or pasted. Leave it out (or pass autoSubmit={false}) for a
  // screen that has more to fill in before it submits, such as the new password on /forgot-password.
  onComplete?: (code: string) => void;
  autoSubmit?: boolean;
  inputRef?: Ref<HTMLInputElement>;
};

// The one box for a 6-digit emailed code (docs/05 §5.11.2): one input, not six, so paste and screen readers work.
export default function CodeInput({ value, onChange, onComplete, autoSubmit = true, inputRef, ...field }: Props) {
  function change(next: string) {
    onChange(next);
    if (autoSubmit && next.length === CODE_LENGTH && next !== value) onComplete?.(next);
  }

  // maxLength would cut a pasted "123 456" to "123 45" before onChange sees it, so paste is cleaned here first.
  function paste(event: ClipboardEvent<HTMLElement>) {
    event.preventDefault();
    const next = digitsOnly(event.clipboardData.getData('text'));
    if (next) change(next);
  }

  return (
    <TextField
      {...field}
      value={value}
      onChange={(event) => change(digitsOnly(event.target.value))}
      onPaste={paste}
      inputRef={inputRef}
      fullWidth
      margin="normal"
      slotProps={{
        htmlInput: {
          inputMode: 'numeric',
          autoComplete: 'one-time-code',
          maxLength: CODE_LENGTH,
          pattern: `\\d{${CODE_LENGTH}}`,
          sx: { fontSize: '1.5rem', letterSpacing: '0.35em', fontVariantNumeric: 'tabular-nums' },
        },
      }}
    />
  );
}
