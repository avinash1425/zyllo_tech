import { Loader2 } from "lucide-react";

export default function AdminLoading({ label = "Loading…" }) {
  return (
    <div className="flex items-center justify-center gap-2 py-24 text-sm text-[#676b7a]" role="status">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
      {label}
    </div>
  );
}
