// Today in Vietnam, "YYYY-MM-DD", whatever time zone the browser is in: between 17:00 and 24:00 UTC it is already the next
// day here. (The 'en-CA' locale prints year-month-day.) The one place that asks "what day is it?" (the month the app opens
// on, the days the Dashboard compares).
export const vnToday = (): string => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });

// This month in Vietnam, "YYYY-MM".
export const vnThisMonth = (): string => vnToday().slice(0, 7);
