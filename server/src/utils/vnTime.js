// Calendar days and months in Vietnam (Asia/Ho_Chi_Minh). Vietnam is UTC+7 all year with no
// daylight saving, so a fixed offset is exact and gives the same answer on a server running in UTC.
const OFFSET_MS = 7 * 60 * 60 * 1000;

// The Vietnamese calendar date of an instant: { year, month (1–12), day }.
export function vnParts(date) {
  const shifted = new Date(date.getTime() + OFFSET_MS);
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() };
}

// The instant a Vietnamese calendar day starts (00:00 +07). Overflow rolls over: month 13 → January next year.
export function vnDate(year, month, day) {
  return new Date(Date.UTC(year, month - 1, day) - OFFSET_MS);
}

// 'YYYY-MM' of the Vietnamese month an instant falls in (budgets.month).
export function monthKey(date) {
  const { year, month } = vnParts(date);
  return `${year}-${String(month).padStart(2, '0')}`;
}

// [start, end) of a 'YYYY-MM' month in Vietnam time, for occurredAt range queries.
export function monthRange(month) {
  const [year, mm] = month.split('-').map(Number);
  return { start: vnDate(year, mm, 1), end: vnDate(year, mm + 1, 1) };
}

// [start, end) of the Vietnamese day an instant falls in.
export function dayRange(date) {
  const { year, month, day } = vnParts(date);
  return { start: vnDate(year, month, day), end: vnDate(year, month, day + 1) };
}

// ---- The period before a period (docs/02 §2.11.3) ------------------------------------------------------------
// One rule for "compare with before", shared with the Dashboard's MonthCompare (client/src/features/dashboard/sameDays.ts)
// and the agent service through shared/fixtures/compare-range.json. A period is { from, to }: Vietnamese calendar dates
// 'YYYY-MM-DD', both included. Only calendar days are added and taken away, so no time zone is involved.
const DAY_MS = 24 * 60 * 60 * 1000;
const UNITS = ['day', 'week', 'month', 'year'];

const daysInMonth = (year, month) => new Date(Date.UTC(year, month, 0)).getUTCDate(); // month 1–12; day 0 of the next one
const dayText = (ms) => new Date(ms).toISOString().slice(0, 10);
const dayMs = (text) => Date.parse(`${text}T00:00:00Z`);
const shiftDays = (text, days) => dayText(dayMs(text) - days * DAY_MS);

function parseDay(text) {
  const valid = typeof text === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(text) && dayText(dayMs(text)) === text; // 2026-02-30 rolls over, so it is not equal
  if (!valid) throw new RangeError(`compareRange: "${text}" is not a date like 2026-11-25`);
  const [year, month, day] = text.split('-').map(Number);
  return { year, month, day };
}

// Both ends back by `months`: the same day of that month, or its last day when it has fewer days (31/03 → 28/02). A period of
// whole months (the 1st to a month's last day) goes back to whole months, so 01–28/02 is compared with 01–31/01, not 01–28/01.
function shiftMonths(from, to, months) {
  const a = parseDay(from);
  const b = parseDay(to);
  const whole = a.day === 1 && b.day === daysInMonth(b.year, b.month);
  const back = ({ year, month, day }, toLastDay) => {
    const index = year * 12 + (month - 1) - months;
    const y = Math.floor(index / 12);
    const m = (index % 12) + 1;
    const last = daysInMonth(y, m);
    return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(toLastDay ? last : Math.min(day, last)).padStart(2, '0')}`;
  };
  return { from: back(a, false), to: back(b, whole) };
}

// The unit the dates alone imply, in this order: one day; from 1/1 and longer than a month → year; from the 1st → month;
// from a Monday and at most 7 days → week. Otherwise null: shift by the period's own length.
function impliedUnit(from, to) {
  if (from === to) return 'day';
  const a = parseDay(from);
  const b = parseDay(to);
  if (a.month === 1 && a.day === 1 && (b.year > a.year || b.month > 1)) return 'year';
  if (a.day === 1) return 'month';
  const length = (dayMs(to) - dayMs(from)) / DAY_MS + 1;
  if (new Date(dayMs(from)).getUTCDay() === 1 && length <= 7) return 'week';
  return null;
}

// The period one calendar unit before { from, to }: Mon 23–Wed 25/11 → Mon 16–Wed 18/11, 01–25/11 → 01–25/10,
// 01–31/10 → 01–30/09. Pass `unit` ('day' | 'week' | 'month' | 'year') when you know it: 01–07/06/2026 is both a week
// and a month to date, and only the caller knows which. Without one the dates decide (impliedUnit).
export function compareRange({ from, to }, unit) {
  if (unit != null && !UNITS.includes(unit)) throw new RangeError(`compareRange: unknown unit "${unit}"`);
  parseDay(from);
  parseDay(to);
  if (from > to) throw new RangeError(`compareRange: ${from} is after ${to}`);
  const chosen = unit ?? impliedUnit(from, to);
  if (chosen === 'month') return shiftMonths(from, to, 1);
  if (chosen === 'year') return shiftMonths(from, to, 12);
  const days = chosen === 'day' ? 1 : chosen === 'week' ? 7 : (dayMs(to) - dayMs(from)) / DAY_MS + 1;
  return { from: shiftDays(from, days), to: shiftDays(to, days) };
}
