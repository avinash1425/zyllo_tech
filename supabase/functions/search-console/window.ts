// Reporting-window maths for search-console, kept free of Deno and network
// code so it can be unit tested (tests/search-console-window.test.mjs).

const DAY_MS = 86_400_000;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export const isoDay = (d: Date) => d.toISOString().slice(0, 10);

export function addDays(day: string, n: number) {
  return isoDay(new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS));
}

// Search Console reports in Pacific time, so "today" there is the day that
// is still being collected.
export function pacificDay(now: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

// Latest day whose data is complete. With dataState "all" Google also returns
// days it is still collecting; those are dropped, as the Search Console UI
// does for "Last N days". `firstIncomplete` is the API's
// metadata.first_incomplete_date; the current Pacific day is always treated
// as incomplete, whether or not the metadata came back.
export function latestCompleteDay(dates: string[], firstIncomplete: string | undefined, now: Date) {
  let cutoff = pacificDay(now);
  if (firstIncomplete && ISO_DAY.test(firstIncomplete) && firstIncomplete < cutoff) cutoff = firstIncomplete;
  return dates.filter((d) => ISO_DAY.test(d) && d < cutoff).sort().pop();
}

// Inclusive window of `days` days ending on the latest complete day. With no
// published day to anchor on, fall back to a 3-day lag.
export function reportingWindow(days: number, latest: string | undefined, now: Date) {
  const end = latest ?? addDays(pacificDay(now), -3);
  return { start: addDays(end, -(days - 1)), end };
}

// Google omits days without impressions; give every day in the window a row
// so the chart covers the same dates as the totals.
export function fillDays<T extends { date?: string; clicks: number; impressions: number }>(
  start: string,
  end: string,
  rows: T[],
) {
  const byDate = new Map(rows.map((r) => [r.date, r]));
  const out: { date: string; clicks: number; impressions: number }[] = [];
  for (let day = start; day <= end; day = addDays(day, 1)) {
    const r = byDate.get(day);
    out.push({ date: day, clicks: r?.clicks ?? 0, impressions: r?.impressions ?? 0 });
  }
  return out;
}
