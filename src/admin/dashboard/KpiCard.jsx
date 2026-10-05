import Link from "@/lib/nx/link";
import { ArrowUpRight } from "lucide-react";

/** Tiny bar sparkline from an array of numbers; decorative (aria-hidden). */
function MiniBars({ series, color }) {
  const max = Math.max(1, ...series);
  return (
    <div aria-hidden="true" className="flex h-8 items-end gap-[3px]">
      {series.map((v, i) => (
        <span
          key={i}
          className="w-1.5 rounded-sm"
          style={{
            height: `${Math.max(12, (v / max) * 100)}%`,
            backgroundColor: color,
            opacity: v === 0 ? 0.2 : i === series.length - 1 ? 1 : 0.55,
          }}
        />
      ))}
    </div>
  );
}

/** KPI card: icon tile, large tabular number, label, optional 7-day bars. */
export default function KpiCard({ icon: Icon, label, value, hint, series, accent, href }) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <span
          className="flex h-10 w-10 items-center justify-center rounded-xl"
          style={{ backgroundColor: `${accent}1f`, color: accent }}
        >
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
        {series ? (
          <MiniBars series={series} color={accent} />
        ) : href ? (
          <ArrowUpRight
            className="h-4 w-4 text-[#8a8f9c] transition-colors group-hover:text-[#2b303b]"
            aria-hidden="true"
          />
        ) : null}
      </div>
      <p className="mt-4 text-3xl font-bold tabular-nums tracking-tight text-[#2b303b]">{value}</p>
      <p className="mt-0.5 text-sm font-medium text-[#4b4f5c]">{label}</p>
      {hint && <p className="mt-0.5 text-xs text-[#676b7a]">{hint}</p>}
    </>
  );
  const cls =
    "group block rounded-2xl border border-[#e7e9ee] bg-white p-5 shadow-sm transition-all duration-200 hover:border-[#d9dce3] hover:shadow-md motion-reduce:transition-none";
  return href ? (
    <Link
      href={href}
      aria-label={`${label}: ${value}. Open`}
      className={`${cls} focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f96706] motion-safe:hover:-translate-y-0.5`}
    >
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}
