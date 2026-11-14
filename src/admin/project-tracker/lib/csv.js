// CSV building for Project Tracker exports. Pure module (node-testable).
// Cells that start with = + - @ (or tab/CR) are prefixed with ' so a
// spreadsheet never evaluates them as formulas (CSV injection).

export function safeCell(value) {
  if (value === null || value === undefined) return "";
  let s = typeof value === "object" ? JSON.stringify(value) : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return s;
}

function quote(s) {
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** columns: [{ key, label, value?(row) }]; returns CSV text with a BOM for Excel. */
export function toCSV(columns, rows, { title, generatedAt } = {}) {
  const lines = [];
  if (title) lines.push(quote(safeCell(title)));
  if (generatedAt) lines.push(quote(safeCell(`Generated ${generatedAt}`)));
  if (title || generatedAt) lines.push("");
  lines.push(columns.map((c) => quote(safeCell(c.label))).join(","));
  for (const row of rows) {
    lines.push(columns.map((c) => quote(safeCell(c.value ? c.value(row) : row[c.key]))).join(","));
  }
  return "﻿" + lines.join("\r\n") + "\r\n";
}

/** File-name-safe slug. */
export function slug(s) {
  return String(s || "report").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "report";
}
