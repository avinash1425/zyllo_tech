import { Check, X } from "lucide-react";
import { deptTheme } from "@/components/careers/deptTheme";

const STEPS = ["Details", "Apply"];

// Branded gradient hero header used by the careers popups. It stays pinned
// because the modal body below it is the only scrolling region.
//   step (1|2)      - highlights the Details -> Apply progress indicator
//   department      - picks the faded watermark icon
//   onStepChange    - optional; makes the step labels clickable
export default function ModalHeader({
  titleId,
  eyebrow,
  title,
  chips = [],
  onClose,
  step,
  department,
  onStepChange,
}) {
  const { icon: Watermark } = deptTheme(department);

  return (
    <header className="relative shrink-0 overflow-hidden bg-gradient-to-br from-[#101a3a] via-[#173a52] to-[#1f4693] px-5 pb-5 pt-7 text-white sm:px-8 sm:pb-6 sm:pt-8">
      <span aria-hidden="true" className="absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-[#f96706] via-[#ffb15c] to-[#3089a6]" />
      <span aria-hidden="true" className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-[#f96706]/25 blur-[70px]" />
      <span aria-hidden="true" className="pointer-events-none absolute -bottom-24 left-0 h-48 w-48 rounded-full bg-[#3089a6]/25 blur-[70px]" />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-[0.12]"
        style={{ backgroundImage: "radial-gradient(rgba(255,255,255,0.9) 1px, transparent 1px)", backgroundSize: "18px 18px" }}
      />
      <Watermark
        aria-hidden="true"
        strokeWidth={1.25}
        className="pointer-events-none absolute -bottom-6 -right-4 h-40 w-40 rotate-[-8deg] text-white/[0.09] sm:h-52 sm:w-52 [@media(max-height:500px)]:hidden"
      />
      <span aria-hidden="true" className="absolute left-1/2 top-2.5 h-1 w-10 -translate-x-1/2 rounded-full bg-white/30 sm:hidden" />

      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="absolute right-3 top-5 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white ring-1 ring-white/10 transition-colors hover:bg-white/20 focus:outline-none focus-visible:ring-4 focus-visible:ring-[#ffb15c]/60 sm:right-5"
      >
        <X className="h-5 w-5" aria-hidden="true" />
      </button>

      <div className="relative pr-12">
        {step ? (
          <ol className="flex items-center gap-2 text-[13px] font-bold uppercase tracking-[0.14em]" aria-label="Progress">
            {STEPS.map((label, i) => {
              const n = i + 1;
              const done = step > n;
              const active = step === n;
              const inner = (
                <>
                  <span
                    className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] ${
                      active
                        ? "bg-[#f7941e] text-white"
                        : done
                          ? "bg-[#3089a6] text-white"
                          : "bg-white/15 text-white/70"
                    }`}
                  >
                    {done ? <Check className="h-3 w-3" strokeWidth={3} aria-hidden="true" /> : n}
                  </span>
                  <span className={active ? "text-white" : "text-white/60"}>{label}</span>
                </>
              );
              return (
                <li key={label} className="flex items-center gap-2" aria-current={active ? "step" : undefined}>
                  {onStepChange && done ? (
                    <button
                      type="button"
                      onClick={() => onStepChange(n)}
                      className="flex items-center gap-1.5 rounded-full focus:outline-none focus-visible:ring-4 focus-visible:ring-[#ffb15c]/60"
                    >
                      {inner}
                    </button>
                  ) : (
                    <span className="flex items-center gap-1.5">{inner}</span>
                  )}
                  {i < STEPS.length - 1 && (
                    <span aria-hidden="true" className={`h-0.5 w-8 rounded-full ${done ? "bg-[#3089a6]" : "bg-white/20"}`} />
                  )}
                </li>
              );
            })}
          </ol>
        ) : (
          eyebrow && <p className="text-sm font-bold uppercase tracking-[0.16em] text-[#ffb15c]">{eyebrow}</p>
        )}
        <h2 id={titleId} className="mt-3 break-words text-2xl font-bold leading-snug tracking-tight sm:text-[1.75rem] [@media(max-height:500px)]:mt-1.5">
          {title}
        </h2>
        {chips.length > 0 && (
          <ul className="mt-4 flex flex-wrap gap-2 [@media(max-height:500px)]:hidden">
            {chips.map(({ icon: Icon, label }) => (
              <li
                key={label}
                className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-3.5 py-1.5 text-[13px] font-medium text-white backdrop-blur-sm"
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
