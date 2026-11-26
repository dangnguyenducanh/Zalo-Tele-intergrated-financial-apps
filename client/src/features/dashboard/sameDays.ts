import type { DayTotal } from './statsApi';
import type { Flow } from './weekly';

// "Compare with the same days last month" (docs/02 §2.11.3). This is the browser's copy of compareRange() in
// server/src/utils/vnTime.js with the unit month; both are tested on shared/fixtures/compare-range.json, so the
// Dashboard and the assistant say the same thing. A range is Vietnam calendar days "YYYY-MM-DD", both included.
export type DayRange = { from: string; to: string };

const pad = (n: number, width = 2) => String(n).padStart(width, '0');
const daysInMonth = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate(); // month 1–12

// Today in Vietnam, "YYYY-MM-DD", whatever the browser's time zone.
export const vnToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });

// The range one month before `range`: the same days of that month, capped at its last day (31/03 → 28/02). A range of
// whole months (the 1st to a month's last day) goes back to the whole month before, so 01–28/02 meets 01–31/01.
function monthBefore({ from, to }: DayRange): DayRange {
  const [fromYear = 0, fromMonth = 1, fromDay = 1] = from.split('-').map(Number);
  const [toYear = 0, toMonth = 1, toDay = 1] = to.split('-').map(Number);
  const whole = fromDay === 1 && toDay === daysInMonth(toYear, toMonth);
  const back = (year: number, month: number, day: number, toLastDay: boolean) => {
    const index = year * 12 + (month - 1) - 1;
    const y = Math.floor(index / 12);
    const m = (index % 12) + 1;
    const last = daysInMonth(y, m);
    return `${pad(y, 4)}-${pad(m)}-${pad(toLastDay ? last : Math.min(day, last))}`;
  };
  return { from: back(fromYear, fromMonth, fromDay, false), to: back(toYear, toMonth, toDay, whole) };
}

// What MonthCompare adds up for the selected month: the current month, up to today; any other month, the whole month.
// Each is set against the same days of the month before.
export function sameDays(month: string, today: string): { current: DayRange; previous: DayRange } {
  const [year = 0, mon = 1] = month.split('-').map(Number);
  const lastDay = daysInMonth(year, mon);
  const toDay = today.startsWith(month) ? Number(today.slice(8, 10)) : lastDay;
  const current = { from: `${month}-01`, to: `${month}-${pad(toDay)}` };
  return { current, previous: monthBefore(current) };
}

// The money of one flow on the days inside `range` ("YYYY-MM-DD" texts compare in date order).
export function sumDays(days: DayTotal[], flow: Flow, { from, to }: DayRange): number {
  return days.reduce((sum, day) => (day.date >= from && day.date <= to ? sum + day[flow] : sum), 0);
}
