import { useEffect, useState } from "react";
import { Award, Download, Eye, FileText } from "lucide-react";
import { Alert, Badge, Panel } from "@/components/portal/PortalUI";
import { BTN_PRIMARY, BTN_SECONDARY } from "@/components/portal/portalStyles";
import { certificateUrl, fileSize, getMyCertificate } from "@/lib/api/employee/certificate";
import { formatDateTime } from "./attendanceFormat";

/**
 * My Profile: the internship certificate uploaded by the admin (migration 245).
 * Shown to interns (with a "not uploaded yet" note) and to anyone who has one.
 */
export default function MyCertificateCard({ isIntern }) {
  const [cert, setCert] = useState(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    getMyCertificate()
      .then((c) => active && setCert(c))
      .catch(() => active && setCert(null));
    return () => {
      active = false;
    };
  }, []);

  if (cert === undefined || (!cert && !isIntern)) return null;

  async function open(download) {
    // Open the tab first (browsers block pop-ups opened after waiting).
    const tab = download ? null : window.open("", "_blank");
    setBusy(true);
    setError("");
    try {
      const url = await certificateUrl(cert, { download });
      if (tab) {
        tab.location.href = url;
      } else {
        const a = document.createElement("a");
        a.href = url;
        a.rel = "noopener";
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
    } catch {
      tab?.close();
      setError("Could not open the certificate. Please try again.");
    }
    setBusy(false);
  }

  return (
    <Panel
      icon={Award}
      title="Internship certificate"
      subtitle={cert ? "Issued by the company" : "Not uploaded yet"}
      action={cert ? <Badge tone="green" dot>Available</Badge> : <Badge tone="slate">Pending</Badge>}
    >
      {cert ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/15">
              <FileText className="h-5 w-5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-[#101a3a]">{cert.file_name}</p>
              <p className="text-xs text-[#676b7a]">
                {fileSize(cert.file_size)} · issued {formatDateTime(cert.uploaded_at)}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy} onClick={() => open(false)} className={BTN_SECONDARY}>
              <Eye size={14} aria-hidden="true" /> View
            </button>
            <button type="button" disabled={busy} onClick={() => open(true)} className={BTN_PRIMARY}>
              <Download size={14} aria-hidden="true" /> Download
            </button>
          </div>
        </div>
      ) : (
        <p className="text-sm text-[#676b7a]">Your internship certificate will appear here once the company uploads it. You will get a notification.</p>
      )}
      {error && (
        <Alert kind="err" className="mt-3">
          {error}
        </Alert>
      )}
    </Panel>
  );
}
