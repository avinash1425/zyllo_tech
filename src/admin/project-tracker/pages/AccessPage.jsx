import { useState } from "react";
import useLoad from "../useLoad";
import { Users } from "lucide-react";
import PageHeader from "../../PageHeader";
import EmptyState from "../../EmptyState";
import { listMembers, setMemberRole } from "@/lib/api/admin/projectTracker";
import { Banner, Button, Card, DataTable, Select, Spinner, TextInput, useToast } from "../ui";
import { useRole } from "../context";
import { PT_ROLES, labelOf } from "../lib/options";
import { formatDateTime } from "../lib/format";
import { isEmail } from "../lib/validation";

export default function AccessPage() {
  const { isManager } = useRole();
  const toast = useToast();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("viewer");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const { data, error: loadError, reload: load } = useLoad(() => (isManager ? listMembers() : Promise.resolve([])), [isManager]);
  const rows = data || (loadError ? [] : null);
  const error = loadError?.message || "";

  if (!isManager) return <EmptyState bordered title="Managers only" message="Only Project Tracker managers can manage access." />;

  async function submit(e) {
    e.preventDefault();
    if (!isEmail(email.trim())) { toast.push("Enter a valid email address.", "danger"); return; }
    setBusy(true);
    try {
      await setMemberRole(email.trim(), role, note.trim());
      toast.push("Role updated.");
      setEmail(""); setNote("");
      load();
    } catch (err) {
      toast.push(err.message, "danger");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader title="Project Tracker access" icon={Users}
        subtitle="Only website admins can ever use Project Tracker. Admins are Editors by default; here you can make an admin a Manager, a read-only Viewer, or block them." />
      <Banner tone="info">
        <strong>Viewer</strong> reads everything except credential references. <strong>Editor</strong> also creates, edits and archives records and prepares handovers.
        <strong> Manager</strong> also views credential references (logged), approves and completes handovers, restores archived records and manages these roles.
        Giving a role to someone who is not a website admin has no effect.
      </Banner>
      <Card title="Set a role">
        <form onSubmit={submit} className="grid grid-cols-1 gap-4 sm:grid-cols-4 sm:items-end">
          <TextInput type="email" label="Admin email" required value={email} onChange={setEmail} autoComplete="off" />
          <Select label="Role" required allowEmpty={false} value={role} onChange={setRole} options={PT_ROLES} />
          <TextInput label="Note" value={note} onChange={setNote} maxLength={500} />
          <Button type="submit" variant="primary" busy={busy}>Save role</Button>
        </form>
      </Card>
      <Card title="Role overrides">
        {error && <Banner tone="danger" className="mb-3">{error}</Banner>}
        {!rows ? <Spinner /> : (
          <DataTable caption="Role overrides" rows={rows} rowKey={(r) => r.user_id} empty="No overrides — every website admin is an Editor."
            columns={[
              { key: "email", label: "Email", sortable: false },
              { key: "role", label: "Role", sortable: false, render: (r) => labelOf(PT_ROLES, r.role) },
              { key: "note", label: "Note", sortable: false, render: (r) => r.note || "—" },
              { key: "granted_at", label: "Since", sortable: false, render: (r) => formatDateTime(r.granted_at) },
            ]} />
        )}
      </Card>
    </div>
  );
}
