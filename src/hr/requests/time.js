import { DEFAULT_TZ, formatTime } from "@/lib/hr/attendance";

/** "09:00 – 18:00" in the business timezone (either side may be missing). */
export function formatTimeRange(inAt, outAt, tz = DEFAULT_TZ) {
  const a = inAt ? formatTime(inAt, tz) : "—";
  const b = outAt ? formatTime(outAt, tz) : "—";
  return `${a} – ${b}`;
}
