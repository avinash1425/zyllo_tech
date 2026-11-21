// Builds the logins Excel workbook. No app imports, so it can be tested on its own.
// rows: [{ company, project_code, project, live_url, type, service, account, email, password,
//          repository, repository_url, login_url, purpose, two_factor, notes, password_updated_at }]

export const LOGIN_COLUMNS = [
  { header: "No.", key: "no", width: 6 },
  { header: "Company", key: "company", width: 24 },
  { header: "Project ID", key: "project_code", width: 12 },
  { header: "Project", key: "project", width: 26 },
  { header: "Live site", key: "live_url", width: 30 },
  { header: "Type", key: "type", width: 18 },
  { header: "Platform / service", key: "service", width: 20 },
  { header: "Account / username", key: "account", width: 28 },
  { header: "Email", key: "email", width: 28 },
  { header: "Password", key: "password", width: 22 },
  { header: "Repository", key: "repository", width: 32 },
  { header: "Login URL", key: "login_url", width: 32 },
  { header: "Used for", key: "purpose", width: 28 },
  { header: "2FA", key: "two_factor", width: 6 },
  { header: "Notes", key: "notes", width: 36 },
  { header: "Password last changed", key: "password_updated_at", width: 20 },
];

export const HEADER_ROW = 4;
const isHttp = (v) => /^https?:\/\/\S+$/i.test(v ?? "");

export function buildLoginsWorkbook(ExcelJS, { rows, title, exportedBy, now = new Date() }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Zyllo Tech Project Tracker";
  wb.created = now;
  const ws = wb.addWorksheet("Logins", { views: [{ state: "frozen", ySplit: HEADER_ROW }] });
  ws.columns = LOGIN_COLUMNS.map(({ key, width }) => ({ key, width }));
  const lastCol = LOGIN_COLUMNS.length;

  ws.mergeCells(1, 1, 1, lastCol);
  const warn = ws.getCell(1, 1);
  warn.value = "CONFIDENTIAL — this file contains passwords. Do not share or email it; delete it when no longer needed.";
  warn.font = { bold: true, color: { argb: "FFB91C1C" }, size: 12 };
  warn.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEE2E2" } };
  ws.mergeCells(2, 1, 2, lastCol);
  const sub = ws.getCell(2, 1);
  sub.value = `${title} — exported ${now.toLocaleString("en-IN")}${exportedBy ? ` by ${exportedBy}` : ""}`;
  sub.font = { italic: true, color: { argb: "FF676B7A" } };

  const header = ws.getRow(HEADER_ROW);
  LOGIN_COLUMNS.forEach((c, i) => {
    const cell = header.getCell(i + 1);
    cell.value = c.header;
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4693" } };
    cell.alignment = { vertical: "middle" };
  });
  header.height = 22;

  rows.forEach((r, index) => {
    const row = ws.getRow(HEADER_ROW + 1 + index);
    row.values = {
      no: index + 1,
      company: r.company ?? "",
      project_code: r.project_code ?? "",
      project: r.project ?? "",
      live_url: r.live_url ?? "",
      type: r.type ?? "",
      service: r.service ?? "",
      account: r.account ?? "",
      email: r.email ?? "",
      password: r.password ?? "",
      repository: r.repository ?? "",
      login_url: r.login_url ?? "",
      purpose: r.purpose ?? "",
      two_factor: r.two_factor ? "Yes" : "No",
      notes: r.notes ?? "",
      password_updated_at: r.password_updated_at ?? "",
    };
    if (index % 2 === 1) {
      for (let col = 1; col <= lastCol; col += 1) {
        row.getCell(col).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF6F7FB" } };
      }
    }
    // Clickable links (http/https only).
    for (const [key, url] of [["live_url", r.live_url], ["login_url", r.login_url], ["repository", r.repository_url]]) {
      if (isHttp(url)) {
        const cell = row.getCell(key);
        cell.value = { text: String(cell.value || url), hyperlink: url };
        cell.font = { color: { argb: "FF1F4693" }, underline: true };
      }
    }
    row.getCell("password").font = { name: "Consolas" };
    row.alignment = { vertical: "top", wrapText: true };
  });

  ws.autoFilter = { from: { row: HEADER_ROW, column: 1 }, to: { row: HEADER_ROW + Math.max(rows.length, 1), column: lastCol } };
  return wb;
}
