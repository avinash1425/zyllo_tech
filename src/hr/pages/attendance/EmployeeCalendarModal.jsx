// HR / manager view of one employee's month (scope enforced by the server).
import { useState } from "react";
import { useHrQuery } from "@/lib/hr/client";
import { getCalendar } from "@/lib/hr/attendance";
import { ErrorState, Input, Loading, Modal } from "@/hr/ui";
import AttendanceCalendar, { TotalsStrip } from "./AttendanceCalendar";
import { empLabel } from "./common";

export default function EmployeeCalendarModal({ employee, tz, month: initial, onClose }) {
  const [month, setMonth] = useState(initial);
  const q = useHrQuery(() => getCalendar(month, employee.id), [month, employee.id]);
  return (
    <Modal open onClose={onClose} title={`Attendance — ${empLabel(employee)}`} size="lg">
      <div className="mb-3 flex items-center gap-2">
        <label className="text-sm text-slate-600" htmlFor="emp-cal-month">Month</label>
        <Input id="emp-cal-month" type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} className="w-44" />
      </div>
      {q.loading && !q.data ? <Loading /> : q.error ? <ErrorState message={q.error} onRetry={q.reload} /> : (
        <div className="flex flex-col gap-4">
          <TotalsStrip totals={q.data?.totals} />
          <AttendanceCalendar days={q.data?.days} tz={q.data?.timezone || tz} />
        </div>
      )}
    </Modal>
  );
}
