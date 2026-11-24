import { useEffect, useState } from "react";
import { FolderOpen } from "lucide-react";
import { listEmployeeDocuments } from "@/lib/api/employee/documents";
import { DocumentList } from "@/employee/documentsUi";
import { Alert, Badge, Empty, Panel } from "@/components/portal/PortalUI";

/** Admin: documents the employee uploaded in My Profile (migration 251). Read-only: View / Download. */
export default function DocumentsCard({ emp, subtitle }) {
  const [docs, setDocs] = useState(undefined);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    listEmployeeDocuments(emp.id)
      .then((d) => active && setDocs(d))
      .catch(() => active && setDocs(null));
    return () => {
      active = false;
    };
  }, [emp.id]);

  return (
    <Panel icon={FolderOpen} title="Documents" subtitle={subtitle} action={docs?.length > 0 && <Badge tone="blue">{docs.length}</Badge>}>
      {error && (
        <Alert kind="err" className="mb-4">
          {error}
        </Alert>
      )}
      {docs === undefined ? (
        <p role="status" className="text-sm text-[#676b7a]">
          Loading…
        </p>
      ) : docs === null ? (
        <Alert kind="err">Could not load the documents. Please refresh the page.</Alert>
      ) : docs.length === 0 ? (
        <Empty icon={FolderOpen} title="Not added" message="The employee has not uploaded any documents yet." className="py-6" />
      ) : (
        <DocumentList docs={docs} onError={setError} />
      )}
    </Panel>
  );
}
