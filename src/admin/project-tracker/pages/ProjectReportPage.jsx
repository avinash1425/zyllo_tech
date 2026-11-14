import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import Link from "@/lib/nx/link";
import { ChevronLeft, FileSpreadsheet, Printer } from "lucide-react";
import EmptyState from "../../EmptyState";
import { getProjectBundle } from "@/lib/api/admin/projectTracker";
import { Banner, Button, Spinner, useToast } from "../ui";
import { SECTIONS, PROJECT_FIELDS } from "../lib/sections";
import { plainValue } from "../cells";
import { exportXLSX, printElement } from "../export";
import { COMPLETENESS, HANDOVER_ITEMS, HANDOVER_ITEM_STATE, HANDOVER_STATUS, SECTION_STATE, labelOf } from "../lib/options";
import { formatDate, formatDateTime } from "../lib/format";

// Sections in report order: [bundle key, SECTIONS key, heading]
const ORDER = [
  ["hosting", "hosting", "Hosting & Servers"],
  ["domains", "domains", "Domains & SSL"],
  ["emails", "emails", "Emails & Accounts"],
  ["access", "access", "Credentials & Access (references only — no secrets)"],
  ["backups", "backups", "Backups & Recovery"],
  ["repositories", "repositories", "Source Repositories"],
  ["deployments", "deployments", "Deployments"],
  ["updates", "updates", "Updates & Maintenance"],
  ["amc", "amc", "AMC Contracts"],
  ["renewals", "renewals", "Renewals"],
  ["seo", "seo", "SEO & Analytics"],
  ["milestones", "milestones", "Milestones"],
  ["tasks", "tasks", "Tasks"],
  ["documents", "documents", "Documents"],
];

// Columns for a section: every non-reference field (ids of linked records are not meaningful on paper).
function sectionColumns(key) {
  const s = SECTIONS[key];
  const cols = s.fields.filter((f) => f.type !== "ref" && !f.secret).map((f) => ({ key: f.name, label: f.label, format: f.type, options: f.options }));
  if (key === "access") cols.splice(3, 0, { key: "has_password", label: "Password", format: "password" }, { key: "has_reference", label: "Password-manager reference", format: "reference" });
  if (key === "backups") cols.unshift({ key: "backup_code", label: "Backup ID" });
  if (key === "tasks") cols.unshift({ key: "task_code", label: "Task ID" });
  if (key === "updates") cols.unshift({ key: "update_code", label: "Update ID" });
  if (key === "documents") cols.push({ key: "file", label: "Source", text: (r) => (r.storage_path ? "Uploaded file (private)" : "External link") },
    { key: "created_by_email", label: "Uploaded by" }, { key: "created_at", label: "Upload date", format: "date" });
  return cols;
}

function Records({ rows, columns }) {
  if (!rows.length) return <p className="text-sm text-[#676b7a]">None recorded.</p>;
  return rows.map((r, i) => (
    <div key={r.id} className="mb-3 rounded-lg border border-[#eef0f4] p-3">
      <h3 className="mb-1 text-sm font-semibold text-[#2b303b]">{i + 1}. {plainValue(columns[0], r) || "Record"}</h3>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-3">
        {columns.map((c) => {
          const v = plainValue(c, r);
          return v ? (
            <div key={c.key}><dt className="text-[10.5px] uppercase tracking-wide text-[#8a8f9c]">{c.label}</dt><dd className="whitespace-pre-wrap break-words text-sm">{v}</dd></div>
          ) : null;
        })}
      </dl>
    </div>
  ));
}

export default function ProjectReportPage() {
  const { id } = useParams();
  const toast = useToast();
  const [bundle, setBundle] = useState(undefined);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    let active = true;
    getProjectBundle(id).then((b) => active && setBundle(b)).catch((e) => { if (active) { setError(e.message); setBundle(null); } });
    return () => { active = false; };
  }, [id]);

  if (bundle === undefined) return <Spinner label="Building report…" />;
  if (!bundle) return <EmptyState bordered title="Report unavailable" message={error || "Project not found or not accessible."} />;
  const p = bundle.project;
  const title = `Project Information Report — ${p.project_code} ${p.name}`;
  const projectCols = PROJECT_FIELDS.map((f) => (f.name === "company_id"
    ? { key: "company_name", label: "Company", text: (r) => (r.company_name ? `${r.company_name} (${r.company_number})` : "Unassigned") }
    : { key: f.name, label: f.label, format: f.type, options: f.options }));

  async function toExcel() {
    setBusy(true);
    try {
      const sheets = [
        { name: "Project", columns: [{ key: "serial_no", label: "Serial No" }, ...projectCols,
          { key: "completeness_score", label: "Documentation score %" }, { key: "completeness_label", label: "Documentation", options: COMPLETENESS }], rows: [p] },
        ...ORDER.map(([bk, sk, heading]) => ({ name: heading.split(" (")[0].slice(0, 31), columns: sectionColumns(sk), rows: bundle[bk] })),
        { name: "Handover checklist", columns: [
          { key: "item_key", label: "Item", options: HANDOVER_ITEMS }, { key: "state", label: "Status", options: HANDOVER_ITEM_STATE },
          { key: "evidence_note", label: "Evidence" }, { key: "completed_at", label: "Completed", format: "datetime" }, { key: "completed_by_email", label: "By" }],
          rows: bundle.handoverItems },
      ];
      await exportXLSX(title, sheets);
    } catch (e) {
      toast.push(e.message || "Export failed.", "danger");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href={`/admin/project-tracker/projects/${p.id}`} className="inline-flex items-center gap-1 text-sm font-medium text-[#676b7a] hover:text-[#1f4693]">
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />Back to project
        </Link>
        <div className="flex gap-2">
          <Button icon={FileSpreadsheet} busy={busy} onClick={toExcel}>Excel</Button>
          <Button variant="primary" icon={Printer} onClick={() => { try { printElement(ref.current, title); } catch (e) { toast.push(e.message, "danger"); } }}>Print / PDF</Button>
        </div>
      </div>
      <Banner tone="info">This report contains no passwords, keys, tokens, recovery codes or vault references. Credential records show only a masked account name and whether a reference exists.</Banner>
      <article ref={ref} className="rounded-2xl border border-[#e7e9ee] bg-white p-5 sm:p-8">
        <h1 className="text-xl font-bold text-[#101a3a]">{title}</h1>
        <p className="meta text-xs text-[#676b7a]">Zyllo Tech · Project Tracker · generated {formatDateTime(new Date().toISOString())} · company {p.company_name || "unassigned"}</p>

        <h2 className="mt-6 border-b-2 border-[#101a3a] pb-1 text-base font-bold">Project Overview</h2>
        <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-3">
          {[{ key: "serial_no", label: "Serial No" }, ...projectCols].map((c) => {
            const v = plainValue(c, p);
            return v ? <div key={c.key}><dt className="text-[10.5px] uppercase tracking-wide text-[#8a8f9c]">{c.label}</dt><dd className="whitespace-pre-wrap break-words text-sm">{v}</dd></div> : null;
          })}
          <div><dt className="text-[10.5px] uppercase tracking-wide text-[#8a8f9c]">Documentation completeness</dt><dd className="text-sm">{p.completeness_score}% · {labelOf(COMPLETENESS, p.completeness_label)}</dd></div>
          <div><dt className="text-[10.5px] uppercase tracking-wide text-[#8a8f9c]">AMC applicable</dt><dd className="text-sm">{p.amc_applicable ? "Yes" : "No"}</dd></div>
          <div><dt className="text-[10.5px] uppercase tracking-wide text-[#8a8f9c]">SEO applicable</dt><dd className="text-sm">{p.seo_applicable ? "Yes" : "No"}</dd></div>
        </dl>
        <h3 className="mt-3 text-sm font-semibold">Section status</h3>
        <table className="mt-1 w-full text-left text-sm">
          <thead><tr><th className="border border-[#d9dce3] bg-[#f1f3f7] px-2 py-1">Section</th><th className="border border-[#d9dce3] bg-[#f1f3f7] px-2 py-1">Status</th></tr></thead>
          <tbody>
            {[["overview_state", "Overview"], ["hosting_state", "Hosting"], ["domain_state", "Domain"], ["admin_access_state", "Admin access"], ["backups_state", "Backups"],
              ["source_state", "Source code"], ["maintenance_state", "Maintenance"], ["amc_state", "AMC"], ["seo_state", "SEO"], ["handover_state", "Handover"]].map(([k, l]) => (
              <tr key={k}><td className="border border-[#d9dce3] px-2 py-1">{l}</td><td className="border border-[#d9dce3] px-2 py-1">{labelOf(SECTION_STATE, p[k])}</td></tr>
            ))}
          </tbody>
        </table>

        {ORDER.map(([bk, sk, heading]) => (
          <section key={bk}>
            <h2 className="mt-6 border-b-2 border-[#101a3a] pb-1 text-base font-bold">{heading} ({bundle[bk].length})</h2>
            <div className="mt-2"><Records rows={bundle[bk]} columns={sectionColumns(sk)} /></div>
          </section>
        ))}

        <h2 className="mt-6 border-b-2 border-[#101a3a] pb-1 text-base font-bold">Handover</h2>
        {!bundle.handover ? <p className="mt-2 text-sm text-[#676b7a]">Not started.</p> : (
          <>
            <p className="mt-2 text-sm">Status: <strong>{labelOf(HANDOVER_STATUS, bundle.handover.status)}</strong> · Recipient: {bundle.handover.recipient_name || "—"} · Date: {formatDate(bundle.handover.handover_date)}
              {bundle.handover.approved_at ? ` · Approved ${formatDateTime(bundle.handover.approved_at)} by ${bundle.handover.approved_by_email || "—"}` : ""}
              {bundle.handover.handed_over_at ? ` · Handed over ${formatDateTime(bundle.handover.handed_over_at)}` : ""}</p>
            <table className="mt-2 w-full text-left text-sm">
              <thead><tr>{["Item", "Status", "Evidence", "Completed"].map((h) => <th key={h} className="border border-[#d9dce3] bg-[#f1f3f7] px-2 py-1">{h}</th>)}</tr></thead>
              <tbody>
                {bundle.handoverItems.map((it) => (
                  <tr key={it.id}>
                    <td className="border border-[#d9dce3] px-2 py-1">{labelOf(HANDOVER_ITEMS, it.item_key)}</td>
                    <td className="border border-[#d9dce3] px-2 py-1">{labelOf(HANDOVER_ITEM_STATE, it.state)}</td>
                    <td className="border border-[#d9dce3] px-2 py-1">{it.evidence_note || (it.evidence_document_id ? "Document attached" : "—")}</td>
                    <td className="border border-[#d9dce3] px-2 py-1">{it.completed_at ? `${formatDateTime(it.completed_at)} ${it.completed_by_email || ""}` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </article>
    </div>
  );
}
