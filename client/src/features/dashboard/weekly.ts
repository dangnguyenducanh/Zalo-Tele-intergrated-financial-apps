import type { DayTotal } from './statsApi';

export type Flow = 'expense' | 'income';

// A month's daily totals in four weeks: days 1–7, 8–14, 15–21 and 22 to the end of the month (so the last
// "week" holds 7 to 10 days). Days are read from the "YYYY-MM-DD" date, not from their position in the list.
export function weekTotals(days: DayTotal[], flow: Flow): [number, number, number, number] {
  const weeks: [number, number, number, number] = [0, 0, 0, 0];
  for (const day of days) {
    const dayOfMonth = Number(day.date.slice(8, 10));
    const week = Math.min(3, Math.floor((dayOfMonth - 1) / 7));
    weeks[week] = (weeks[week] ?? 0) + day[flow];
  }
  return weeks;
}

// "YYYY-MM" one month earlier (January goes back to December of the year before).
export function previousMonth(month: string): string {
  const [year = 0, mon = 1] = month.split('-').map(Number);
  return new Date(Date.UTC(year, mon - 2, 1)).toISOString().slice(0, 7);
}
