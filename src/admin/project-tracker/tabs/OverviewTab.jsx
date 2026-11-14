import { useState } from "react";
import Link from "@/lib/nx/link";
import {
  CalendarClock, CheckCircle2, Circle, ClipboardCheck, DatabaseBackup, FileText, Globe, KeyRound, Mail, MinusCircle, Pencil, Search as SearchIcon, Server,
} from "lucide-react";
import useLoad from "../useLoad";
import { Badge, Button, Card, Checkbox, DefinitionGrid, Spinner, useToast } from "../ui";
import { useProject, useRole } from "../context";
import { SafeLink } from "../cells";
import { CompletenessPill, ProgressBar } from "../pages/ProjectsPage";
import { getHandover, listActivity, listRecords, updateRecord } from "@/lib/api/admin/projectTracker";
import {
  HANDOVER_ITEMS, HANDOVER_STATUS, NA_SECTIONS, PRIORITY, PROJECT_CATEGORY, PROJECT_STATUS, SECTION_STATE, SEO_STATUS, UPDATE_TYPE, labelOf,
} from "../lib/options";
import { formatDate, formatDateTime } from "../lib/format";
import { actionLabel, detailText, entityText } from "../lib/activity";

const SECTION_ROWS = [
  ["overview_state", "Project Overview", "overview"],
  ["hosting_state", "Hosting", "hosting"],
  ["domain_state", "Domain", "domains"],
  ["admin_access_state", "Admin Access", "access"],
  ["backups_state", "Backups", "backups"],
  ["source_state", "Source Code", "source"],
  ["maintenance_state", "Maintenance", "maintenance"],
  ["amc_state", "AMC", "amc"],
  ["seo_state", "SEO", "seo"],
  ["handover_state", "Handover", "documents"],
];
const SECTION_RULES = {
  overview_state: "Description, scope, responsible person and start date.",
  hosting_state: "An active production hosting record with a renewal/expiry date and a responsible person.",
  domain_state: "An active domain with registrar, expiry date and SSL details.",
  admin_access_state: "An active Website Admin or Hosting Panel access record with a vault reference.",
  backups_state: "A backup verified in the last 90 days, and restore instructions.",
  source_state: "A repository with its main / deployment branch.",
  maintenance_state: "An update logged in the last 180 days (applies once Live).",
  amc_state: "An active AMC contract that has not ended (only when AMC applies).",
  seo_state: "Verified Search Console property, GA reference and sitemap (only when SEO applies).",
  handover_state: "Handover completed (due once Live / Completed).",
};
const TONE = { complete: "text-emerald-700", partial: "text-amber-800", missing: "text-red-700", na: "text-[#676b7a]" };

function InfoCard({ icon: Icon, label, value, sub, tone = "text-[#101a3a]", onOpen }) {
  return (
    <button type="button" onClick={onOpen}
      className="flex min-w-0 items-start gap-3 rounded-xl border border-[#e7e9ee] bg-white p-3 text-left transition-shadow hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#1f4693]">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#1f4693]/8 text-[#1f4693]"><Icon className="h-[18px] w-[18px]" aria-hidden="true" /></span>
      <span className="min-w-0">
        <span className="block text-[11.5px] font-semibold uppercase tracking-wide text-[#8a8f9c]">{label}</span>
        <span className={`block truncate text-sm font-bold ${tone}`}>{value}</span>
        {sub && <span className="block truncate text-xs text-[#676b7a]">{sub}</span>}
      </span>
    </button>
  );
}

export default function OverviewTab({ onEdit, onOpenTab }) {
  const { project, refs, reloadProject, readOnly } = useProject();
  const { canEdit } = useRole();
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const { data } = useLoad(async () => {
    const [updates, seo, activity, handover] = await Promise.all([
      listRecords("pt_updates", project.id, { orderBy: "update_date", ascending: false }),
      listRecords("pt_seo_records", project.id),
      listActivity(project.id, { page: 1, pageSize: 6 }),
      getHandover(project.id),
    ]);
    return { latest: updates[0] || null, seo: seo[0] || null, activity: activity.rows, handover };
  }, [project.id, project.updated_at, project.last_activity_at]);

  const active = (list) => (list || []).filter((r) => !r.archived_at);
  const hosting = active(refs.hosting).filter((h) => h.status === "active");
  const mainHost = hosting.find((h) => h.environment === "production") || hosting[0];
  const domains = active(refs.domains);
  const primary = domains.find((d) => d.domain_role === "primary") || domains[0];
  const emails = active(refs.emails);
  const docs = active(refs.documents).filter((d) => d.is_current !== false);
  const creds = active(refs.access);
  const credsWithPw = creds.filter((c) => c.has_password).length;
  const amc = active(refs.amc).find((c) => c.status === "active");
  const ho = data?.handover;
  const items = ho?.items || [];
  const doneItems = items.filter((i) => i.state !== "pending").length;

  async function toggleNA(key, on) {
    const set = new Set(project.not_applicable_sections || []);
    if (on) set.add(key); else set.delete(key);
    setSaving(true);
    try {
      await updateRecord("pt_projects", project.id, { not_applicable_sections: [...set] }, project.updated_at);
      toast.push("Applicability updated.");
      reloadProject();
    } catch (e) {
      toast.push(e.message, "danger");
    } finally {
      setSaving(false);
    }
  }
  const editable = canEdit && !readOnly;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
        {/* ---------------- left: project summary */}
        <Card title="Project Summary" className="xl:col-span-4" actions={editable && <Button size="sm" icon={Pencil} onClick={onEdit}>Edit</Button>}>
          <DefinitionGrid compact items={[
            { label: "Project Name", value: project.name, full: true },
            { label: "Project ID", value: project.project_code },
            { label: "Company", value: project.company_id ? <Link href={`/admin/project-tracker/companies/${project.company_id}`} className="text-[#1f4693] hover:underline">{project.company_name}</Link> : <Badge value="warning" tone="warning" label="Unassigned" /> },
            { label: "Project Type", value: project.category === "other" ? project.category_other || "Other" : labelOf(PROJECT_CATEGORY, project.category) },
            { label: "Project Status", value: <Badge value={project.status} label={labelOf(PROJECT_STATUS, project.status)} /> },
            { label: "Start Date", value: formatDate(project.start_date) },
            { label: "Completion Date", value: formatDate(project.actual_completion_date || project.expected_completion_date) + (project.actual_completion_date ? "" : project.expected_completion_date ? " (expected)" : "") },
            { label: "Responsible Person", value: project.responsible_person || "—" },
            { label: "Live URL", value: project.live_url ? <SafeLink href={project.live_url} /> : "—", full: true },
            { label: "Review URL", value: project.staging_url ? <SafeLink href={project.staging_url} /> : "—", full: true },
            { label: "Description", value: project.description || "—", full: true },
          ]} />
        </Card>

        {/* ---------------- center: key information + recent activity */}
        <div className="space-y-5 xl:col-span-5">
          <Card title="Key Information">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <InfoCard icon={Server} label="Hosting Provider" value={mainHost ? mainHost.provider : "Not recorded"} tone={mainHost ? undefined : TONE.missing}
                sub={mainHost ? `${mainHost.environment} · ${mainHost.purpose}${hosting.length > 1 ? ` · +${hosting.length - 1} more` : ""}` : undefined} onOpen={() => onOpenTab("hosting")} />
              <InfoCard icon={Globe} label="Primary Domain" value={primary ? primary.domain_name : "Not recorded"} tone={primary ? undefined : TONE.missing}
                sub={primary?.expires_on ? `expires ${formatDate(primary.expires_on)}` : undefined} onOpen={() => onOpenTab("domains")} />
              <InfoCard icon={Mail} label="Email Accounts" value={`${emails.length} account${emails.length === 1 ? "" : "s"}`} onOpen={() => onOpenTab("emails")} />
              <InfoCard icon={DatabaseBackup} label="Backup Status" value={labelOf(SECTION_STATE, project.backups_state)} tone={TONE[project.backups_state]}
                sub={project.last_backup_at ? `last ${formatDate(project.last_backup_at)}` : "no completed backup"} onOpen={() => onOpenTab("backups")} />
              <InfoCard icon={CalendarClock} label="AMC Status" value={!project.amc_applicable ? "Not applicable" : amc ? "Active" : "Missing"}
                tone={!project.amc_applicable ? TONE.na : amc ? TONE.complete : TONE.missing} sub={amc ? `until ${formatDate(amc.end_date)}` : undefined} onOpen={() => onOpenTab("amc")} />
              <InfoCard icon={SearchIcon} label="SEO Status" value={!project.seo_applicable ? "Not applicable" : data?.seo ? labelOf(SEO_STATUS, data.seo.seo_status) : "Not documented"}
                tone={!project.seo_applicable ? TONE.na : data?.seo ? undefined : TONE.missing} sub={data?.seo?.ga4_measurement_id || undefined} onOpen={() => onOpenTab("seo")} />
              <InfoCard icon={KeyRound} label="Credentials" value={`${creds.length} account${creds.length === 1 ? "" : "s"}`}
                sub={`${credsWithPw} with a stored password`} onOpen={() => onOpenTab("access")} />
              <InfoCard icon={FileText} label="Documents" value={`${docs.length} document${docs.length === 1 ? "" : "s"}`} onOpen={() => onOpenTab("documents")} />
              <InfoCard icon={ClipboardCheck} label="Handover Status" value={ho?.handover ? labelOf(HANDOVER_STATUS, ho.handover.status) : "Not started"}
                tone={ho?.handover?.status === "handed_over" ? TONE.complete : undefined} sub={ho?.handover ? `${doneItems} of ${items.length} items` : undefined} onOpen={() => onOpenTab("documents")} />
            </div>
          </Card>
          <Card title="Recent Activity" actions={<button type="button" onClick={() => onOpenTab("activity")} className="text-sm font-semibold text-[#1f4693] hover:underline">View all</button>}>
            {!data ? <Spinner /> : data.activity.length === 0 ? <p className="text-sm text-[#676b7a]">No activity yet.</p> : (
              <ol className="relative space-y-3 border-l-2 border-[#e7e9ee] pl-4">
                {data.activity.map((r) => (
                  <li key={r.id} className="relative text-sm">
                    <span aria-hidden="true" className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-[#1f4693]" />
                    <p className="text-[#2b303b]"><span className="font-semibold">{actionLabel(r.action)}</span>{entityText(r) ? ` — ${entityText(r)}` : ""}</p>
                    {detailText(r.details) && <p className="text-xs text-[#4b4f5c]">{detailText(r.details)}</p>}
                    <p className="text-xs text-[#8a8f9c]">{formatDateTime(r.created_at)}{r.actor_email ? ` · ${r.actor_email}` : ""}</p>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>

        {/* ---------------- right: handover checklist */}
        <Card title="Handover Checklist" className="xl:col-span-3"
          actions={<button type="button" onClick={() => onOpenTab("documents")} className="text-sm font-semibold text-[#1f4693] hover:underline">Open</button>}>
          {!data ? <Spinner /> : !ho?.handover ? (
            <div className="text-sm text-[#676b7a]">
              <p>No handover started yet.</p>
              <button type="button" onClick={() => onOpenTab("documents")} className="mt-2 font-semibold text-[#1f4693] hover:underline">Go to Documents &amp; Handover</button>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between gap-2">
                <Badge value={ho.handover.status} label={labelOf(HANDOVER_STATUS, ho.handover.status)} />
                <span className="text-sm font-semibold tabular-nums text-[#2b303b]">{doneItems} / {items.length} completed</span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-[#eef0f4]" role="progressbar" aria-valuemin={0} aria-valuemax={items.length} aria-valuenow={doneItems} aria-label="Handover checklist progress">
                <div className="h-full rounded-full bg-emerald-500" style={{ width: `${items.length ? (100 * doneItems) / items.length : 0}%` }} />
              </div>
              <ul className="mt-3 space-y-1.5">
                {items.map((it) => {
                  const Icon = it.state === "done" ? CheckCircle2 : it.state === "not_applicable" ? MinusCircle : Circle;
                  return (
                    <li key={it.id} className="flex items-start gap-2 text-[13px]">
                      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${it.state === "done" ? "text-emerald-600" : it.state === "not_applicable" ? "text-[#8a8f9c]" : "text-[#c4c8d0]"}`} aria-hidden="true" />
                      <span className={it.state === "pending" ? "text-[#676b7a]" : "text-[#2b303b]"}>
                        {labelOf(HANDOVER_ITEMS, it.item_key)}
                        <span className="sr-only"> — {it.state === "done" ? "done" : it.state === "not_applicable" ? "not applicable" : "pending"}</span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </Card>
      </div>

      {/* ---------------- second row: existing details kept */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          <Card title="Latest update">
            {!data ? <Spinner /> : data.latest ? (
              <div>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <Badge value="info" tone="info" label={labelOf(UPDATE_TYPE, data.latest.update_type)} />
                  <span className="font-semibold text-[#2b303b]">{formatDate(data.latest.update_date)}</span>
                  <span className="text-[#676b7a]">by {data.latest.updated_by_name}</span>
                  {data.latest.version && <span className="text-[#676b7a]">· {data.latest.version}</span>}
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm text-[#2b303b]">{data.latest.description}</p>
                {data.latest.next_action && <p className="mt-2 text-sm text-[#4b4f5c]"><span className="font-semibold">Next action:</span> {data.latest.next_action}</p>}
              </div>
            ) : <p className="text-sm text-[#676b7a]">No updates logged yet. Add one under Updates &amp; Maintenance.</p>}
          </Card>
          <Card title="More project details">
            <DefinitionGrid items={[
              { label: "Serial Number", value: project.serial_no },
              { label: "Priority", value: <Badge value={project.priority} label={labelOf(PRIORITY, project.priority)} /> },
              { label: "Development progress", value: <ProgressBar value={project.progress} /> },
              { label: "Developed by Zyllo Tech", value: project.developed_by_zyllo ? "Yes" : `No — ${project.original_developer || "vendor not recorded"}` },
              { label: "Expected completion", value: formatDate(project.expected_completion_date) },
              { label: "Created", value: `${formatDateTime(project.created_at)}${project.created_by_email ? ` by ${project.created_by_email}` : ""}` },
              { label: "Last updated", value: `${formatDateTime(project.last_activity_at || project.updated_at)}${project.last_activity_by || project.updated_by_email ? ` by ${project.last_activity_by || project.updated_by_email}` : ""}` },
              { label: "Scope", value: project.scope, full: true },
              { label: "Remarks", value: project.remarks, full: true },
            ]} />
          </Card>
        </div>
        <div className="space-y-5">
          <Card title="Documentation completeness">
            <div className="mb-3 flex items-center justify-between gap-2">
              <CompletenessPill label={project.completeness_label} score={project.completeness_score} />
              <span className="text-xs text-[#676b7a]">{project.applicable_sections} applicable sections</span>
            </div>
            <p className="mb-3 text-xs text-[#676b7a]">How well the project is <strong>documented</strong> — separate from development progress ({project.progress}%). Not-applicable sections are not counted.</p>
            <ul className="space-y-1.5">
              {SECTION_ROWS.map(([key, label, tab]) => (
                <li key={key} className="flex items-start justify-between gap-2 text-sm">
                  <button type="button" onClick={() => onOpenTab(tab)} className="text-left text-[#1f4693] hover:underline" title={SECTION_RULES[key]}>{label}</button>
                  <Badge value={project[key]} label={labelOf(SECTION_STATE, project[key])} />
                </li>
              ))}
            </ul>
            <details className="mt-3 text-xs text-[#676b7a]">
              <summary className="cursor-pointer font-semibold">How each section is scored</summary>
              <ul className="mt-2 list-disc space-y-1 pl-4">
                {SECTION_ROWS.map(([key, label]) => <li key={key}><strong>{label}:</strong> {SECTION_RULES[key]}</li>)}
                <li><strong>Missing Critical Information:</strong> overview missing, or a Live/Maintenance/Completed project missing hosting, domain, admin access or backups.</li>
              </ul>
            </details>
          </Card>
          <Card title="Applicable sections">
            <p className="mb-2 text-xs text-[#676b7a]">Tick a section if it does not apply (e.g. a mobile app without a domain). AMC and SEO applicability are set in their own tabs.</p>
            <div className="grid grid-cols-1 gap-1">
              {NA_SECTIONS.map((s) => (
                <Checkbox key={s.value} label={`${s.label} — not applicable`} checked={(project.not_applicable_sections || []).includes(s.value)}
                  disabled={!editable || saving} onChange={(on) => toggleNA(s.value, on)} />
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
