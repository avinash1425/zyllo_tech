// Holiday calendar — the single holiday master shared by Leave and
// Attendance. Writes require leave.manage (RLS). Optional holidays do not
// block a working day (employees take them as leave). A holiday can apply to
// every company / location or to one. Changing holidays never rewrites
// existing leave: affected pending/approved requests are flagged for an
// approver to recalculate (migration 160).
import { useState } from "react";
import { formatDate, from, run } from "@/lib/hr/client";
import { toOptions, useOrg } from "@/lib/hr/org";
import { HOLIDAY_TYPES } from "@/lib/hr/leave";
import { Badge, Button, Card, ConfirmDialog, ErrorState, Loading, useToast } from "@/hr/ui";
import MasterDataEditor from "@/hr/components/MasterDataEditor";

export default function HolidaysSettings({ canEdit }) {
  const org = useOrg();
  const { notify } = useToast();
  const [version, setVersion] = useState(0);
  const [deleting, setDeleting] = useState(null);
  if (org.loading && !org.data) return <Loading />;
  if (org.error) return <ErrorState message={org.error} onRetry={org.reload} />;
  const locName = (id) => org.data?.locations?.find((l) => l.id === id)?.name;
  const companyName = (id) => org.data?.legalEntities?.find((l) => l.id === id)?.name;

  const config = {
    table: "hr_holidays", title: "Holidays", singular: "holiday", orderBy: "holiday_date", noActive: true,
    select: "id, holiday_date, name, type, location_id, legal_entity_id, is_recurring, description",
    description: "Non-optional holidays are excluded from leave day counts and treated as non-working days for attendance and daily-report compliance. Editing a holiday flags affected leave for recalculation; it never changes approved leave silently.",
    columns: [
      { key: "holiday_date", header: "Date", render: (r) => formatDate(r.holiday_date, { weekday: "short", day: "2-digit", month: "short", year: "numeric" }) },
      { key: "name", header: "Name" },
      { key: "type", header: "Type", render: (r) => <Badge tone={r.type === "optional" ? "violet" : "blue"}>{r.type}</Badge> },
      { key: "legal_entity_id", header: "Company", render: (r) => (r.legal_entity_id ? companyName(r.legal_entity_id) ?? "Company" : "All companies") },
      { key: "location_id", header: "Location", render: (r) => (r.location_id ? locName(r.location_id) ?? "Location" : "All locations") },
      { key: "is_recurring", header: "Repeats", render: (r) => (r.is_recurring ? <Badge tone="green">every year</Badge> : "—") },
      ...(canEdit ? [{ key: "_del", header: <span className="sr-only">Delete</span>, render: (r) => <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); setDeleting(r); }}>Delete</Button> }] : []),
    ],
    fields: [
      { key: "holiday_date", label: "Date", type: "date", required: true },
      { key: "name", label: "Name", required: true, pattern: "^.{2,120}$", patternMessage: "2–120 characters." },
      { key: "type", label: "Type", type: "select", required: true, placeholder: undefined, options: HOLIDAY_TYPES.map((t) => ({ value: t, label: t })) },
      { key: "legal_entity_id", label: "Company", type: "select", placeholder: "All companies", options: toOptions(org.data?.legalEntities) },
      { key: "location_id", label: "Location", type: "select", placeholder: "All locations", options: toOptions(org.data?.locations) },
      { key: "is_recurring", label: "Repeats every year on this date (not 29 Feb)", type: "checkbox" },
      { key: "description", label: "Description", type: "textarea" },
    ],
    defaults: { type: "company", is_recurring: false },
  };

  return (
    <Card>
      <MasterDataEditor key={version} config={config} canEdit={canEdit} />
      <ConfirmDialog open={Boolean(deleting)} onClose={() => setDeleting(null)} title="Delete holiday?" tone="danger" confirmLabel="Delete"
        message={deleting ? `${deleting.name} on ${formatDate(deleting.holiday_date)} will be removed. Affected leave requests are flagged for recalculation; nothing is changed automatically.` : ""}
        onConfirm={async () => {
          const res = await run(from("hr_holidays").delete().eq("id", deleting.id).select("id"));
          if (res.error) return { error: res.error };
          if (!res.data?.length) return { error: "The holiday could not be deleted (you may not have permission)." };
          notify("Holiday deleted."); setVersion((v) => v + 1);
          return {};
        }} />
    </Card>
  );
}
