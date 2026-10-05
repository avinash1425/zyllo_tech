/** Shared white dashboard card shell with a title row. */
export default function Card({ icon: Icon, title, subtitle, action, children, className = "" }) {
  return (
    <section className={`min-w-0 rounded-2xl border border-[#e7e9ee] bg-white p-5 shadow-sm ${className}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {Icon && (
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#f7941e]/12 text-[#d9650a]">
                <Icon className="h-4 w-4" aria-hidden="true" />
              </span>
            )}
            <h2 className="text-sm font-semibold text-[#2b303b]">{title}</h2>
          </div>
          {subtitle && <p className="mt-1 text-xs text-[#676b7a]">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
