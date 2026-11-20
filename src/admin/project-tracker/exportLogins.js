import { CREDENTIAL_CATEGORIES, exportCredentialPasswords, repositoryUrl } from "@/lib/api/admin/projectTrackerProject";
import { buildLoginsWorkbook } from "./loginsWorkbook";

// Excel download of logins — one row per login, every detail in the same line.
// Passwords are included (owner's choice); the database requires a recent sign-in
// and logs every exported password.

const typeLabel = (v) => CREDENTIAL_CATEGORIES.find((c) => c.value === v)?.label ?? v ?? "";

function safeFilePart(text) {
  return (
    String(text ?? "")
      .normalize("NFKD")
      .replace(/[^\w-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "logins"
  );
}

export function loginsFileName(...parts) {
  const stamp = new Date().toISOString().slice(0, 10);
  return `logins-${parts.filter(Boolean).map(safeFilePart).join("-")}-${stamp}.xlsx`;
}

/**
 * items: [{ cred, company, project_code, project, live_url }]
 * Returns { status: "success", count, withPasswords } | { status: "reauth" } | { status: "error", message }.
 */
export async function downloadLoginsExcel({ items, fileName, title, exportedBy }) {
  if (!items.length) return { status: "error", message: "There are no logins to download." };

  const ids = items.filter((i) => i.cred.has_password).map((i) => i.cred.id);
  const pw = await exportCredentialPasswords(ids);
  if (pw.status !== "success") return pw;

  const rows = items.map(({ cred: c, ...ctx }) => ({
    ...ctx,
    type: typeLabel(c.category),
    service: c.service,
    account: c.account,
    email: c.email,
    password: c.has_password ? pw.passwords.get(c.id) ?? "(could not read)" : "",
    repository: c.repository,
    repository_url: repositoryUrl(c.service, c.repository),
    login_url: c.login_url,
    purpose: c.purpose,
    two_factor: c.two_factor,
    notes: c.notes,
    password_updated_at: c.password_updated_at ? new Date(c.password_updated_at).toLocaleDateString("en-IN") : "",
  }));

  const ExcelJS = (await import("exceljs")).default;
  const wb = buildLoginsWorkbook(ExcelJS, { rows, title, exportedBy });
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);

  return { status: "success", count: items.length, withPasswords: pw.passwords.size };
}
