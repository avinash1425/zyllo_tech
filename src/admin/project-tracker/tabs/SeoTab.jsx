import { useState } from "react";
import RecordSection from "../RecordSection";
import { Banner, Card, Checkbox, useToast } from "../ui";
import { useProject, useRole } from "../context";
import { updateRecord } from "@/lib/api/admin/projectTracker";
import { formatDate } from "../lib/format";

export default function SeoTab() {
  const { project, readOnly, reloadProject, refs } = useProject();
  const { canEdit } = useRole();
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const audits = (refs.documents || []).filter((d) => d.category === "seo_audit");

  async function setApplicable(on) {
    setSaving(true);
    try {
      await updateRecord("pt_projects", project.id, { seo_applicable: on }, project.updated_at);
      toast.push(on ? "SEO marked applicable." : "SEO marked not applicable.");
      await reloadProject();
    } catch (e) {
      toast.push(e.message, "danger");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <Banner tone="info" title="Documentation only">
        This section records how SEO and analytics are set up for this project. It does not connect to Google, request credentials, or change
        any website's analytics or Search Console configuration.
      </Banner>
      <Card title="SEO applicability">
        <Checkbox label="SEO applies to this project" checked={project.seo_applicable} disabled={!canEdit || readOnly || saving} onChange={setApplicable}
          help="When not applicable, SEO is left out of the documentation completeness score." />
      </Card>
      <RecordSection sectionKey="seo" maxActive={1} description="One active SEO record per project. Archive it to start a fresh one (the old record stays as history)." />
      <Card title="SEO audit documents">
        {audits.length === 0 ? (
          <p className="text-sm text-[#676b7a]">No SEO audit documents yet. Upload them in Documents &amp; Handover with category “SEO Audit”.</p>
        ) : (
          <ul className="divide-y divide-[#eef0f4] text-sm">
            {audits.map((d) => (
              <li key={d.id} className="flex justify-between gap-2 py-2">
                <span className="font-medium">{d.name}{d.version ? ` · v${d.version}` : ""}</span>
                <span className="text-[#676b7a]">{formatDate(d.created_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
