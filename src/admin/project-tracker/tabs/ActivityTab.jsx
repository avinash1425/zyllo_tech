import { useState } from "react";
import useLoad from "../useLoad";
import { MessageSquare } from "lucide-react";
import { Banner, Button, Card, Pagination, Spinner, TextArea, useToast } from "../ui";
import { useProject, useRole } from "../context";
import { createRecord, listActivity, listRecords } from "@/lib/api/admin/projectTracker";
import { actionLabel, detailText, entityText } from "../lib/activity";
import { formatDateTime } from "../lib/format";
import { looksLikeSecret } from "../lib/validation";

export default function ActivityTab() {
  const { project, readOnly } = useProject();
  const { canEdit } = useRole();
  const toast = useToast();
  const [page, setPage] = useState(1);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const { data, error: loadError, reload: load } = useLoad(async () => {
    const [l, r] = await Promise.all([
      listActivity(project.id, { page, pageSize: 25 }),
      listRecords("pt_remarks", project.id, { orderBy: "created_at", ascending: false }),
    ]);
    return { log: l, remarks: r };
  }, [project.id, page]);
  const error = loadError?.message || "";
  const log = data?.log || (loadError ? { rows: [], count: 0 } : null);
  const remarks = data?.remarks || (loadError ? [] : null);

  async function addRemark(e) {
    e.preventDefault();
    const body = draft.trim();
    if (!body) return;
    if (looksLikeSecret(body)) { toast.push("That remark looks like it contains a secret. Remove it.", "danger"); return; }
    setBusy(true);
    try {
      await createRecord("pt_remarks", project.id, { body });
      setDraft("");
      toast.push("Remark added.");
      setPage(1);
      load();
    } catch (err) {
      toast.push(err.message, "danger");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-5">
      <Card title="Remarks" className="xl:col-span-2">
        {canEdit && !readOnly && (
          <form onSubmit={addRemark} className="mb-4 space-y-2">
            <TextArea label="Add a remark" value={draft} onChange={setDraft} rows={3} maxLength={5000} />
            <div className="flex justify-end"><Button type="submit" variant="primary" icon={MessageSquare} busy={busy} disabled={!draft.trim()}>Add remark</Button></div>
          </form>
        )}
        {remarks === null ? <Spinner /> : remarks.length === 0 ? <p className="text-sm text-[#676b7a]">No remarks yet.</p> : (
          <ul className="space-y-3">
            {remarks.map((r) => (
              <li key={r.id} className="rounded-xl border border-[#eef0f4] p-3">
                <p className="whitespace-pre-wrap text-sm text-[#2b303b]">{r.body}</p>
                <p className="mt-1 text-xs text-[#676b7a]">{r.created_by_email || "—"} · {formatDateTime(r.created_at)}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title="Activity history" className="xl:col-span-3">
        <p className="mb-3 text-xs text-[#676b7a]">Recorded automatically by the database. Entries cannot be edited or deleted, and never contain passwords, references or other secrets — only what changed.</p>
        {error && <Banner tone="danger" className="mb-3">{error}</Banner>}
        {log === null ? <Spinner /> : log.rows.length === 0 ? <p className="text-sm text-[#676b7a]">No activity yet.</p> : (
          <>
            <ol className="space-y-2">
              {log.rows.map((r) => (
                <li key={r.id} className="border-l-2 border-[#e7e9ee] pl-3 text-sm">
                  <p className="text-[#2b303b]"><span className="font-semibold">{actionLabel(r.action)}</span>{entityText(r) ? ` — ${entityText(r)}` : ""}</p>
                  {detailText(r.details) && <p className="text-xs text-[#4b4f5c]">{detailText(r.details)}</p>}
                  <p className="text-xs text-[#8a8f9c]">{formatDateTime(r.created_at)}{r.actor_email ? ` · ${r.actor_email}` : ""}</p>
                </li>
              ))}
            </ol>
            <Pagination page={page} pageSize={25} count={log.count} onPage={setPage} />
          </>
        )}
      </Card>
    </div>
  );
}
