import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { BarChart3 } from "lucide-react";
import Card from "./Card";
import EmptyState from "../EmptyState";

const COLORS = ["#f7941e", "#1f4693"];

export default function LeadDonut({ contactsTotal, applicantsTotal }) {
  const total = contactsTotal + applicantsTotal;
  const data = [
    { name: "Contact forms", value: contactsTotal },
    { name: "Job applications", value: applicantsTotal },
  ];
  return (
    <Card icon={BarChart3} title="Lead distribution" subtitle="All-time breakdown by submission type">
      {total === 0 ? (
        <EmptyState
          icon={BarChart3}
          title="No submissions yet"
          message="The breakdown appears once forms or applications arrive."
          className="py-14"
        />
      ) : (
        <>
          <div
            className="relative mx-auto mt-4 h-52 w-full max-w-[260px]"
            role="img"
            aria-label={`Donut chart: ${contactsTotal} contact forms and ${applicantsTotal} job applications, ${total} total.`}
          >
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={data} dataKey="value" nameKey="name" innerRadius="66%" outerRadius="94%" paddingAngle={3} stroke="none" isAnimationActive={false}>
                  {data.map((d, i) => (
                    <Cell key={d.name} fill={COLORS[i]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-3xl font-bold tabular-nums text-[#2b303b]">{total}</span>
              <span className="text-xs text-[#676b7a]">total leads</span>
            </div>
          </div>
          <ul className="mt-4 flex flex-col gap-2">
            {data.map((d, i) => (
              <li key={d.name} className="flex items-center justify-between gap-3 text-sm">
                <span className="flex items-center gap-2 text-[#4b4f5c]">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: COLORS[i] }} aria-hidden="true" />
                  {d.name}
                </span>
                <span className="tabular-nums text-[#2b303b]">
                  <span className="font-semibold">{d.value}</span>
                  <span className="ml-1.5 text-xs text-[#676b7a]">{Math.round((d.value / total) * 100)}%</span>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}
