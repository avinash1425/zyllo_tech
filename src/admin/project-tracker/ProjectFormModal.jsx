import { useMemo, useState } from "react";
import { Banner, Button, Modal, Spinner, useToast } from "./ui";
import RecordForm from "./RecordForm";
import useLoad from "./useLoad";
import { useRole } from "./context";
import { PROJECT_FIELDS, PROJECT_RULES } from "./lib/sections";
import { createProject, findSimilarProjects, listCompanyOptions, updateRecord } from "@/lib/api/admin/projectTracker";
import { labelOf, PROJECT_STATUS } from "./lib/options";

/**
 * Create (project = null) or edit a project. `presetCompanyId` preselects the
 * company (when opened from a company page). Warns about a likely duplicate
 * (same name under the same company) before creating.
 */
export default function ProjectFormModal({ project, presetCompanyId, onClose, onSaved }) {
  const toast = useToast();
  const { isManager } = useRole();
  const [dupes, setDupes] = useState(null); // { list, payload }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const editing = Boolean(project);
  const { data: companies, error: loadError } = useLoad(() => listCompanyOptions({ includeId: project?.company_id }), [project?.company_id ?? null]);

  // Once a project has a company, only managers may move it to another one.
  const fields = useMemo(() => PROJECT_FIELDS.map((f) => {
    if (f.name !== "company_id") return f;
    if (editing && project.company_id && !isManager) return { ...f, readOnly: true, help: "Only managers can move a project to another company." };
    if (!editing && presetCompanyId) return { ...f, default: presetCompanyId };
    return f;
  }), [editing, project, isManager, presetCompanyId]);

  async function doCreate(payload) {
    const created = await createProject(payload);
    toast.push(`Project created (${created.project_code}).`);
    onSaved?.(created);
    onClose();
  }

  async function submit(payload, values) {
    if (editing) {
      if (Object.keys(payload).length === 0) { onClose(); return; }
      await updateRecord("pt_projects", project.id, payload, project.updated_at);
      toast.push("Project updated.");
      onSaved?.(project);
      onClose();
      return;
    }
    const similar = await findSimilarProjects(values.name, values.company_id);
    if (similar.length > 0) {
      setDupes({ list: similar, payload });
      return;
    }
    await doCreate(payload);
  }

  if (dupes) {
    return (
      <Modal title="Possible duplicate project" onClose={onClose} busy={busy}
        footer={<>
          <Button variant="ghost" onClick={() => setDupes(null)} disabled={busy}>Back to form</Button>
          <Button variant="primary" busy={busy} onClick={async () => {
            setBusy(true); setError("");
            try { await doCreate(dupes.payload); } catch (e) { setError(e.message); setBusy(false); }
          }}>Create anyway</Button>
        </>}>
        <p className="text-sm text-[#4b4f5c]">This company already has a project with the same name. Check this is not the same project:</p>
        <ul className="mt-3 divide-y divide-[#eef0f4] rounded-xl border border-[#eef0f4] text-sm">
          {dupes.list.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <span><span className="font-semibold">{d.project_code}</span> · {d.name} · {d.company_name}</span>
              <span className="text-xs text-[#676b7a]">{labelOf(PROJECT_STATUS, d.status)}</span>
            </li>
          ))}
        </ul>
        {error && <Banner tone="danger" className="mt-3">{error}</Banner>}
      </Modal>
    );
  }

  return (
    <Modal title={editing ? `Edit project ${project.project_code}` : "Add project"} onClose={onClose} size="lg">
      {loadError && <Banner tone="danger" className="mb-3">{loadError.message}</Banner>}
      {!companies ? <Spinner label="Loading companies…" /> : companies.length === 0 ? (
        <Banner tone="warning" title="Add a company first">Every project belongs to a company. Open Companies → Add Company, then add the project from that company.</Banner>
      ) : (
        <RecordForm fields={fields} rules={PROJECT_RULES} record={project || null} refs={{ companies }} onSubmit={submit} onCancel={onClose}
          submitLabel={editing ? "Save changes" : "Create project"} />
      )}
    </Modal>
  );
}
