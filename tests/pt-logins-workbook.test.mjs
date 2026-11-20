import { test } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { buildLoginsWorkbook, HEADER_ROW, LOGIN_COLUMNS } from "../src/admin/project-tracker/loginsWorkbook.js";

const rows = [
  {
    company: "Test Co",
    project_code: "ZT-009",
    project: "Portal",
    live_url: "https://portal.example.test",
    type: "Code repository",
    service: "GitHub",
    account: "test-dev",
    email: "dev@example.test",
    password: "S3cret=SUM(A1)",
    repository: "test-dev/portal",
    repository_url: "https://github.com/test-dev/portal",
    login_url: "https://github.com/login",
    purpose: "Main repo",
    two_factor: true,
    notes: "=HYPERLINK(\"http://evil.test\")",
    password_updated_at: "20/11/2026",
  },
  { company: "Test Co", project_code: "ZT-009", project: "Portal", type: "Email account", service: "Gmail", account: "p@example.test", password: "" },
];

async function roundTrip() {
  const wb = buildLoginsWorkbook(ExcelJS, { rows, title: "Test Co — ZT-009 Portal", exportedBy: "admin@example.test", now: new Date("2026-11-20T10:00:00Z") });
  const buffer = await wb.xlsx.writeBuffer();
  const back = new ExcelJS.Workbook();
  await back.xlsx.load(buffer);
  return back.getWorksheet("Logins");
}

test("logins workbook: banner, header and one row per login", async () => {
  const ws = await roundTrip();
  assert.match(String(ws.getCell(1, 1).value), /^CONFIDENTIAL/);
  assert.match(String(ws.getCell(2, 1).value), /Test Co — ZT-009 Portal — exported .* by admin@example\.test/);
  const header = LOGIN_COLUMNS.map((_, i) => ws.getRow(HEADER_ROW).getCell(i + 1).value);
  assert.deepEqual(header, LOGIN_COLUMNS.map((c) => c.header));
  assert.equal(ws.getRow(HEADER_ROW + 1).getCell(1).value, 1);
  assert.equal(ws.getRow(HEADER_ROW + 2).getCell(1).value, 2);
  assert.equal(ws.getRow(HEADER_ROW + 3).getCell(1).value, null);
});

test("logins workbook: every detail in the same line", async () => {
  const ws = await roundTrip();
  const row = ws.getRow(HEADER_ROW + 1);
  const cell = (key) => row.getCell(LOGIN_COLUMNS.findIndex((c) => c.key === key) + 1).value;
  assert.equal(cell("company"), "Test Co");
  assert.equal(cell("project_code"), "ZT-009");
  assert.equal(cell("service"), "GitHub");
  assert.equal(cell("account"), "test-dev");
  assert.equal(cell("email"), "dev@example.test");
  assert.equal(cell("password"), "S3cret=SUM(A1)");
  assert.equal(cell("two_factor"), "Yes");
  assert.deepEqual(cell("repository"), { text: "test-dev/portal", hyperlink: "https://github.com/test-dev/portal" });
  assert.deepEqual(cell("live_url"), { text: "https://portal.example.test", hyperlink: "https://portal.example.test" });
  const second = ws.getRow(HEADER_ROW + 2);
  assert.equal(second.getCell(LOGIN_COLUMNS.findIndex((c) => c.key === "two_factor") + 1).value, "No");
});

test("logins workbook: text that looks like a formula stays plain text", async () => {
  const ws = await roundTrip();
  const row = ws.getRow(HEADER_ROW + 1);
  const notes = row.getCell(LOGIN_COLUMNS.findIndex((c) => c.key === "notes") + 1);
  assert.equal(notes.type, ExcelJS.ValueType.String);
  assert.equal(notes.value, "=HYPERLINK(\"http://evil.test\")");
  assert.equal(row.getCell(LOGIN_COLUMNS.findIndex((c) => c.key === "password") + 1).type, ExcelJS.ValueType.String);
});

test("logins workbook: header row is frozen and filterable", async () => {
  const ws = await roundTrip();
  assert.equal(ws.views[0].state, "frozen");
  assert.equal(ws.views[0].ySplit, HEADER_ROW);
  assert.ok(ws.autoFilter, "auto filter is set");
});
