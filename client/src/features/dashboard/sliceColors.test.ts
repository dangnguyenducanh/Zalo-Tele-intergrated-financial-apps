import { expect, test } from 'vitest';
import { FALLBACK_COLORS, sliceColors } from './sliceColors';
import type { CategoryTotal } from './statsApi';

const row = (categoryId: string): CategoryTotal => ({ categoryId, name: categoryId, total: 1, percent: 1 });

test('TC-NF-12 every category row keeps its category colour, and no two rows of one breakdown share a colour', () => {
  // Two categories with their own colours, a third that repeats one of them, and six with none.
  const own: Record<string, string> = { housing: '#7B1FA2', food: '#EF6C00', bills: '#ef6c00' };
  const rows = ['housing', 'food', 'bills', 'a', 'b', 'c', 'd', 'e', 'f'].map(row);

  const colors = sliceColors(rows, (id) => own[id]);

  expect(colors.slice(0, 2)).toEqual(['#7b1fa2', '#ef6c00']); // the colour on the category's icon elsewhere in the app
  expect(FALLBACK_COLORS).toContain(colors[2]); // a repeated colour gives way to a fallback
  expect(new Set(colors).size).toBe(rows.length); // nine rows, nine colours
});

test('TC-NF-12 a fallback colour already used by a category is skipped', () => {
  const colors = sliceColors(['own', 'none'].map(row), (id) => (id === 'own' ? FALLBACK_COLORS[0] : undefined));
  expect(colors).toEqual([FALLBACK_COLORS[0], FALLBACK_COLORS[1]]);
});
