import Link from "@/lib/nx/link";
import { ArrowUpRight } from "lucide-react";
import useCountUp from "./useCountUp";

/** Smooth inline-SVG area sparkline from a numeric series (decorative). */
function Sparkline({ series, color, id }) {
  const w = 120;
  const h = 40;
  const max = Math.max(1, ...series);
  const step = w / Math.max(1, series.length - 1);
  const pts = series.map((v, i) => [i * step, h - 4 - (v / max) * (h - 10)]);
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 1; i < pts.length; i += 1) {
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    const cx = (x0 + x1) / 2;
    d += ` C${cx},${y0} ${cx},${y1} ${x1},${y1}`;
  }
  return (
    <svg aria-hidden="true" viewBox={`0 0 ${w} ${h}`} className="h-10 w-full" preserveAspectRatio="none">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${d} L${w},${h} L0,${h} Z`} fill={`url(#${id})`} />
      <path d={d} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/**
 * KPI card: gradient medallion, count-up number, optional 7-day sparkline and
 * a real "today" chip. `from`/`to` are the medallion gradient colors.
 */
export default function KpiCard({ icon: Icon, label, value, hint, series, accent, from, to, href, chip, sparkId }) {
  const shown = useCountUp(value);
  const body = (
    <>
      <span aria-hidden="true" className="absolute inset-x-0 top-0 h-1" style={{ backgroundImage: `linear-gradient(90deg, ${from}, ${to})` }} />
      <div className="flex items-start justify-between gap-3">
        <span
          className="flex h-11 w-11 items-center justify-center rounded-2xl text-white shadow-[0_6px_14px_-4px_rgba(16,26,58,0.35)]"
          style={{ backgroundImage: `linear-gradient(135deg, ${from}, ${to})` }}
        >
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
        {chip ? (
          <span className="inline-flex items-center rounded-full bg-[#f6f7fb] px-2 py-1 text-[11px] font-semibold text-[#4b4f5c] ring-1 ring-inset ring-[#e7e9ee]">
            <span className="mr-1.5 h-1.5 w-1.5 rounded-full" style={{ backgroundColor: accent }} aria-hidden="true" />
            {chip}
          </span>
        ) : href ? (
          <ArrowUpRight className="h-4 w-4 text-[#8a8f9c] transition-colors group-hover:text-[#2b303b]" aria-hidden="true" />
        ) : null}
      </div>
      <p className="mt-4 text-[34px] font-extrabold leading-none tabular-nums tracking-tight text-[#101a3a]">{shown}</p>
      <p className="mt-1.5 text-sm font-semibold text-[#2b303b]">{label}</p>
      {hint && <p className="mt-0.5 text-xs text-[#676b7a]">{hint}</p>}
      {series && (
        <div className="mt-3">
          <Sparkline series={series} color={accent} id={sparkId} />
        </div>
      )}
    </>
  );
  const cls =
    "group relative block overflow-hidden rounded-2xl border border-[#e7e9ee] bg-white p-5 pt-6 shadow-[0_1px_2px_rgba(16,26,58,0.04),0_8px_24px_-12px_rgba(16,26,58,0.10)] transition-all duration-200 hover:border-[#d9dce3] hover:shadow-[0_14px_30px_-12px_rgba(16,26,58,0.22)] motion-reduce:transition-none";
  return href ? (
    <Link
      href={href}
      aria-label={`${label}: ${value}. Open`}
      className={`${cls} focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f96706] motion-safe:hover:-translate-y-1`}
    >
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}
