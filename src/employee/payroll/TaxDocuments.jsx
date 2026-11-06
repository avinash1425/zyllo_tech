// "Tax documents" tab:
//   * Annual salary & tax statement — totals of TDS, PF, ESI and professional
//     tax deducted in a financial year, from released payslips, downloadable
//     as a PDF built on the device (nothing stored). Not Form 16.
//   * Tax documents on file — employee documents in the 'tax' group
//     (migration 172): Form 16 and other employer tax papers issued by HR, and
//     the employee's own tax declarations / investment proofs.
import { useState } from "react";
import { Download, Eye, FileDown, FilePlus2, Upload } from "lucide-react";
import { formatDate, formatMoney, useHrQuery } from "@/lib/hr/client";
import { latestVersion, listDocumentCategories, listEmployeeDocuments } from "@/lib/hr/documents";
import { TAX_BUCKET_LABELS, ayLabel, fyMonths } from "@/lib/hr/payrollSummary";
import { buildTaxStatementPdf, downloadPdfBytes, taxStatementFileName } from "@/lib/hr/payslipPdf";
import { NewVersionModal, UploadDocumentModal, openVersion } from "@/hr/pages/DocumentsPage";
import { Button, Card, DataTable, EmptyState, StatusBadge, useToast } from "@/hr/ui";

const BUCKETS = ["tds", "pf", "esi", "pt", "other"];

export default function TaxDocuments({ me, summary, yearPicker, employee, company }) {
  return (
    <div className="flex flex-col gap-4">
      <TaxStatement summary={summary} yearPicker={yearPicker} employee={employee} company={company} />
      <TaxDocumentsOnFile me={me} />
    </div>
  );
}

function TaxStatement({ summary, yearPicker, employee, company }) {
  const { notify } = useToast();
  if (!summary || !summary.totals.payslips) {
    return <Card title="Annual salary & tax statement" actions={yearPicker}><EmptyState title="No payslips in this financial year" description="The statement is available once a payslip for the year has been released." /></Card>;
  }
  const cur = summary.currency;
  const months = fyMonths(summary.fy);
  function download() {
    try {
      const bytes = buildTaxStatementPdf(summary, employee, company, {
        fy: summary.label, ay: ayLabel(summary.fy), months, buckets: TAX_BUCKET_LABELS,
      });
      downloadPdfBytes(bytes, taxStatementFileName(summary.fy, employee?.employee_code));
    } catch {
      notify("The statement could not be generated. Please try again.", "error");
    }
  }
  const shown = BUCKETS.filter((b) => b !== "other" || Number(summary.tax.other));
  return (
    <Card title={`Annual salary & tax statement · ${summary.label} (${ayLabel(summary.fy)})`}
      actions={<div className="flex flex-wrap items-center gap-2">{yearPicker}<Button size="sm" onClick={download}><FileDown className="h-4 w-4" aria-hidden="true" />Download PDF</Button></div>}>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <div className="rounded-xl bg-slate-50 p-3"><dt className="text-xs text-slate-500">Gross earnings</dt><dd className="text-base font-extrabold tabular-nums">{formatMoney(summary.totals.gross, cur)}</dd></div>
        {shown.map((b) => (
          <div key={b} className="rounded-xl bg-slate-50 p-3"><dt className="text-xs text-slate-500">{TAX_BUCKET_LABELS[b]}</dt><dd className="text-base font-bold tabular-nums">{formatMoney(summary.tax[b], cur)}</dd></div>
        ))}
      </dl>
      <p className="mt-3 text-xs text-slate-500">
        Totals of what payroll deducted on your {summary.totals.payslips} released payslip{summary.totals.payslips === 1 ? "" : "s"} for {summary.label}.
        This is <strong>not Form 16</strong> and not a tax computation — use the Form 16 your employer issues (listed below once HR uploads it) when filing
        your return, and check that the TDS shows against your PAN in Form 26AS / AIS on the income-tax e-filing portal.
      </p>
    </Card>
  );
}

function TaxDocumentsOnFile({ me }) {
  const { notify } = useToast();
  const docs = useHrQuery(async () => {
    const res = await listEmployeeDocuments(me);
    return { ...res, data: res.data?.filter((d) => d.category?.doc_group === "tax") ?? null };
  }, [me]);
  const cats = useHrQuery(() => listDocumentCategories({ activeOnly: true }), []);
  const [uploading, setUploading] = useState(false);
  const [versionFor, setVersionFor] = useState(null);
  const taxCats = (cats.data ?? []).filter((c) => c.doc_group === "tax");
  const canUpload = taxCats.some((c) => c.employee_can_upload && !c.is_confidential);
  return (
    <Card title="Tax documents on file" padded={false}
      actions={canUpload && <Button size="sm" variant="secondary" onClick={() => setUploading(true)}><Upload className="h-4 w-4" aria-hidden="true" />Upload declaration / proof</Button>}>
      <DataTable caption="My tax documents" rows={docs.data} loading={docs.loading} error={docs.error} onRetry={docs.reload}
        emptyTitle="No tax documents yet" emptyDescription="Your Form 16 appears here after the financial year once HR issues it. You can also upload tax-saving declarations and proofs for payroll."
        columns={[
          { key: "title", header: "Document", render: (r) => <div className="min-w-[10rem]"><p className="font-semibold text-[#101a3a]">{r.title}</p><p className="text-xs text-slate-500">{r.category?.name}</p></div> },
          { key: "created_at", header: "Added", render: (r) => formatDate(r.created_at) },
          { key: "current_version", header: "Version", render: (r) => (r.current_version ? `v${r.current_version}` : "—") },
          { key: "verification_status", header: "Status", render: (r) => <StatusBadge status={r.verification_status} /> },
          { key: "_a", header: <span className="sr-only">Actions</span>, render: (r) => {
            const latest = latestVersion(r);
            return (
              <span className="flex flex-wrap gap-1">
                <Button size="sm" variant="ghost" disabled={!latest} onClick={() => openVersion(latest, "view", notify)} aria-label={`View ${r.title}`}><Eye className="h-4 w-4" aria-hidden="true" />View</Button>
                <Button size="sm" variant="ghost" disabled={!latest} onClick={() => openVersion(latest, "download", notify)} aria-label={`Download ${r.title}`}><Download className="h-4 w-4" aria-hidden="true" />Download</Button>
                {r.category?.employee_can_upload && !r.category?.is_confidential && r.verification_status !== "replaced" && (
                  <Button size="sm" variant="secondary" onClick={() => setVersionFor(r)}><FilePlus2 className="h-4 w-4" aria-hidden="true" />New version</Button>)}
              </span>
            );
          } },
        ]} />
      <p className="px-4 py-3 text-xs text-slate-500">
        Stored privately: only you and authorised HR / payroll staff can open these. Declarations and proofs help payroll estimate your monthly TDS;
        payroll verifies them. Missing your Form 16? Ask payroll from the Requests tab.
      </p>
      {uploading && <UploadDocumentModal open mode="self" employeeId={me} categories={cats.data} preset={{ category: taxCats.find((c) => c.employee_can_upload)?.code ?? "", groups: ["tax"] }}
        onClose={() => setUploading(false)} onDone={docs.reload} />}
      {versionFor && <NewVersionModal doc={versionFor} onClose={() => setVersionFor(null)} onDone={docs.reload} />}
    </Card>
  );
}
