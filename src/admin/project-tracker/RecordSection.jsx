import { useCallback, useMemo, useState } from "react";
import useLoad from "./useLoad";
import { Archive, ArchiveRestore, Eye, Pencil, Plus } from "lucide-react";
import { Badge, Banner, Button, Card, ConfirmDialog, DataTable, DefinitionGrid, Modal, Spinner, useToast } from "./ui";
import RecordForm from "./RecordForm";
import { renderValue } from "./cells";
import { useProject, useRole } from "./context";
import { SECTIONS } from "./lib/sections";
import { archiveRecord, createRecord, listRecords, restoreRecord, updateRecord } from "@/lib/api/admin/projectTracker";
import { formatDateTime } from "./lib/format";

function sortRows(rows, sort) {
  if (!sort) return rows;
  const dir = sort.dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = a[sort.key];
    const y = b[sort.key];
    if (x === y) return 0;
    if (x === null || x === undefined || x === "") return 1;
    if (y === null || y === undefined || y === "") return -1;
    return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "en", { numeric: true })) * dir;
  });
}

/** Read-only details of a record (all fields + audit metadata). */
export function RecordDetails({ section, record, refs }) {
  const items = section.fields.filter((f) => !f.secret && !(f.hidden && f.hidden(record))).map((f) => {
    let value;
    if (f.type === "ref") {
      const hit = (refs?.[f.ref] || []).find((r) => r.id === record[f.name]);
      value = hit ? hit.name || hit.provider || hit.domain_name || hit.service_name || hit.email_address || hit.repo_url || hit.title || hit.contract_number || "Linked" : record[f.name] ? "Linked record" : "—";
    } else {
      value = renderValue({ ...f, key: f.name, format: f.type === "datetime" ? "datetime" : f.type === "date" ? "date" : f.type }, record);
    }
    return { label: f.label, value, full: f.full };
  });
  if (section.table === "pt_access_records") items.splice(3, 0, { label: "Password", value: renderValue({ key: "has_password", format: "password" }, record) });
  for (const extra of ["backup_code", "task_code", "update_code"]) {
    if (record[extra]) items.unshift({ label: "ID", value: record[extra] });
  }
  items.push({ label: "Created", value: `${formatDateTime(record.created_at)}${record.created_by_email ? ` by ${record.created_by_email}` : ""}` });
  items.push({ label: "Last updated", value: `${formatDateTime(record.updated_at)}${record.updated_by_email ? ` by ${record.updated_by_email}` : ""}` });
  if (record.archived_at) items.push({ label: "Archived", value: `${formatDateTime(record.archived_at)}${record.archive_reason ? ` — ${record.archive_reason}` : ""}`, full: true });
  return <DefinitionGrid items={items} />;
}

/**
 * Generic list + CRUD for one record type of the current project.
 * props: sectionKey, description, rowActions(row) → [{ key, label, icon, onClick, hidden }],
 *        canEditRow(row), toolbar, onChanged()
 */
export default function RecordSection({ sectionKey, description, rowActions, canEditRow, toolbar, onChanged, emptyHint, maxActive, fieldsOverride, hideAdd, columnsOverride, rowFilter, afterSave }) {
  const base = SECTIONS[sectionKey];
  const section = useMemo(() => {
    let sec = fieldsOverride ? { ...base, fields: fieldsOverride(base.fields) } : base;
    if (columnsOverride) sec = { ...sec, columns: columnsOverride(sec.columns) };
    return sec;
  }, [base, fieldsOverride, columnsOverride]);
  const { project, refs, reloadRefs, reloadProject, readOnly } = useProject();
  const { canEdit, isManager, email } = useRole();
  const toast = useToast();
  const [showArchived, setShowArchived] = useState(false);
  const [sort, setSort] = useState(section.defaultSort);
  const [editing, setEditing] = useState(null); // null | "new" | row
  const [viewing, setViewing] = useState(null);
  const [confirm, setConfirm] = useState(null);

  const { data, error: loadError, reload: load } = useLoad(
    () => listRecords(section.table, project.id, { includeArchived: showArchived }),
    [section.table, project.id, showArchived],
  );
  const rows = data === undefined ? null : data;
  const error = loadError?.message || "";

  const afterChange = useCallback(async () => {
    load();
    reloadRefs?.();
    reloadProject?.();
    onChanged?.();
  }, [load, reloadRefs, reloadProject, onChanged]);

  const writable = canEdit && !readOnly;
  const sorted = useMemo(() => sortRows((rows || []).filter((r) => !rowFilter || rowFilter(r)), sort), [rows, sort, rowFilter]);

  const columns = [
    ...section.columns.map((c) => ({ ...c, render: (r) => renderValue(c, r) })),
    {
      key: "_actions",
      label: <span className="sr-only">Actions</span>,
      sortable: false,
      className: "w-px whitespace-nowrap text-right",
      render: (r) => (
        <div className="flex justify-end gap-1">
          {r.archived_at && <Badge value="archived" label="Archived" tone="neutral" />}
          <Button size="sm" variant="ghost" icon={Eye} onClick={() => setViewing(r)} aria-label={`View ${r[section.labelField] ?? section.singular}`}>View</Button>
          {writable && !r.archived_at && (canEditRow ? canEditRow(r) : true) && (
            <Button size="sm" variant="ghost" icon={Pencil} onClick={() => setEditing(r)} aria-label={`Edit ${r[section.labelField] ?? section.singular}`}>Edit</Button>
          )}
          {(rowActions?.(r) || []).filter((a) => !a.hidden).map((a) => (
            <Button key={a.key} size="sm" variant="ghost" icon={a.icon} onClick={() => a.onClick(r, afterChange)}>{a.label}</Button>
          ))}
          {writable && !r.archived_at && (
            <Button size="sm" variant="ghost" icon={Archive} aria-label={`Archive ${r[section.labelField] ?? section.singular}`}
              onClick={() => setConfirm({ kind: "archive", row: r })}>Archive</Button>
          )}
          {isManager && !readOnly && r.archived_at && (
            <Button size="sm" variant="ghost" icon={ArchiveRestore} onClick={() => setConfirm({ kind: "restore", row: r })}>Restore</Button>
          )}
        </div>
      ),
    },
  ];

  async function save(payload, values) {
    if (editing === "new") {
      const created = await createRecord(section.table, project.id, payload);
      if (afterSave) await afterSave(created, values);
      toast.push(`${section.singular[0].toUpperCase()}${section.singular.slice(1)} added.`);
    } else {
      if (Object.keys(payload).length > 0) await updateRecord(section.table, editing.id, payload, editing.updated_at);
      if (afterSave) await afterSave(editing, values);
      toast.push("Changes saved.");
    }
    setEditing(null);
    await afterChange();
  }

  return (
    <Card
      title={section.title}
      actions={<>
        {toolbar}
        <label className="flex items-center gap-2 text-xs font-medium text-[#676b7a]">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} className="accent-[#1f4693]" />
          Show archived
        </label>
        {writable && !hideAdd && !(maxActive && (rows || []).filter((r) => !r.archived_at).length >= maxActive) && (
          <Button variant="primary" size="sm" icon={Plus} onClick={() => setEditing("new")}>Add {section.singular}</Button>
        )}
      </>}
    >
      {description && <p className="mb-3 text-sm text-[#676b7a]">{description}</p>}
      {error && <Banner tone="danger" className="mb-3">{error}</Banner>}
      {rows === null ? <Spinner /> : (
        <DataTable
          caption={section.title}
          columns={columns}
          rows={sorted}
          sort={sort}
          onSort={(key) => setSort((s) => ({ key, dir: s?.key === key && s.dir === "asc" ? "desc" : "asc" }))}
          empty={emptyHint || `No ${section.singular}s recorded for this project yet.`}
          rowClass={(r) => (r.archived_at ? "opacity-60" : "")}
        />
      )}

      {editing && (
        <Modal title={editing === "new" ? `Add ${section.singular}` : `Edit ${section.singular}`} onClose={() => setEditing(null)} size="lg">
          <RecordForm
            fields={section.fields}
            rules={section.rules}
            record={editing === "new" ? null : editing}
            refs={refs}
            userEmail={email}
            onSubmit={save}
            onCancel={() => setEditing(null)}
          />
        </Modal>
      )}
      {viewing && (
        <Modal title={`${section.singular[0].toUpperCase()}${section.singular.slice(1)} details`} onClose={() => setViewing(null)} size="lg"
          footer={<Button variant="secondary" onClick={() => setViewing(null)}>Close</Button>}>
          <RecordDetails section={section} record={viewing} refs={refs} />
        </Modal>
      )}
      {confirm?.kind === "archive" && (
        <ConfirmDialog
          title={`Archive this ${section.singular}?`}
          message="Archived records are kept (never deleted), hidden from the active lists and become read-only. A manager can restore them."
          confirmLabel="Archive" requireReason reasonLabel="Reason for archiving"
          onConfirm={async (reason) => { await archiveRecord(section.table, confirm.row.id, reason); toast.push("Archived."); await afterChange(); }}
          onClose={() => setConfirm(null)} />
      )}
      {confirm?.kind === "restore" && (
        <ConfirmDialog
          title={`Restore this ${section.singular}?`} tone="primary" confirmLabel="Restore"
          message="The record becomes active and editable again."
          onConfirm={async () => { await restoreRecord(section.table, confirm.row.id); toast.push("Restored."); await afterChange(); }}
          onClose={() => setConfirm(null)} />
      )}
    </Card>
  );
}
