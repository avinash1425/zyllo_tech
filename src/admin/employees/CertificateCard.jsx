import { useEffect, useRef, useState } from "react";
import { Award, Download, Eye, FileText, Trash2, Upload } from "lucide-react";
import {
  CERT_ACCEPT,
  certificateUrl,
  checkCertificateFile,
  fileSize,
  getCertificate,
  removeCertificate,
  uploadCertificate,
} from "@/lib/api/employee/certificate";
import { formatDateTime } from "@/employee/attendanceFormat";
import { Alert, Badge, Panel } from "@/components/portal/PortalUI";
import { BTN_DANGER, BTN_PRIMARY, BTN_SECONDARY, ICON_BTN_DANGER } from "@/components/portal/portalStyles";

/** Opens a link in a new tab, or saves it (the link itself carries the file name). */
async function openLink(getUrl, { download }) {
  const tab = download ? null : window.open("", "_blank");
  try {
    const url = await getUrl();
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
    return true;
  } catch {
    tab?.close();
    return false;
  }
}

/**
 * Admin: internship certificate of one employee (migration 245). Shown for
 * interns (and for anyone who already has a certificate). The intern
 * downloads it from My Profile and gets a notification when it is uploaded.
 */
export default function CertificateCard({ emp }) {
  const [cert, setCert] = useState(undefined); // undefined = loading, null = none
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [msg, setMsg] = useState({ kind: "", text: "" });
  const input = useRef(null);
  const isIntern = emp.employment_type === "intern";

  useEffect(() => {
    let active = true;
    getCertificate(emp.id)
      .then((c) => active && setCert(c))
      .catch(() => active && setCert(null));
    return () => {
      active = false;
    };
  }, [emp.id, reload]);

  if (cert === undefined || (!isIntern && !cert)) return null;

  async function onFile(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const problem = checkCertificateFile(file);
    if (problem) return setMsg({ kind: "err", text: problem });
    setBusy(true);
    setMsg({ kind: "", text: "" });
    const r = await uploadCertificate(emp.id, file);
    setBusy(false);
    if (!r.ok) return setMsg({ kind: "err", text: r.message });
    setMsg({ kind: "ok", text: `${cert ? "Certificate replaced" : "Certificate uploaded"}. ${emp.full_name} was notified and can download it from My Profile.` });
    setReload((n) => n + 1);
  }

  async function remove() {
    setBusy(true);
    const r = await removeCertificate(emp.id);
    setBusy(false);
    setConfirm(false);
    if (!r.ok) return setMsg({ kind: "err", text: r.message });
    setMsg({ kind: "ok", text: "Certificate removed." });
    setReload((n) => n + 1);
  }

  const view = (download) =>
    openLink(() => certificateUrl(cert, { download }), { download }).then(
      (ok) => !ok && setMsg({ kind: "err", text: "Could not open the file. Please try again." }),
    );

  return (
    <Panel
      icon={Award}
      title="Internship certificate"
      subtitle="The intern downloads it from My Profile"
      action={cert ? <Badge tone="green" dot>Uploaded</Badge> : <Badge tone="amber" dot>Not uploaded</Badge>}
    >
      {msg.text && (
        <Alert kind={msg.kind === "ok" ? "ok" : "err"} className="mb-4">
          {msg.text}
        </Alert>
      )}
      {!isIntern && (
        <Alert kind="warn" className="mb-4">
          This employee is no longer an intern. The existing certificate stays available to them.
        </Alert>
      )}
      {cert ? (
        <div className="flex flex-col gap-3 rounded-xl bg-[#f8fafd] p-4 ring-1 ring-inset ring-[#eef1f7] sm:flex-row sm:items-center">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#1f4693] to-[#3b6fd1] text-white shadow-[0_6px_14px_-6px_rgba(31,70,147,0.6)]">
              <FileText size={20} aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-[#101a3a]">{cert.file_name}</p>
              <p className="text-xs text-[#676b7a]">
                {fileSize(cert.file_size)} · uploaded {formatDateTime(cert.uploaded_at)}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => view(false)} className={BTN_SECONDARY}>
              <Eye size={14} aria-hidden="true" /> View
            </button>
            <button type="button" onClick={() => view(true)} className={BTN_SECONDARY}>
              <Download size={14} aria-hidden="true" /> Download
            </button>
            {isIntern && (
              <button type="button" disabled={busy} onClick={() => input.current?.click()} className={BTN_SECONDARY}>
                <Upload size={14} aria-hidden="true" /> {busy ? "Uploading…" : "Replace"}
              </button>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirm(true)}
              className={ICON_BTN_DANGER}
              aria-label="Remove certificate"
              title="Remove certificate"
            >
              <Trash2 size={15} aria-hidden="true" />
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-start gap-3 rounded-xl border-2 border-dashed border-[#dce6f7] bg-[#fafbff] p-4 sm:flex-row sm:items-center">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#f7941e]/15 to-[#1f4693]/10 text-[#1f4693]">
            <Upload size={20} aria-hidden="true" />
          </span>
          <p className="flex-1 text-sm text-[#676b7a]">
            <span className="block font-semibold text-[#2b303b]">No certificate uploaded yet.</span>
            PDF, PNG, JPG or WEBP, up to 10 MB.
          </p>
          <button type="button" disabled={busy} onClick={() => input.current?.click()} className={BTN_PRIMARY}>
            <Upload size={15} aria-hidden="true" /> {busy ? "Uploading…" : "Upload certificate"}
          </button>
        </div>
      )}
      {confirm && (
        <div role="alertdialog" aria-label="Remove certificate" className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <span className="font-semibold">Remove this certificate? The intern will no longer be able to download it.</span>
          <button type="button" disabled={busy} onClick={remove} className={BTN_DANGER}>
            {busy ? "Removing…" : "Remove"}
          </button>
          <button type="button" disabled={busy} onClick={() => setConfirm(false)} className={BTN_SECONDARY}>
            Cancel
          </button>
        </div>
      )}
      <input ref={input} type="file" accept={CERT_ACCEPT} onChange={onFile} className="hidden" aria-hidden="true" tabIndex={-1} />
    </Panel>
  );
}
