// Holiday calendar for attendance. hr_holidays is the single holiday master
// (Leave module); editing reuses HolidaysSettings. The calendar view comes
// from hr_holiday_calendar, which expands annual recurring holidays and
// shows company / location applicability.
import { useMemo, useState } from "react";
import { useAuth } from "@/hr/platform/auth";
import { formatDate, useHrQuery } from "@/lib/hr/client";
import { businessToday, getHolidayCalendar } from "@/lib/hr/attendance";
import { Badge, Button, Card, DataTable, Select, Toolbar } from "@/hr/ui";
import HolidaysSettings from "@/hr/settings/HolidaysSettings";

export default function HolidaysTab({ tz }) {
  const { hasPermission } = useAuth();
  const canEdit = hasPermission("attendance.manage") || hasPermission("leave.manage");
  const thisYear = Number(businessToday(tz).slice(0, 4));
  const [year, setYear] = useState(thisYear);
  const q = useHrQuery(() => getHolidayCalendar({ from: `${year}-01-01`, to: `${year}-12-31`, all: true }), [year]);
  const byMonth = useMemo(() => {
    const m = new Map();
    for (const h of q.data ?? []) {
      const k = h.date.slice(0, 7);
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(h);
    }
    return m;
  }, [q.data]);

  return (
    <div className="flex flex-col gap-6">
      <Card title={`Holiday calendar ${year}`} padded={false}
        actions={<div className="flex items-center gap-2">
          <Select aria-label="Year" value={String(year)} onChange={(e) => setYear(Number(e.target.value))}
            options={[thisYear - 1, thisYear, thisYear + 1].map((y) => ({ value: String(y), label: String(y) }))} />
          <Button size="sm" variant="secondary" onClick={q.reload} loading={q.loading}>Refresh</Button>
        </div>}>
        <div className="px-4 pt-3">
          <Toolbar>
            <p className="text-sm text-slate-600">
              Non-optional holidays are non-working days: nobody is marked absent, and work on them counts as overtime. Optional holidays are taken as leave.
              {" "}{byMonth.size} month(s) with holidays.
            </p>
          </Toolbar>
        </div>
        <DataTable caption={`Holidays in ${year}`} rows={q.data} rowKey={(h) => `${h.id}-${h.date}`} loading={q.loading} error={q.error} onRetry={q.reload} pageSize={50}
          emptyTitle="No holidays in this year"
          columns={[
            { key: "date", header: "Date", render: (h) => formatDate(h.date, { weekday: "short", day: "2-digit", month: "short", year: "numeric" }) },
            { key: "name", header: "Holiday", render: (h) => <div><p className="font-semibold text-[#101a3a]">{h.name}</p>{h.description && <p className="text-xs text-slate-500">{h.description}</p>}</div> },
            { key: "type", header: "Type", render: (h) => <Badge tone={h.type === "optional" ? "violet" : "blue"}>{h.type}</Badge> },
            { key: "applies", header: "Applies to", render: (h) => [h.legal_entity_name ?? "All companies", h.location_name ?? "All locations"].join(" · ") },
            { key: "rec", header: "Repeats", render: (h) => (h.is_recurring ? <Badge tone="green">every year</Badge> : "—") },
          ]} />
      </Card>
      <HolidaysSettings canEdit={canEdit} />
    </div>
  );
}
