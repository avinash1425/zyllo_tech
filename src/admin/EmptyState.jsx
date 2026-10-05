import { Inbox } from "lucide-react";

/** Friendly empty state: icon, message and an optional action node. */
export default function EmptyState({
  icon: Icon = Inbox,
  title,
  message,
  action,
  bordered = false,
  className = "",
}) {
  return (
    <div
      className={`flex flex-col items-center justify-center px-6 py-12 text-center ${
        bordered ? "rounded-2xl border border-dashed border-[#d9dce3] bg-white" : ""
      } ${className}`}
    >
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-[#f7941e]/15 to-[#1f4693]/10 text-[#1f4693]">
        <Icon className="h-6 w-6" aria-hidden="true" />
      </span>
      {title && <p className="mt-4 text-sm font-semibold text-[#2b303b]">{title}</p>}
      {message && <p className="mt-1 max-w-sm text-sm leading-relaxed text-[#676b7a]">{message}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
