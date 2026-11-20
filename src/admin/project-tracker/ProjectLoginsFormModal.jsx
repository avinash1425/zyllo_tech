import { useState } from "react";
import { CheckCircle2, Cloud, Database, GitBranch, Globe, KeyRound, Lock, Mail } from "lucide-react";
import { PLATFORMS, createCredential, updateProjectLiveUrl } from "@/lib/api/admin/projectTrackerProject";
import { ChoiceChips, Field, Modal, PasswordInput } from "./ui";
import { BTN_PRIMARY, BTN_SECONDARY, inputClass } from "./styles";

const OTHER = "__other__";

// Every section of the form. Each filled-in section becomes one login entry.
const SECTIONS = [
  {
    key: "email",
    category: "email",
    title: "Email account",
    hint: "Gmail or other mailbox used for this project",
    icon: Mail,
    platformLabel: "Email provider",
    platforms: PLATFORMS.email,
    fields: [{ name: "account", label: "Email address", type: "email", placeholder: "project@gmail.com", required: true }],
  },
  {
    key: "hosting",
    category: "hosting",
    title: "Hosting",
    hint: "Where the site / app is hosted",
    icon: Cloud,
    platformLabel: "Hosting platform",
    platforms: PLATFORMS.hosting,
    fields: [
      { name: "account", label: "Login email / username", placeholder: "Email or username for the hosting account", required: true },
      { name: "login_url", label: "Hosting login URL", type: "url", placeholder: "https:// (optional)" },
    ],
  },
  {
    key: "code",
    category: "code_repo",
    title: "GitHub / code repository",
    hint: "Account and repository that hold the code",
    icon: GitBranch,
    platformLabel: "Platform",
    platforms: PLATFORMS.code_repo,
    fields: [
      { name: "account", label: "GitHub account (username)", placeholder: "e.g. zyllotech-dev" },
      { name: "repository", label: "Repository", placeholder: "owner/repo or https://github.com/owner/repo" },
      { name: "email", label: "Account email", type: "email", placeholder: "Email the GitHub account uses" },
    ],
    requireOneOf: ["account", "repository"],
    requireMessage: "Enter the GitHub account or the repository.",
  },
  {
    key: "database",
    category: "database",
    title: "Database",
    hint: "Supabase or other database",
    icon: Database,
    platformLabel: "Database platform",
    platforms: PLATFORMS.database,
    fields: [
      { name: "account", label: "Login email / username", placeholder: "Email or username to sign in", required: true },
      { name: "login_url", label: "Project / dashboard URL", type: "url", placeholder: "https://supabase.com/dashboard/project/… (optional)" },
    ],
  },
  {
    key: "admin",
    category: "admin_login",
    title: "Project admin login",
    hint: "The admin panel of the website / app you built",
    icon: KeyRound,
    service: "Admin panel",
    fields: [
      { name: "login_url", label: "Admin login URL", type: "url", placeholder: "https://yoursite.com/admin" },
      { name: "account", label: "Admin email / username", placeholder: "admin@client.com", required: true },
    ],
  },
];

const emptySection = (s) => ({
  platform: s.platforms ? s.platforms[0] : "",
  platformOther: "",
  account: "",
  email: "",
  repository: "",
  login_url: "",
  password: "",
});

const isFilled = (s, v) => s.fields.some((f) => v[f.name].trim()) || v.password !== "";

export default function ProjectLoginsFormModal({ project, onClose, onSaved }) {
  const [liveUrl, setLiveUrl] = useState(project.live_url ?? "");
  const [values, setValues] = useState(() => Object.fromEntries(SECTIONS.map((s) => [s.key, emptySection(s)])));
  const [errors, setErrors] = useState({});
  const [done, setDone] = useState({}); // sections already saved (after a partial failure)
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  function set(sectionKey, name, value) {
    setValues((v) => ({ ...v, [sectionKey]: { ...v[sectionKey], [name]: value } }));
    const key = `${sectionKey}.${name}`;
    if (errors[key] || errors[`${sectionKey}.section`]) {
      setErrors((e) => ({ ...e, [key]: undefined, [`${sectionKey}.section`]: undefined }));
    }
  }

  function serviceOf(s, v) {
    if (s.service) return s.service;
    return v.platform === OTHER ? v.platformOther.trim() : v.platform;
  }

  function validate() {
    const errs = {};
    const url = liveUrl.trim();
    if (url && !/^https?:\/\/\S+$/i.test(url)) errs.liveUrl = "Must start with http:// or https://";
    for (const s of SECTIONS) {
      const v = values[s.key];
      if (done[s.key] || !isFilled(s, v)) continue;
      if (s.platforms && v.platform === OTHER && !v.platformOther.trim()) errs[`${s.key}.platformOther`] = "Type the platform name.";
      for (const f of s.fields) {
        const val = v[f.name].trim();
        if (f.required && !val) errs[`${s.key}.${f.name}`] = `${f.label} is required.`;
        if (val && f.type === "email" && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(val)) errs[`${s.key}.${f.name}`] = "Enter a valid email address.";
        if (val && f.type === "url" && !/^https?:\/\/\S+$/i.test(val)) errs[`${s.key}.${f.name}`] = "Must start with http:// or https://";
        if (val && f.name === "repository" && /\s/.test(val)) errs[`${s.key}.${f.name}`] = "Use owner/repo or the repository link.";
      }
      if (s.requireOneOf && !s.requireOneOf.some((n) => v[n].trim())) errs[`${s.key}.section`] = s.requireMessage;
    }
    return errs;
  }

  async function onSubmit(e) {
    e.preventDefault();
    setMessage("");
    const errs = validate();
    setErrors(errs);
    if (Object.keys(errs).length) {
      setMessage("Please fix the highlighted fields.");
      return;
    }

    const toSave = SECTIONS.filter((s) => !done[s.key] && isFilled(s, values[s.key]));
    const liveChanged = liveUrl.trim() !== (project.live_url ?? "");
    if (!toSave.length && !liveChanged) {
      setMessage("Fill in at least one section (or the live site URL).");
      return;
    }

    setSaving(true);
    const problems = [];
    const newlyDone = {};
    let created = 0;

    if (liveChanged) {
      const r = await updateProjectLiveUrl(project.id, liveUrl);
      if (r.status !== "success") problems.push(`Live site URL: ${r.message}`);
    }

    for (const s of toSave) {
      const v = values[s.key];
      const result = await createCredential(project.id, {
        category: s.category,
        service: serviceOf(s, v),
        account: v.account,
        email: v.email,
        repository: v.repository,
        login_url: v.login_url,
        password: v.password,
      });
      if (result.status === "success") {
        created += 1;
        newlyDone[s.key] = true;
      } else if (result.status === "partial") {
        created += 1;
        newlyDone[s.key] = true;
        problems.push(`${s.title}: ${result.message}`);
      } else {
        problems.push(`${s.title}: ${result.message}`);
      }
    }
    setSaving(false);

    // Never keep typed passwords around once their section is saved.
    setValues((prev) => {
      const next = { ...prev };
      for (const key of Object.keys(newlyDone)) next[key] = { ...next[key], password: "" };
      return next;
    });
    setDone((d) => ({ ...d, ...newlyDone }));

    const summary = `${created} login${created === 1 ? "" : "s"} saved${liveChanged && !problems.some((p) => p.startsWith("Live")) ? ", live site URL updated" : ""}.`;
    if (!problems.length) {
      onSaved(summary);
      return;
    }
    setMessage(`${summary} Not saved: ${problems.join(" · ")} — fix and press Save again (saved sections are skipped).`);
    onSaved(null, { keepOpen: true });
  }

  return (
    <Modal title="Add project logins" titleId="pt-logins-dialog-title" onClose={onClose} size="max-w-3xl">
      <form onSubmit={onSubmit} noValidate autoComplete="off" className="flex flex-col gap-5">
        <p className="flex items-start gap-2 rounded-lg bg-[#f6f7fb] px-3.5 py-2.5 text-xs text-[#676b7a]">
          <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          Fill in only the sections you have — empty sections are skipped. Each filled section is saved as its own login,
          and every password is stored encrypted.
        </p>

        <section className="rounded-xl border border-[#e7e9ee] p-4">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-[#2b303b]">
            <Globe className="h-4 w-4 text-[#1f4693]" aria-hidden="true" />
            Live site / domain
          </h3>
          <Field id="pt-logins-live" label="Live site or project domain URL" error={errors.liveUrl}>
            <input
              id="pt-logins-live"
              type="url"
              value={liveUrl}
              autoFocus
              onChange={(e) => {
                setLiveUrl(e.target.value);
                if (errors.liveUrl) setErrors((er) => ({ ...er, liveUrl: undefined }));
              }}
              placeholder="https://clientsite.com"
              className={inputClass(errors.liveUrl)}
            />
          </Field>
          <p className="mt-1 text-xs text-[#9aa0ad]">Saved as the project&apos;s Live URL (shown on the dashboard).</p>
        </section>

        {SECTIONS.map((s) => {
          const v = values[s.key];
          const Icon = s.icon;
          const saved = done[s.key];
          const err = (name) => errors[`${s.key}.${name}`];
          return (
            <section
              key={s.key}
              className={`rounded-xl border p-4 ${saved ? "border-emerald-200 bg-emerald-50/40" : isFilled(s, v) ? "border-[#f7941e]/50" : "border-[#e7e9ee]"}`}
            >
              <h3 className="flex items-center gap-2 text-sm font-bold text-[#2b303b]">
                <Icon className="h-4 w-4 text-[#1f4693]" aria-hidden="true" />
                {s.title}
                {saved && (
                  <span className="ml-auto inline-flex items-center gap-1 text-xs font-semibold text-emerald-700">
                    <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> Saved
                  </span>
                )}
              </h3>
              <p className="mb-3 text-xs text-[#9aa0ad]">{s.hint}</p>
              {errors[`${s.key}.section`] && <p className="mb-2 text-xs text-red-600">{errors[`${s.key}.section`]}</p>}

              <fieldset disabled={saved} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {s.platforms && (
                  <>
                    <div className="sm:col-span-2">
                      <ChoiceChips
                        id={`pt-logins-${s.key}-platform`}
                        label={s.platformLabel}
                        size="sm"
                        value={v.platform}
                        onChange={(p) => set(s.key, "platform", p)}
                        options={[...s.platforms.map((p) => ({ value: p, label: p })), { value: OTHER, label: "Other…" }]}
                      />
                    </div>
                    {v.platform === OTHER && (
                      <Field id={`pt-logins-${s.key}-other`} label="Platform name" error={err("platformOther")} className="sm:col-span-2">
                        <input
                          id={`pt-logins-${s.key}-other`}
                          value={v.platformOther}
                          autoFocus
                          onChange={(e) => set(s.key, "platformOther", e.target.value)}
                          placeholder="Type the platform name"
                          className={inputClass(err("platformOther"))}
                        />
                      </Field>
                    )}
                  </>
                )}
                {s.fields.map((f) => (
                  <Field key={f.name} id={`pt-logins-${s.key}-${f.name}`} label={f.label} error={err(f.name)}>
                    <input
                      id={`pt-logins-${s.key}-${f.name}`}
                      type={f.type || "text"}
                      value={v[f.name]}
                      placeholder={f.placeholder}
                      autoComplete="off"
                      spellCheck={false}
                      onChange={(e) => set(s.key, f.name, e.target.value)}
                      aria-invalid={err(f.name) ? "true" : undefined}
                      aria-describedby={err(f.name) ? `pt-logins-${s.key}-${f.name}-error` : undefined}
                      className={inputClass(err(f.name))}
                    />
                  </Field>
                ))}
                <Field id={`pt-logins-${s.key}-password`} label="Password">
                  <PasswordInput
                    id={`pt-logins-${s.key}-password`}
                    value={v.password}
                    onChange={(val) => set(s.key, "password", val)}
                    placeholder={saved ? "Saved (encrypted)" : "Saved encrypted"}
                  />
                </Field>
              </fieldset>
            </section>
          );
        })}

        {message && (
          <p role="alert" className="rounded-lg bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
            {message}
          </p>
        )}
        <div className="sticky -bottom-6 z-10 -mx-6 -mb-6 flex justify-end gap-3 rounded-b-2xl border-t border-[#e7e9ee] bg-white px-6 py-4">
          <button type="button" onClick={onClose} className={BTN_SECONDARY}>
            {Object.keys(done).length ? "Close" : "Cancel"}
          </button>
          <button type="submit" disabled={saving} className={BTN_PRIMARY}>
            {saving ? "Saving…" : "Save all"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
