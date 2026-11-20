import { Autocomplete, TextField } from '@mui/material';
import { normalizeKeywords } from './helpers';

type Props = {
  label: string;
  helperText: string;
  value: string[];
  onChange: (keywords: string[]) => void;
};

// A chip input for bot keywords (and wallet aliases). Enter or leaving the field turns the typed text
// into chips (a comma splits it), normalised the way the bot parser compares words: "Phở Bò" → "pho bo".
export default function KeywordInput({ label, helperText, value, onChange }: Props) {
  return (
    <Autocomplete
      multiple
      freeSolo
      autoSelect // the text still in the box when focus leaves (e.g. clicking Save) becomes a chip too
      options={[]}
      value={value}
      onChange={(_event, words) => onChange(normalizeKeywords(words))}
      renderInput={(params) => <TextField {...params} name="keywords" label={label} helperText={helperText} margin="normal" />}
    />
  );
}
