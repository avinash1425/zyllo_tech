"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";

function formatTimestamp(date) {
  return date.toLocaleString("en-IN", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * "Last updated" label + working Refresh button for the dashboard overview.
 * Clicking Refresh calls router.refresh(), which re-runs the AdminOverviewPage
 * server component (and its Supabase queries) in place — no full page reload.
 * The timestamp only advances once that refresh has actually completed.
 */
export default function DashboardRefresh() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [updatedAt, setUpdatedAt] = useState(null);

  // Set on mount (client-only) to avoid a server/client render mismatch.
  useEffect(() => {
    setUpdatedAt(new Date());
  }, []);

  function handleRefresh() {
    startTransition(() => {
      router.refresh();
    });
  }

  // router.refresh() resolves the transition once the new server payload has
  // rendered, so stamping the time here reflects data that's actually fresh.
  useEffect(() => {
    if (!isPending && updatedAt) {
      setUpdatedAt(new Date());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPending]);

  return (
    <div className="flex items-center gap-2">
      <span className="rounded-full bg-white px-3 py-1.5 text-xs font-medium text-[#676b7a] shadow-sm ring-1 ring-[#e7e9ee]">
        {updatedAt ? `Last updated: ${formatTimestamp(updatedAt)}` : "Loading…"}
      </span>
      <button
        type="button"
        onClick={handleRefresh}
        disabled={isPending}
        className="inline-flex items-center gap-1.5 rounded-full border border-[#e7e9ee] bg-white px-3 py-1.5 text-xs font-semibold text-[#2b303b] shadow-sm transition-colors hover:border-[#1f4693]/40 hover:text-[#1f4693] disabled:opacity-60"
      >
        <RefreshCw className={`h-3.5 w-3.5 ${isPending ? "animate-spin" : ""}`} aria-hidden="true" />
        {isPending ? "Refreshing…" : "Refresh"}
      </button>
    </div>
  );
}
