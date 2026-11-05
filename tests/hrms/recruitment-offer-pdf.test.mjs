// Offer letter PDF output (src/lib/hr/offerPdf.js). Synthetic data only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildOfferLetterPdf, pdfBytes, sanitizePdfText, wrapLine, textWidth } from "../../src/lib/hr/offerPdf.js";

const letter = {
  companyName: "Zyllo Tech",
  companyLine: "Zyllo Tech Software Solutions Private Limited",
  subject: "Offer of employment: Software Engineer at Zyllo Tech",
  body: "Ref: OFR-1A2B3C4D\nDate: 05 Nov 2026\n\nDear Cara Candidate (synthetic),\n\nWe are pleased to offer you the position of Software Engineer.\nAnnual compensation (CTC): INR 860,000.00\n\nSincerely,\n\nHira Test\nHR Manager",
  footer: "OFR-1A2B3C4D - version 2",
  title: "Offer letter - Cara Candidate",
};

function objectsOf(pdf) {
  const re = /(\d+) 0 obj\n/g;
  const found = new Map();
  let m;
  while ((m = re.exec(pdf))) found.set(Number(m[1]), m.index);
  return found;
}

test("produces a structurally valid PDF with a correct xref table", () => {
  const pdf = buildOfferLetterPdf(letter);
  assert.ok(pdf.startsWith("%PDF-1.4\n"));
  assert.ok(pdf.trimEnd().endsWith("%%EOF"));
  const startxref = Number(pdf.match(/startxref\n(\d+)\n%%EOF/)[1]);
  assert.equal(pdf.slice(startxref, startxref + 4), "xref");
  const xref = pdf.slice(startxref).split("\n");
  const count = Number(xref[1].split(" ")[1]);
  const objs = objectsOf(pdf);
  assert.equal(objs.size, count - 1, "every object listed in xref");
  for (let id = 1; id < count; id++) {
    const offset = Number(xref[2 + id].slice(0, 10));
    assert.equal(offset, objs.get(id), `xref offset of object ${id}`);
  }
  for (const m of pdf.matchAll(/<< \/Length (\d+) >>\nstream\n/g)) {
    const start = m.index + m[0].length;
    assert.equal(pdf.slice(start + Number(m[1]), start + Number(m[1]) + 10), "\nendstream", "stream /Length matches content");
  }
});

test("contains the letter text, escaped, and only 7-bit bytes", () => {
  const pdf = buildOfferLetterPdf(letter);
  assert.match(pdf, /\(Dear Cara Candidate \\\(synthetic\\\),\) Tj/);
  assert.match(pdf, /INR 860,000\.00/);
  assert.match(pdf, /\/BaseFont \/Helvetica-Bold/);
  assert.match(pdf, /Page 1 of 1/);
  assert.ok([...pdfBytes(pdf)].every((b) => b < 128));
});

test("long letters paginate and every page has a footer", () => {
  const body = Array.from({ length: 160 }, (_, i) => `Clause ${i + 1}: synthetic terms of employment text that wraps across the page width for testing.`).join("\n");
  const pdf = buildOfferLetterPdf({ ...letter, body });
  const pages = Number(pdf.match(/\/Type \/Pages \/Kids \[[^\]]*\] \/Count (\d+)/)[1]);
  assert.ok(pages >= 4, `expected several pages, got ${pages}`);
  assert.equal((pdf.match(/Page \d+ of \d+/g) || []).length, pages);
  assert.match(pdf, new RegExp(`Page ${pages} of ${pages}`));
  assert.match(pdf, /Clause 160:/);
});

test("same version text produces identical documents", () => {
  assert.equal(buildOfferLetterPdf(letter), buildOfferLetterPdf(letter));
});

test("non-Latin characters are transliterated or replaced", () => {
  assert.equal(sanitizePdfText("₹ 9,00,000 – “ok” 中"), "INR  9,00,000 - \"ok\" ?");
  const pdf = buildOfferLetterPdf({ ...letter, body: "Salary ₹ 5,00,000 — approx." });
  assert.match(pdf, /Salary INR 5,00,000 - approx\./);   // wrapping collapses repeated spaces
});

test("word wrap keeps lines within the printable width", () => {
  const max = 200;
  const lines = wrapLine("averyveryverylongtokenwithoutanyspaces".repeat(4) + " and some normal words after it", 10.5, max);
  assert.ok(lines.length > 2);
  for (const l of lines) assert.ok(textWidth(l, 10.5) <= max + 0.01, `"${l}" too wide`);
});
