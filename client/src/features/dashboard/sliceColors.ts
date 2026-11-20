import type { CategoryTotal } from './statsApi';

// Used when a category has no colour of its own: distinct hues, so no two rows of one breakdown share a colour.
export const FALLBACK_COLORS = ['#256f82', '#d9822b', '#1d7a46', '#c0362c', '#3b82c4', '#b7950b', '#0f9d8a', '#a3542e', '#5d6168', '#7a8b2b'];

// Each row takes its category's own colour (the one on its icon in Categories); a category without one,
// or whose colour an earlier row already uses, takes the next unused fallback colour (TC-NF-12).
export function sliceColors(rows: CategoryTotal[], colorOf: (categoryId: string) => string | undefined): string[] {
  const used = new Set<string>();
  const fallback = FALLBACK_COLORS.filter((color) => !rows.some((row) => colorOf(row.categoryId)?.toLowerCase() === color));
  return rows.map((row, i) => {
    const own = colorOf(row.categoryId)?.toLowerCase();
    const color = own && !used.has(own) ? own : (fallback.find((c) => !used.has(c)) ?? FALLBACK_COLORS[i % FALLBACK_COLORS.length]!);
    used.add(color);
    return color;
  });
}
