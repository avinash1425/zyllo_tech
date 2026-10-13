// Browser-side memory for the admin Index Coverage check: the last successful
// result and the time of the last run, kept in localStorage.
//
// This only protects the browser it runs in. Another admin, another browser
// or a cleared cache can still start a check, and Google's URL Inspection
// quota (2,000 a day per property) is shared by all of them. It is not a
// server-wide limit.
export const INDEX_CHECK_COOLDOWN_MS = 60 * 60 * 1000;

const RESULT_KEY = "zyllo.gsc.indexCoverage.v1";
const LAST_RUN_KEY = "zyllo.gsc.indexCoverage.lastRunAt";

function browserStorage() {
  try { return globalThis.localStorage; } catch { return undefined; }
}

function isCheckResult(data) {
  return data?.status === "ok" && Array.isArray(data.pages) && typeof data.totals === "object" && data.totals !== null;
}

// A run worth keeping: Google answered for at least one URL and the check was
// not cut short by a quota or permission error.
export function isSuccessfulCheck(data) {
  if (!isCheckResult(data) || data.stoppedEarly) return false;
  const { tracked = 0, errors = 0 } = data.totals;
  return tracked > 0 && errors < tracked;
}

export function loadSavedCheck(storage = browserStorage()) {
  try {
    const data = JSON.parse(storage.getItem(RESULT_KEY));
    return isSuccessfulCheck(data) ? data : null;
  } catch {
    return null;
  }
}

export function saveCheck(data, storage = browserStorage()) {
  if (!isSuccessfulCheck(data)) return false;
  try {
    storage.setItem(RESULT_KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

export function loadLastRunAt(storage = browserStorage()) {
  try {
    const at = Number(storage.getItem(LAST_RUN_KEY));
    return Number.isFinite(at) && at > 0 ? at : null;
  } catch {
    return null;
  }
}

// Recorded for every run that reached Google, successful or not, because a
// failed run has spent quota too.
export function recordRun(now = Date.now(), storage = browserStorage()) {
  try { storage.setItem(LAST_RUN_KEY, String(now)); } catch { /* ignore */ }
}

export function cooldownRemainingMs(lastRunAt, now = Date.now()) {
  if (!lastRunAt) return 0;
  // A timestamp from the future (clock changed) never locks for over an hour.
  return Math.max(0, Math.min(INDEX_CHECK_COOLDOWN_MS, lastRunAt + INDEX_CHECK_COOLDOWN_MS - now));
}
