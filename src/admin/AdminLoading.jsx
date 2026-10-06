import PageLoader from "@/components/PageLoader";

// Branded admin loader: the Zyllo infinity mark inside a spinning
// orange-to-teal ring (same loader as the public site). It reserves its height
// immediately and fades in after a short delay, so quick loads do not flash it.
// `variant` is accepted for backward compatibility with existing callers.
export default function AdminLoading({ label = "Loading…" }) {
  return (
    <div className="flex min-h-[60vh] w-full items-center justify-center rounded-2xl border border-[#e7e9ee] bg-white/70 shadow-[0_1px_2px_rgba(16,26,58,0.04)]">
      <PageLoader inline label={label} />
    </div>
  );
}
