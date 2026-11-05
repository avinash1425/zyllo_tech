// Module 9: the dependency-free letter PDF writer produces structurally
// valid, deterministic PDFs (header, objects, exact xref offsets, trailer).
import test from "node:test";
import assert from "node:assert/strict";
import { buildLetterPdf, sha256Hex, toWinAnsi, wrapLine, textWidth } from "../../src/lib/hr/pdf.js";

const latin1 = (bytes) => Array.from(bytes, (b) => String.fromCharCode(b)).join("");

function checkStructure(bytes) {
  const s = latin1(bytes);
  assert.ok(s.startsWith("%PDF-1.4\n"), "PDF header");
  assert.ok(s.trimEnd().endsWith("%%EOF"), "EOF marker");
  const startxref = Number(s.match(/startxref\n(\d+)\n%%EOF/)[1]);
  assert.equal(s.slice(startxref, startxref + 4), "xref", "startxref points at the xref table");
  const [, count] = s.slice(startxref).match(/^xref\n0 (\d+)\n/);
  const rows = s.slice(startxref).split("\n").slice(3, 2 + Number(count));
  rows.forEach((row, i) => {
    const off = Number(row.slice(0, 10));
    assert.equal(s.slice(off, off + `${i + 1} 0 obj`.length), `${i + 1} 0 obj`, `xref offset of object ${i + 1}`);
  });
  for (const m of s.matchAll(/<< \/Length (\d+) >>\nstream\n/g)) {
    const start = m.index + m[0].length;
    assert.equal(s.slice(start + Number(m[1]), start + Number(m[1]) + "\nendstream".length), "\nendstream", "stream length is exact");
  }
  return s;
}

test("letter PDF is structurally valid", () => {
  const bytes = buildLetterPdf({ title: "Appointment letter — Demo Employee", body: "Dear Demo,\n\nWelcome (with parentheses) and a back\\slash.", company: "Zyllo Tech", reference: "APPOINTM/ZT-0001/1", footerNote: "Note", date: "2026-11-05" });
  const s = checkStructure(bytes);
  assert.match(s, /\/BaseFont \/Helvetica /);
  assert.match(s, /\\\(with parentheses\\\)/, "parentheses escaped");
  assert.match(s, /back\\\\slash/, "backslash escaped");
  assert.match(s, /\/CreationDate \(D:20261105000000Z\)/);
});

test("output is deterministic", async () => {
  const opts = { title: "T", body: "Same text", reference: "R", date: "2026-01-01" };
  assert.equal(await sha256Hex(buildLetterPdf(opts)), await sha256Hex(buildLetterPdf(opts)));
});

test("long text paginates and wraps within the margin", () => {
  const body = Array.from({ length: 120 }, (_, i) => `Paragraph ${i} ` + "lorem ipsum dolor sit amet ".repeat(6)).join("\n");
  const s = checkStructure(buildLetterPdf({ title: "Policy", body }));
  const pages = Number(s.match(/\/Count (\d+)/)[1]);
  assert.ok(pages > 3, `multiple pages (${pages})`);
  assert.match(s, new RegExp(`Page ${pages} of ${pages}`));
  for (const line of wrapLine(toWinAnsi("x".repeat(400)), 10.5, 483)) assert.ok(textWidth(line, 10.5) <= 483, "long word split to fit");
});

test("characters outside Windows-1252 are replaced, not passed through", () => {
  assert.equal(toWinAnsi("₹ 100 — “ok” 漢"), "Rs. 100 \x97 \x93ok\x94 ?");
});
