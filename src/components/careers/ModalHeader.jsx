import { X } from "lucide-react";

// Branded gradient header used by the careers popups. It stays pinned because
// the modal body below it is the only scrolling region.
export default function ModalHeader({ titleId, eyebrow, title, chips = [], onClose }) {
  return (
    <header className="relative shrink-0 overflow-hidden bg-gradient-to-br from-[#101a3a] via-[#173a52] to-[#1f4693] px-5 pb-5 pt-6 text-white sm:px-8 sm:pb-6 sm:pt-7">
      <span
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-[#f96706] via-[#ffb15c] to-[#3089a6]"
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -right-16 -top-20 h-52 w-52 rounded-full bg-[#f96706]/25 blur-[70px]"
      />
      <span
        aria-hidden="true"
        className="absolute left-1/2 top-2 h-1 w-10 -translate-x-1/2 rounded-full bg-white/30 sm:hidden"
      />

      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="absolute right-3 top-4 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 focus:outline-none focus-visible:ring-4 focus-visible:ring-[#ffb15c]/60 sm:right-5"
      >
        <X className="h-5 w-5" aria-hidden="true" />
      </button>

      <div className="relative pr-12">
        {eyebrow && (
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#ffb15c]">{eyebrow}</p>
        )}
        <h2 id={titleId} className="mt-1.5 text-xl font-bold leading-snug tracking-tight sm:text-2xl">
          {title}
        </h2>
        {chips.length > 0 && (
          <ul className="mt-3.5 flex flex-wrap gap-2">
            {chips.map(({ icon: Icon, label }) => (
              <li
                key={label}
                className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-medium text-white backdrop-blur-sm"
              >
                {Icon && <Icon className="h-3.5 w-3.5 text-[#ffb15c]" aria-hidden="true" />}
                {label}
              </li>
            ))}
          </ul>
        )}
      </div>
    </header>
  );
}
