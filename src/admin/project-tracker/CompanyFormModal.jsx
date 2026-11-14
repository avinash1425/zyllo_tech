import { Modal, useToast } from "./ui";
import RecordForm from "./RecordForm";
import { COMPANY_FIELDS } from "./lib/sections";
import { createCompany, updateRecord } from "@/lib/api/admin/projectTracker";

/** Create (company = null) or edit a company. */
export default function CompanyFormModal({ company, onClose, onSaved }) {
  const toast = useToast();
  const editing = Boolean(company);

  async function submit(payload) {
    if (editing) {
      if (Object.keys(payload).length === 0) { onClose(); return; }
      await updateRecord("pt_companies", company.id, payload, company.updated_at);
      toast.push("Company updated.");
      onSaved?.(company);
    } else {
      const created = await createCompany(payload);
      toast.push(`Company added (${created.company_number}).`);
      onSaved?.(created);
    }
    onClose();
  }

  return (
    <Modal title={editing ? `Edit company ${company.company_number}` : "Add company"} onClose={onClose} size="lg">
      <RecordForm fields={COMPANY_FIELDS} record={company || null} onSubmit={submit} onCancel={onClose}
        submitLabel={editing ? "Save changes" : "Add company"} />
    </Modal>
  );
}
