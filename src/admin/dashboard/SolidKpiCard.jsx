import Link from "@/lib/nx/link";
import { ArrowUpRight } from "lucide-react";
import useCountUp from "./useCountUp";

/**
 * Bold headline KPI: full gradient fill, white type, large faded icon watermark.
 * `from`/`to` are the card gradient colors (logo palette).
 */
export default function SolidKpiCard({ icon: Icon, label, value, hint, from, to, href, chip }) {
  const shown = useCountUp(value);
  const cls =
    "group relative block overflow-hidden rounded-2xl p-5 text-white shadow-[0_14px_30px_-16px_rgba(16,26,58,0.55)] transition-all duration-200 motion-reduce:transition-none motion-safe:hover:-translate-y-1 hover:shadow-[0_20px_36px_-14px_rgba(16,26,58,0.6)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f96706]";
  const style = { backgroundImage: `linear-gradient(135deg, ${from}, ${to})` };
  const body = (
    <>
      <span aria-hidden="true" className="pointer-events-none absolute -right-8 -top-10 h-36 w-36 rounded-full bg-white/10" />
      <span aria-hidden="true" className="pointer-events-none absolute -bottom-12 right-6 h-28 w-28 rounded-full bg-white/[0.07]" />
      <Icon aria-hidden="true" className="pointer-events-none absolute -bottom-3 -right-2 h-24 w-24 text-white/15" strokeWidth={1.5} />
      <div className="relative flex items-start justify-between gap-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/20 ring-1 ring-inset ring-white/30 backdrop-blur-[2px]">
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
        {chip ? (
          <span className="inline-flex items-center rounded-full bg-white/20 px-2.5 py-1 text-[11.5px] font-semibold text-white ring-1 ring-inset ring-white/25">
            <span className="mr-1.5 h-1.5 w-1.5 rounded-full bg-white" aria-hidden="true" />
            {chip}
          </span>
        ) : href ? (
          <ArrowUpRight className="h-4 w-4 text-white/70 transition-colors group-hover:text-white" aria-hidden="true" />
        ) : null}
      </div>
      <p className="relative mt-5 text-[40px] font-extrabold leading-none tabular-nums tracking-tight">{shown}</p>
      <p className="relative mt-2 text-[15px] font-semibold">{label}</p>
      {hint && <p className="relative mt-0.5 text-[13px] text-white/80">{hint}</p>}
    </>
  );
  return href ? (
    <Link href={href} aria-label={`${label}: ${value}. Open`} className={cls} style={style}>
      {body}
    </Link>
  ) : (
    <div className={cls} style={style}>
      {body}
    </div>
  );
}
