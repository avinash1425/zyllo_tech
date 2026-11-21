import { useEffect, useRef, useState } from "react";
import { revealCredentialPassword } from "@/lib/api/admin/projectTrackerProject";

export const SHOW_SECONDS = 20;

export async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Show / Copy for saved passwords, with the "Confirm it's you" step.
 * Render <ReauthModal> while `pending` is set:
 *   onClose={clearPending} onConfirmed={confirmPending}
 * `requireReauth(fn)` lets other actions (e.g. an Excel download) reuse the same step.
 */
export default function usePasswordReveal({ onMessage } = {}) {
  const [revealed, setRevealed] = useState({}); // id -> password
  const [busyId, setBusyId] = useState(null);
  const [copiedId, setCopiedId] = useState(null);
  const [pending, setPending] = useState(null); // () => void, run after re-authentication
  const timers = useRef({});

  // Forget every shown password when the page closes.
  useEffect(() => {
    const all = timers.current;
    return () => Object.values(all).forEach(clearTimeout);
  }, []);

  function hide(id) {
    clearTimeout(timers.current[id]);
    setRevealed((r) => {
      const next = { ...r };
      delete next[id];
      return next;
    });
  }

  async function run(cred, purpose = "view") {
    setBusyId(cred.id);
    const result = await revealCredentialPassword(cred.id, purpose);
    setBusyId(null);
    if (result.status === "reauth") {
      setPending(() => () => run(cred, purpose));
      return;
    }
    if (result.status !== "success") {
      onMessage?.(result.message, "warning");
      return;
    }
    if (purpose === "copy") {
      if (await copyToClipboard(result.password)) {
        setCopiedId(cred.id);
        setTimeout(() => setCopiedId((c) => (c === cred.id ? null : c)), 2000);
      } else {
        onMessage?.("Your browser blocked copying. Use Show instead.", "warning");
      }
      return;
    }
    clearTimeout(timers.current[cred.id]);
    setRevealed((r) => ({ ...r, [cred.id]: result.password }));
    timers.current[cred.id] = setTimeout(() => hide(cred.id), SHOW_SECONDS * 1000);
  }

  const requireReauth = (fn) => setPending(() => fn);
  const clearPending = () => setPending(null);
  const confirmPending = () => {
    const fn = pending;
    setPending(null);
    fn?.();
  };

  return { revealed, busyId, copiedId, run, hide, pending, requireReauth, clearPending, confirmPending };
}
