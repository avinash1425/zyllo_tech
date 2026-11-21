import { useState } from "react";
import {
  PROJECT_HEALTH,
  PROJECT_PRIORITIES,
  PROJECT_STATUSES,
  createProject,
  updateProject,
} from "@/lib/api/admin/projectTracker";
import { ChoiceChips, Field, FormMessage, Modal } from "./ui";
import { BTN_PRIMARY, BTN_SECONDARY, PROGRESS_STEPS, inputClass, progressStyle, snapProgress } from "./styles";

const EMPTY = {
  name: "",
  project_type: "",
  status: "planning",
  progress: "0",
  project_manager: "",
  priority: "medium",
  health: "",
  start_date: "",
  end_date: "",
  live_url: "",
  repo_source: "",
  next_action: "",
  description: "",
  notes: "",
};

function toForm(project) {
  const form = { ...EMPTY };
  for (const key of Object.keys(EMPTY)) if (project?.[key] != null) form[key] = String(project[key]);
  // Only an existing project has an editable Project ID; new ones get it automatically.
  if (project?.id) form.project_code = project.project_code ?? "";
  return form;
}

/** Add (project = null) or edit a project of one company. */
export default function ProjectFormModal({ companyId, companyName, project, onClose, onSaved }) {
  const editing = Boolean(project?.id);
  const [form, setForm] = useState(() => toForm(project));
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  function set(name, value) {
    setForm((f) => ({ ...f, [name]: value }));
    if (errors[name]) setErrors((e) => ({ ...e, [name]: undefined }));
  }

  async function onSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setMessage("");
    const result = editing ? await updateProject(project.id, form) : await createProject(companyId, form);
    setSaving(false);
    if (result.status === "success") return onSaved(editing ? "Project updated." : "Project added.");
    setErrors(result.errors ?? {});
    setMessage(result.message ?? "Could not save the project.");
  }

  const progress = snapProgress(form.progress);
  const progressLook = progressStyle(progress);
  const fid = (name) => `pt-project-${name}`;
  const a11y = (name) => ({
    id: fid(name),
    "aria-invalid": errors[name] ? "true" : undefined,
    "aria-describedby": errors[name] ? `${fid(name)}-error` : undefined,
  });
  const text = (name, label, props = {}) => (
    <Field id={fid(name)} label={label} error={errors[name]} required={props.required} className={props.className}>
      <input
        {...a11y(name)}
        type={props.type || "text"}
        autoFocus={props.autoFocus}
        placeholder={props.placeholder}
        value={form[name]}
        onChange={(e) => set(name, e.target.value)}
        className={inputClass(errors[name])}
      />
    </Field>
  );
  const select = (name, label, options, { allowEmpty } = {}) => (
    <ChoiceChips
      id={fid(name)}
      label={label}
      options={options}
      value={form[name]}
      onChange={(v) => set(name, v)}
      allowEmpty={allowEmpty}
      error={errors[name]}
      size="sm"
    />
  );

  const divider = (label) => (
    <div className="flex items-center gap-3 sm:col-span-2">
      <span className="whitespace-nowrap text-[10px] font-bold uppercase tracking-widest text-[#b0b8cc]">{label}</span>
      <div className="h-px flex-1 bg-[#eef2fb]" />
    </div>
  );

  return (
    <Modal
      title={editing ? `Edit project ${project.project_code ?? ""}`.trim() : `Add project${companyName ? ` for ${companyName}` : ""}`}
      titleId="pt-project-dialog-title"
      onClose={onClose}
      size="max-w-3xl"
    >
      <form onSubmit={onSubmit} noValidate className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {editing ? (
          <Field id={fid("project_code")} label="Project ID" required error={errors.project_code}>
            <input
              {...a11y("project_code")}
              value={form.project_code}
              onChange={(e) => set("project_code", e.target.value.toUpperCase())}
              maxLength={30}
              spellCheck={false}
              className={`${inputClass(errors.project_code)} font-mono`}
            />
            {!errors.project_code && (
              <p className="mt-1 text-xs text-[#676b7a]">Generated automatically — change it only if you need to.</p>
            )}
          </Field>
        ) : (
          <div className="flex items-start gap-3 rounded-xl border border-[#dce6f7] bg-[#f0f4ff] px-4 py-3 sm:col-span-2">
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#1f4693]/15 text-[11px] font-black text-[#1f4693]">#</span>
            <p className="text-xs text-[#4a5880]">
              The <span className="font-bold text-[#1f4693]">Project ID</span> (ZT-001, ZT-002…) is assigned automatically when you save.
            </p>
          </div>
        )}
        {editing && <div className="hidden sm:block" />}
        {text("name", "Project name", { required: true, autoFocus: !editing, className: "sm:col-span-2" })}

        {divider("Details")}
        {text("project_type", "Type", { placeholder: "e.g. Website, ERP / Web App, Zoho App" })}
        {text("project_manager", "Project manager")}

        {divider("Status & progress")}
        {select("status", "Status", PROJECT_STATUSES)}
        <Field id={fid("progress")} label="Progress" error={errors.progress}>
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <input
                {...a11y("progress")}
                type="range"
                min="0"
                max="100"
                step="25"
                value={progress}
                onChange={(e) => set("progress", String(snapProgress(e.target.value)))}
                aria-valuetext={`${progress}% – ${progressLook.label}`}
                style={{ accentColor: progressLook.color }}
                className="w-full cursor-pointer"
              />
              <div className="mt-0.5 flex justify-between px-0.5">
                {PROGRESS_STEPS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => set("progress", String(s))}
                    aria-label={`Set progress to ${s}%`}
                    className={`text-[11px] tabular-nums ${s === progress ? "font-bold" : "text-[#9aa0ad] hover:text-[#2b303b]"}`}
                    style={s === progress ? { color: progressLook.color } : undefined}
                  >
                    {s}%
                  </button>
                ))}
              </div>
            </div>
            <span
              className="w-24 shrink-0 rounded-lg px-2 py-1.5 text-center text-white"
              style={{ backgroundColor: progressLook.color }}
            >
              <span className="block text-base font-bold leading-tight tabular-nums">{progress}%</span>
              <span className="block text-[10px] font-medium leading-tight opacity-90">{progressLook.label}</span>
            </span>
          </div>
        </Field>

        {select("priority", "Priority", PROJECT_PRIORITIES)}
        {select("health", "Health", PROJECT_HEALTH, { allowEmpty: true })}

        {divider("Timeline")}
        {text("start_date", "Start date", { type: "date" })}
        {text("end_date", "Target date", { type: "date" })}

        {divider("Links")}
        {text("live_url", "Live URL", { type: "url", placeholder: "https://" })}
        {text("repo_source", "Repo / Source", { placeholder: "e.g. GitHub owner/repo, Supabase, Zoho Creator" })}

        {divider("Notes")}
        {text("next_action", "Next action", { className: "sm:col-span-2" })}

        <Field id={fid("description")} label="Description" error={errors.description} className="sm:col-span-2">
          <textarea
            {...a11y("description")}
            rows={2}
            value={form.description}
            onChange={(e) => set("description", e.target.value)}
            className={`${inputClass(errors.description)} resize-none`}
          />
        </Field>
        <Field id={fid("notes")} label="Notes" error={errors.notes} className="sm:col-span-2">
          <textarea
            {...a11y("notes")}
            rows={2}
            value={form.notes}
            onChange={(e) => set("notes", e.target.value)}
            className={`${inputClass(errors.notes)} resize-none`}
          />
        </Field>

        <FormMessage message={message} />

        <div className="flex justify-end gap-3 border-t border-[#f0f4ff] pt-4 sm:col-span-2">
          <button type="button" onClick={onClose} className={BTN_SECONDARY}>
            Cancel
          </button>
          <button type="submit" disabled={saving} className={BTN_PRIMARY}>
            {saving ? "Saving…" : editing ? "Save changes" : "Add project"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
