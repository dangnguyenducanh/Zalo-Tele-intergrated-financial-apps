import type { DayTotal } from './statsApi';
import { previousMonth, type Flow } from './weekly';

// "Compare with the same days last month" (docs/02 §2.11.3). This is the browser's side of the rule that compareRange() in
// server/src/utils/vnTime.js has for the assistant; both are tested on shared/fixtures/compare-range.json, so the Dashboard
// and the assistant say the same thing. A range is Vietnam calendar days "YYYY-MM-DD", both included.
export type DayRange = { from: string; to: string };

const daysInMonth = (month: string) => {
  const [year = 0, mon = 1] = month.split('-').map(Number);
  return new Date(Date.UTC(year, mon, 0)).getUTCDate(); // day 0 of the next month is this month's last day
};
const days1To = (month: string, last: number): DayRange => ({ from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` });

// What MonthCompare adds up for the selected month, against the month before it:
// - the current month: days 1..N in both months, N = today's day capped at the last day of the month before (30/04 meets
//   01–30/03, 28/02 meets 01–28/01, 31/03 stops at 28/02), so both sides have the same number of days;
// - any other month, past or still to come: the whole month against the whole month before (a past February meets all of
//   January).
// The previous range is built here and not by compareRange(): that function sees only dates, so it takes 01–28/02 for a whole
// February and answers all of January, a few days too many on the last day of a month that is shorter than the one before.
export function sameDays(month: string, today: string): { current: DayRange; previous: DayRange } {
  const before = previousMonth(month);
  const beforeLast = daysInMonth(before);
  if (!today.startsWith(month)) return { current: days1To(month, daysInMonth(month)), previous: days1To(before, beforeLast) };
  const last = Math.min(Number(today.slice(8, 10)), beforeLast);
  return { current: days1To(month, last), previous: days1To(before, last) };
}

// The money of one flow on the days inside `range` ("YYYY-MM-DD" texts compare in date order).
export function sumDays(days: DayTotal[], flow: Flow, { from, to }: DayRange): number {
  return days.reduce((sum, day) => (day.date >= from && day.date <= to ? sum + day[flow] : sum), 0);
}
