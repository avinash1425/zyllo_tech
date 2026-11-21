import { useEffect, useRef, useState } from "react";
import { ImagePlus, Trash2 } from "lucide-react";
import { createCompany, updateCompany, validateLogo } from "@/lib/api/admin/projectTracker";
import CountrySelect from "./CountrySelect";
import { ChoiceChips, CompanyLogo, Field, FormMessage, Modal } from "./ui";
import { BTN_PRIMARY, BTN_SECONDARY, inputClass } from "./styles";

const EMPTY = {
  name: "",
  industry: "",
  contact_person: "",
  email: "",
  phone: "",
  address: "",
  country: "India",
  status: "active",
};

function toForm(company) {
  const form = { ...EMPTY };
  for (const key of Object.keys(EMPTY)) if (company?.[key] != null) form[key] = String(company[key]);
  return form;
}

/** Add (company = null) or edit a client company, including its logo. */
export default function CompanyFormModal({ company, onClose, onSaved }) {
  const editing = Boolean(company?.id);
  const [form, setForm] = useState(() => toForm(company));
  // undefined = keep current logo, File = new logo, null = remove logo
  const [logo, setLogo] = useState(undefined);
  const [preview, setPreview] = useState(null);
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const fileRef = useRef(null);

  // Free the previous preview's object URL whenever it changes or the dialog closes.
  useEffect(() => () => preview && URL.revokeObjectURL(preview), [preview]);

  function chooseLogo(next) {
    setLogo(next);
    setPreview(next instanceof File ? URL.createObjectURL(next) : null);
  }

  function set(name, value) {
    setForm((f) => ({ ...f, [name]: value }));
    if (errors[name]) setErrors((e) => ({ ...e, [name]: undefined }));
  }

  async function onPickLogo(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const problem = await validateLogo(file);
    setErrors((er) => ({ ...er, logo: problem || undefined }));
    if (!problem) chooseLogo(file);
  }

  async function onSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setMessage("");
    const result = editing
      ? await updateCompany(company.id, form, logo, company.logo_path)
      : await createCompany(form, logo instanceof File ? logo : null);
    setSaving(false);
    if (result.status === "success") return onSaved(editing ? "Client updated." : "Client added.", "success");
    if (result.status === "partial") return onSaved(result.message, "warning");
    setErrors(result.errors ?? {});
    setMessage(result.message ?? "Could not save the client.");
  }

  const shownUrl = logo instanceof File ? preview : logo === null ? null : company?.logo_url;
  const hasLogo = Boolean(shownUrl);
  const textField = (name, label, props = {}) => (
    <Field id={`pt-company-${name}`} label={label} error={errors[name]} required={props.required} className={props.className}>
      <input
        id={`pt-company-${name}`}
        type={props.type || "text"}
        autoFocus={name === "name"}
        value={form[name]}
        placeholder={props.placeholder}
        onChange={(e) => set(name, e.target.value)}
        aria-invalid={errors[name] ? "true" : undefined}
        aria-describedby={errors[name] ? `pt-company-${name}-error` : undefined}
        className={inputClass(errors[name])}
      />
    </Field>
  );

  return (
    <Modal title={editing ? "Edit client" : "Add client"} titleId="pt-company-dialog-title" onClose={onClose}>
      <form onSubmit={onSubmit} noValidate className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <p className="mb-1.5 text-xs font-semibold text-[#2b303b]">Logo</p>
          <div className="flex items-center gap-4">
            <CompanyLogo name={form.name || "?"} url={shownUrl} className="h-20 w-20 border border-[#e7e9ee]" />
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => fileRef.current?.click()} className={BTN_SECONDARY}>
                <ImagePlus className="h-4 w-4" aria-hidden="true" />
                {hasLogo ? "Change logo" : "Upload logo"}
              </button>
              {hasLogo && (
                <button
                  type="button"
                  onClick={() => chooseLogo(company?.logo_path ? null : undefined)}
                  className={`${BTN_SECONDARY} text-red-600`}
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                  Remove
                </button>
              )}
              <p className="w-full text-xs text-[#676b7a]">PNG, JPG or WEBP, up to 2 MB.</p>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={onPickLogo}
              className="hidden"
              aria-label="Client logo file"
            />
          </div>
          {errors.logo && <p className="mt-1 text-xs text-red-600">{errors.logo}</p>}
        </div>

        {textField("name", "Client name", { required: true, className: "sm:col-span-2" })}
        {textField("industry", "Industry", { placeholder: "e.g. Healthcare" })}
        {textField("contact_person", "Contact person")}
        {textField("email", "Email", { type: "email" })}
        {textField("phone", "Phone", { type: "tel" })}
        {textField("address", "Address", { className: "sm:col-span-2" })}

        <Field id="pt-company-country" label="Country" error={errors.country}>
          <CountrySelect
            id="pt-company-country"
            value={form.country}
            onChange={(v) => set("country", v)}
            invalid={Boolean(errors.country)}
          />
        </Field>
        <ChoiceChips
          id="pt-company-status"
          label="Status"
          value={form.status}
          onChange={(v) => set("status", v)}
          options={[
            { value: "active", label: "Active" },
            { value: "inactive", label: "Inactive" },
          ]}
        />

        <FormMessage message={message} />

        <div className="flex justify-end gap-3 sm:col-span-2">
          <button type="button" onClick={onClose} className={BTN_SECONDARY}>
            Cancel
          </button>
          <button type="submit" disabled={saving} className={BTN_PRIMARY}>
            {saving ? "Saving…" : editing ? "Save changes" : "Add client"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
