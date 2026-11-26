import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { expect, test } from 'vitest';
import { makeStore } from '@/app/store';
import { formatMoney } from '@/i18n/format';
import i18n from '@/i18n';
import { AppThemeProvider } from '@/theme/AppThemeProvider';
import fixture from '../../../../shared/fixtures/compare-range.json';
import { MonthCompare } from './Charts';
import type { DayTotal } from './statsApi';
import { previousMonth } from './weekly';

// Every day of a month spends day-of-month × 1.000 ₫, so a range 01..N adds up to N(N+1)/2 thousand and a week's total
// is known without running the code under test.
const monthDays = (month: string): DayTotal[] => {
  const [year = 0, mon = 1] = month.split('-').map(Number);
  const length = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  return Array.from({ length }, (_, i) => ({ date: `${month}-${String(i + 1).padStart(2, '0')}`, income: 0, expense: (i + 1) * 1000 }));
};
const thousandsUpTo = (day: number) => (day * (day + 1)) / 2;
const dayOf = (date: string) => Number(date.slice(8));
const spaced = (text: string) => text.replace(/\s/g, ' '); // jest-dom collapses the no-break space of "1.000 ₫" to a plain one

function renderCompare(month: string, today: string) {
  return render(
    <Provider store={makeStore()}>
      <AppThemeProvider>
        <MonthCompare month={month} today={today} days={monthDays(month)} previousDays={monthDays(previousMonth(month))} />
      </AppThemeProvider>
    </Provider>,
  );
}

// The sentence of the case, in Vietnamese: this month's figure, then more, less or equal "cùng kỳ tháng trước".
test.each(fixture.monthCompare)('TC-F14-03 MonthCompare compares the same days: $name', ({ month, today, current, previous }) => {
  renderCompare(month, today);

  const now = thousandsUpTo(dayOf(current.to)) * 1000;
  const before = thousandsUpTo(dayOf(previous.to)) * 1000;
  const money = (amount: number) => spaced(formatMoney(amount, 'vi'));
  const sentence =
    now > before
      ? `Tháng này chi ${money(now)}, nhiều hơn cùng kỳ tháng trước ${money(now - before)}.`
      : now < before
        ? `Tháng này chi ${money(now)}, ít hơn cùng kỳ tháng trước ${money(before - now)}.`
        : `Tháng này chi ${money(now)}, bằng cùng kỳ tháng trước.`;
  const figure = screen.getByRole('figure', { name: 'Chi tiêu tháng này' });
  expect(figure).toHaveTextContent(sentence);

  // The weekly columns still hold the whole months: the highest week is the fourth (days 22 to the month's end)
  // for the whole month, even on the 25th, when only four of its days are in the sentence.
  const week4 = (thousandsUpTo(monthDays(month).length) - thousandsUpTo(21)) * 1000;
  expect(figure).toHaveTextContent(`Tuần cao nhất: tuần 4, ${money(week4)}.`);
});

test('TC-F14-03 the big figure and the caption say the same days; the switch to income keeps the ranges', async () => {
  renderCompare('2026-11', '2026-11-25');
  const figure = screen.getByRole('figure', { name: 'Chi tiêu tháng này' });
  expect(figure).toHaveTextContent('So với cùng kỳ tháng trước');
  expect(figure).toHaveTextContent(spaced(formatMoney(thousandsUpTo(25) * 1000, 'vi'))); // 325.000 ₫, not the whole month's 465.000 ₫

  await userEvent.setup().click(screen.getByRole('button', { name: 'Thu nhập' }));
  expect(screen.getByRole('figure', { name: 'Thu nhập tháng này' })).toHaveTextContent('Hai tháng này chưa có giao dịch nào.');
});

test('TC-F14-03 the English sentence says "the same days last month"', async () => {
  await i18n.changeLanguage('en');
  renderCompare('2026-03', '2026-03-30'); // 30 days of March against the 28 days of February
  const figure = screen.getByRole('figure', { name: 'Spending this month' });
  const money = (amount: number) => spaced(formatMoney(amount, 'en'));
  const [now, before] = [thousandsUpTo(30) * 1000, thousandsUpTo(28) * 1000];
  expect(figure).toHaveTextContent(`This month you spent ${money(now)}, ${money(now - before)} more than the same days last month.`);
  expect(figure).toHaveTextContent('Compared with the same days last month');
});
