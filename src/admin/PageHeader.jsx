/**
 * Consistent page header for admin pages: title, optional subtitle and an
 * optional slot on the right for the primary action(s). Purely presentational.
 */
export default function PageHeader({ title, subtitle, icon: Icon, actions, className = "" }) {
  return (
    <div
      className={`flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between ${className}`}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2.5">
          {Icon && (
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#f7941e]/12 text-[#db7d17]">
              <Icon className="h-5 w-5" aria-hidden="true" />
            </span>
          )}
          <h1 className="truncate text-2xl font-bold tracking-tight text-[#2b303b]">{title}</h1>
        </div>
        {subtitle && (
          <p className="mt-1.5 max-w-3xl text-sm leading-relaxed text-[#676b7a]">{subtitle}</p>
        )}
      </div>
      {actions && (
        <div className="flex w-full flex-wrap items-center gap-3 sm:w-auto sm:shrink-0">
          {actions}
        </div>
      )}
    </div>
  );
}
