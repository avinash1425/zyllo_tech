import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { BarChart3 } from "lucide-react";
import Card from "./Card";
import EmptyState from "../EmptyState";
import useCountUp, { prefersReducedMotion } from "./useCountUp";

const COLORS = ["#f96706", "#1f4693"];

export default function LeadDonut({ contactsTotal, applicantsTotal }) {
  const total = contactsTotal + applicantsTotal;
  const shown = useCountUp(total);
  const data = [
    { name: "Contact forms", value: contactsTotal },
    { name: "Job applications", value: applicantsTotal },
  ];
  return (
    <Card icon={BarChart3} title="Lead distribution" subtitle="All-time breakdown by type" className="h-full">
      {total === 0 ? (
        <EmptyState icon={BarChart3} title="No submissions yet" message="The breakdown appears once forms or applications arrive." className="py-14" />
      ) : (
        <>
          <div
            className="relative mx-auto mt-4 h-52 w-full max-w-[260px]"
            role="img"
            aria-label={`Donut chart: ${contactsTotal} contact forms and ${applicantsTotal} job applications, ${total} total.`}
          >
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <defs>
                  <linearGradient id="dashDonutC" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor="#ffb15c" />
                    <stop offset="100%" stopColor="#f96706" />
                  </linearGradient>
                  <linearGradient id="dashDonutA" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor="#3089a6" />
                    <stop offset="100%" stopColor="#1f4693" />
                  </linearGradient>
                </defs>
                <Pie data={data} dataKey="value" nameKey="name" innerRadius="68%" outerRadius="96%" paddingAngle={4} cornerRadius={6} stroke="none" startAngle={90} endAngle={-270} isAnimationActive={!prefersReducedMotion()} animationDuration={800}>
                  {data.map((d, i) => (
                    <Cell key={d.name} fill={i === 0 ? "url(#dashDonutC)" : "url(#dashDonutA)"} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-4xl font-extrabold tabular-nums text-[#101a3a]">{shown}</span>
              <span className="text-xs font-medium text-[#676b7a]">total leads</span>
            </div>
          </div>
          <ul className="mt-4 flex flex-col gap-2">
            {data.map((d, i) => (
              <li key={d.name} className="flex items-center justify-between gap-3 rounded-xl bg-[#f6f7fb] px-3 py-2 text-sm">
                <span className="flex min-w-0 items-center gap-2 text-[#4b4f5c]">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: COLORS[i] }} aria-hidden="true" />
                  <span className="truncate">{d.name}</span>
                </span>
                <span className="shrink-0 tabular-nums text-[#101a3a]">
                  <span className="font-bold">{d.value}</span>
                  <span className="ml-1.5 rounded-full bg-white px-1.5 py-0.5 text-[11px] font-semibold text-[#4b4f5c] ring-1 ring-inset ring-[#e7e9ee]">{Math.round((d.value / total) * 100)}%</span>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}
