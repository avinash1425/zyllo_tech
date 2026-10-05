/** Shared white dashboard card shell: icon tile + heading, subtle divider. */
export default function Card({ icon: Icon, title, subtitle, action, children, className = "" }) {
  return (
    <section className={`min-w-0 rounded-2xl border border-[#e7e9ee] bg-white p-5 shadow-[0_1px_2px_rgba(16,26,58,0.04),0_8px_24px_-12px_rgba(16,26,58,0.10)] ${className}`}>
      <div className="flex items-start justify-between gap-3 border-b border-[#eef0f4] pb-4">
        <div className="flex min-w-0 items-center gap-3">
          {Icon && (
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#f7941e]/20 to-[#f96706]/10 text-[#d9650a] ring-1 ring-inset ring-[#f7941e]/25">
              <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
            </span>
          )}
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-[#2b303b]">{title}</h2>
            {subtitle && <p className="mt-0.5 text-xs text-[#676b7a]">{subtitle}</p>}
          </div>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
