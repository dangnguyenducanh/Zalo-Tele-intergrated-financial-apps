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
