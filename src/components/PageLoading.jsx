// Minimal full-section loading placeholder for client-fetched pages.
export default function PageLoading() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center bg-white" role="status" aria-live="polite">
      <span className="h-8 w-8 animate-spin rounded-full border-2 border-[#e7e9ee] border-t-[#f7941e]" />
      <span className="sr-only">Loading…</span>
    </div>
  );
}
