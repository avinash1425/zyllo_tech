import { useCallback } from "react";
import RecordSection from "../RecordSection";
import { Banner } from "../ui";
import { useProject } from "../context";
import { PasswordCell, useBackend } from "../credentials";
import { ensureEmailCredential, ensureHostingCredential, listRecords } from "@/lib/api/admin/projectTracker";

/** Password column for rows that link to a pt_access_records credential (email accounts, hosting). */
function useLinkedPasswordColumn(linkKey, ensure) {
  const { project, refs, reloadRefs, readOnly } = useProject();
  return useCallback((cols) => [...cols, {
    key: "_password", label: "Password", sortable: false,
    render: (row) => {
      const cred = (refs.access || []).find((a) => a.id === row[linkKey]);
      const ensureCred = async () => {
        const id = await ensure(row.id);
        const recs = await listRecords("pt_access_records", project.id);
        reloadRefs();
        return recs.find((r) => r.id === id);
      };
      return <PasswordCell compact record={cred || { id: null, has_password: false, service_name: row.email_address || row.provider }}
        readOnly={readOnly || Boolean(row.archived_at)} onChanged={reloadRefs} onEnsure={cred ? undefined : ensureCred} />;
    },
  }], [refs.access, linkKey, ensure, project.id, reloadRefs, readOnly]);
}

export function EmailsTab() {
  const backend = useBackend();
  const columnsOverride = useLinkedPasswordColumn("linked_access_id", ensureEmailCredential);
  return (
    <div className="space-y-4">
      {backend === "disabled" && <Banner tone="warning">Mailbox passwords cannot be saved yet: no secure vault is configured. Keep them in your password manager.</Banner>}
      <RecordSection sectionKey="emails" columnsOverride={columnsOverride}
        description="Mailboxes used by the project. A mailbox password is stored only in the encrypted vault through its linked credential record — never in this table." />
    </div>
  );
}

export function HostingTab() {
  const columnsOverride = useLinkedPasswordColumn("access_record_id", ensureHostingCredential);
  return (
    <RecordSection sectionKey="hosting" columnsOverride={columnsOverride}
      description="Every hosting provider and environment used by this project. Each hosting account's login password lives in the encrypted vault (via its credential record). When moving providers, set the old record to Migrated — the history stays." />
  );
}
