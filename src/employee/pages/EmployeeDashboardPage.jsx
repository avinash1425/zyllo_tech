// Employee Portal — My Dashboard. Each card loads independently from the
// employee's own records (RLS restricts every query to the caller).
import { useNavigate } from "react-router-dom";
import { Bell, CalendarCheck, Clock, HeartHandshake, Package, Wallet } from "lucide-react";
import { useAuth } from "@/hr/platform/auth";
import { formatDate, formatDateTime, formatMoney, from, minutesToHm, rpc, run, useHrQuery } from "@/lib/hr/client";
import { Badge, Button, Card, EmptyState, ErrorState, Loading, PageHeader, StatusBadge } from "@/hr/ui";

function Section({ title, icon: Icon, to, query, children, empty }) {
  const navigate = useNavigate();
  return (
    <Card title={<span className="flex items-center gap-2">{Icon && <Icon className="h-4 w-4 text-[#f96706]" aria-hidden="true" />}{title}</span>}
      actions={to && <Button size="sm" variant="ghost" onClick={() => navigate(to)}>Open</Button>}>
      {query.loading && query.data == null ? <Loading /> : query.error ? <ErrorState message={query.error} onRetry={query.reload} /> : (empty ? <EmptyState title={empty} /> : children)}
    </Card>
  );
}

export default function EmployeeDashboardPage() {
  const { hr } = useAuth();
  const me = hr?.employee;
  const today = useHrQuery(() => rpc("hr_my_attendance_today"), []);
  const balances = useHrQuery(() => rpc("hr_my_leave_balances", {}), []);
  const payslip = useHrQuery(() => run(from("hr_payslips").select("id, period_start, period_end, net, published_at").order("period_end", { ascending: false }).limit(1)), []);
  const notices = useHrQuery(() => run(from("hr_notifications").select("id, title, created_at, read_at").is("read_at", null).order("created_at", { ascending: false }).limit(5)), []);
  const assets = useHrQuery(() => run(from("hr_asset_assignments").select("id, acknowledged_at, asset:hr_assets(asset_tag, asset_type, brand, model)").eq("status", "active")), []);
  const requests = useHrQuery(() => run(from("hr_requests").select("id, subject, status, created_at").eq("employee_id", me?.id).not("status", "in", "(closed,cancelled)").order("created_at", { ascending: false }).limit(4)), [me?.id]);
  const t = today.data;
  const ps = payslip.data?.[0];

  return (
    <>
      <PageHeader title={`Welcome, ${me?.display_name ?? ""}`} description={<span className="flex items-center gap-2"><span className="font-mono font-bold text-[#1f4693]">{me?.employee_code}</span><StatusBadge status={me?.status} /></span>} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <Section title="Today's attendance" icon={Clock} to="/employee/attendance" query={today}>
          {t && (
            <div className="text-sm">
              <p className="text-slate-600">{formatDate(t.work_date)} · {t.shift?.is_working_day === false ? "non-working day" : "working day"}</p>
              <p className="mt-2 text-lg font-extrabold text-[#101a3a]">{t.checked_out ? "Checked out" : t.checked_in ? "Checked in" : "Not checked in"}</p>
              {t.record?.check_in_at && <p className="text-slate-600">In {formatDateTime(t.record.check_in_at)}{t.record.check_out_at ? ` · Out ${formatDateTime(t.record.check_out_at)}` : ""}</p>}
              {t.record?.worked_minutes != null && <p className="text-slate-600">Worked {minutesToHm(t.record.worked_minutes)}</p>}
              {t.record?.status && <div className="mt-2"><StatusBadge status={t.record.status} /></div>}
            </div>
          )}
        </Section>
        <Section title="Leave balance" icon={CalendarCheck} to="/employee/leave" query={balances} empty={balances.data && !balances.data.length ? "No leave balances yet" : null}>
          <ul className="flex flex-col gap-1.5 text-sm">{(balances.data ?? []).map((b, i) => (
            <li key={i} className="flex items-center justify-between"><span className="text-slate-700">{b.leave_type_name ?? b.name ?? b.code}</span><span className="font-bold text-[#101a3a]">{b.available}</span></li>))}</ul>
        </Section>
        <Section title="Latest payslip" icon={Wallet} to="/employee/payslips" query={payslip} empty={payslip.data && !ps ? "No payslips published yet" : null}>
          {ps && <div className="text-sm"><p className="text-slate-600">{formatDate(ps.period_start)} – {formatDate(ps.period_end)}</p><p className="mt-1 text-2xl font-extrabold text-[#101a3a]">{formatMoney(ps.net)}</p><p className="text-xs text-slate-500">Net pay · published {formatDate(ps.published_at)}</p></div>}
        </Section>
        <Section title="Unread notifications" icon={Bell} to="/employee/notifications" query={notices} empty={notices.data && !notices.data.length ? "You're all caught up" : null}>
          <ul className="flex flex-col gap-1.5 text-sm">{(notices.data ?? []).map((n) => <li key={n.id} className="flex justify-between gap-2"><span className="truncate font-medium text-[#101a3a]">{n.title}</span><span className="shrink-0 text-xs text-slate-500">{formatDate(n.created_at)}</span></li>)}</ul>
        </Section>
        <Section title="My assets" icon={Package} to="/employee/assets" query={assets} empty={assets.data && !assets.data.length ? "No assets assigned" : null}>
          <ul className="flex flex-col gap-1.5 text-sm">{(assets.data ?? []).map((a) => <li key={a.id} className="flex items-center justify-between gap-2"><span className="truncate">{a.asset?.asset_tag} · {a.asset?.asset_type}</span>{!a.acknowledged_at && <Badge tone="orange">acknowledge</Badge>}</li>)}</ul>
        </Section>
        <Section title="Open HR requests" icon={HeartHandshake} to="/employee/requests" query={requests} empty={requests.data && !requests.data.length ? "No open requests" : null}>
          <ul className="flex flex-col gap-1.5 text-sm">{(requests.data ?? []).map((r) => <li key={r.id} className="flex items-center justify-between gap-2"><span className="truncate">{r.subject}</span><StatusBadge status={r.status} /></li>)}</ul>
        </Section>
      </div>
    </>
  );
}
