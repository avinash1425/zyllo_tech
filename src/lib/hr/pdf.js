// Minimal, dependency-free PDF writer for HR letters (Module 9).
//
// Renders plain text (the server-rendered letter body) onto A4 pages using
// the standard Helvetica fonts (no embedding), with word wrapping, page
// breaks, a letterhead and a footer with the reference and page numbers.
// Output is deterministic for the same input (no clock reads), so the same
// letter text always produces the same bytes / checksum.
//
// Nothing here interprets the text: there is no markup, no scripting and no
// external resource; characters outside Windows-1252 are replaced.

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN_X = 56;
const MARGIN_TOP = 64;
const MARGIN_BOTTOM = 72;

// Helvetica glyph widths (1/1000 em) for codes 32..126 (WinAnsiEncoding).
const HELV = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

// Unicode -> Windows-1252 for the 0x80..0x9F block.
const CP1252 = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88,
  0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93,
  0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b,
  0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f,
};

/** Map a JS string to single-byte WinAnsi codes (as a string of chars < 256). */
export function toWinAnsi(text) {
  let out = "";
  for (const ch of String(text ?? "").replace(/₹/g, "Rs.")) {
    const c = ch.codePointAt(0);
    if (c === 9) out += "    ";
    else if (c >= 32 && c < 127) out += ch;
    else if (c >= 0xa0 && c <= 0xff) out += String.fromCharCode(c);
    else if (CP1252[c]) out += String.fromCharCode(CP1252[c]);
    else if (c === 10 || c === 13) out += ch;
    else out += "?";
  }
  return out;
}

const charWidth = (code) => (code >= 32 && code <= 126 ? HELV[code - 32] : 556);

/** Width of a WinAnsi string in points. Bold is approximated (+6%). */
export function textWidth(s, size, bold = false) {
  let w = 0;
  for (let i = 0; i < s.length; i++) w += charWidth(s.charCodeAt(i));
  return (w * size * (bold ? 1.06 : 1)) / 1000;
}

/** Word-wrap one paragraph (WinAnsi string) to a width; long words are split. */
export function wrapLine(s, size, maxWidth, bold = false) {
  if (!s.length) return [""];
  const words = s.split(/ +/);
  const lines = [];
  let cur = "";
  const push = (w) => {
    // split a word that is wider than the line on its own
    while (textWidth(w, size, bold) > maxWidth) {
      let n = w.length;
      while (n > 1 && textWidth(w.slice(0, n), size, bold) > maxWidth) n--;
      if (cur) { lines.push(cur); cur = ""; }
      lines.push(w.slice(0, n));
      w = w.slice(n);
    }
    return w;
  };
  for (const raw of words) {
    const w = push(raw);
    const next = cur ? `${cur} ${w}` : w;
    if (textWidth(next, size, bold) <= maxWidth) cur = next;
    else { if (cur) lines.push(cur); cur = w; }
  }
  lines.push(cur);
  return lines;
}

const esc = (s) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
const num = (n) => (Math.round(n * 100) / 100).toString();

/**
 * Build a PDF. Returns a Uint8Array.
 * opts: { title, body, company, reference, footerNote, date: 'YYYY-MM-DD' }
 */
export function buildLetterPdf({ title = "", body = "", company = "Zyllo Tech", reference = "", footerNote = "", date = "" } = {}) {
  const width = PAGE_W - MARGIN_X * 2;
  const bodySize = 10.5;
  const lead = 15;
  const items = [];   // { text, size, bold, gapBefore }
  for (const l of wrapLine(toWinAnsi(title), 13.5, width, true)) items.push({ text: l, size: 13.5, bold: true, lead: 19 });
  items.push({ text: "", size: bodySize, lead: 8 });
  for (const para of toWinAnsi(body).replace(/\r\n?/g, "\n").split("\n")) {
    for (const l of wrapLine(para.replace(/\s+$/, ""), bodySize, width)) items.push({ text: l, size: bodySize, bold: false, lead });
  }

  // Paginate.
  const pages = [[]];
  let y = PAGE_H - MARGIN_TOP - 34;          // below the letterhead
  for (const it of items) {
    if (y - it.lead < MARGIN_BOTTOM) { pages.push([]); y = PAGE_H - MARGIN_TOP - 34; }
    y -= it.lead;
    pages[pages.length - 1].push({ ...it, y });
  }

  const head = toWinAnsi(company);
  const ref = toWinAnsi(reference);
  const note = toWinAnsi(footerNote);
  const streams = pages.map((lines, i) => {
    const out = [];
    // letterhead
    out.push("0.0627 0.102 0.227 rg");
    out.push(`BT /F2 15 Tf ${num(MARGIN_X)} ${num(PAGE_H - MARGIN_TOP)} Td (${esc(head)}) Tj ET`);
    out.push("0.976 0.404 0.024 RG 1.4 w");
    out.push(`${num(MARGIN_X)} ${num(PAGE_H - MARGIN_TOP - 12)} m ${num(PAGE_W - MARGIN_X)} ${num(PAGE_H - MARGIN_TOP - 12)} l S`);
    out.push("0.12 0.14 0.2 rg");
    for (const l of lines) {
      if (!l.text) continue;
      out.push(`BT /${l.bold ? "F2" : "F1"} ${num(l.size)} Tf ${num(MARGIN_X)} ${num(l.y)} Td (${esc(l.text)}) Tj ET`);
    }
    // footer
    out.push("0.8 0.82 0.86 RG 0.6 w");
    out.push(`${num(MARGIN_X)} ${num(MARGIN_BOTTOM - 22)} m ${num(PAGE_W - MARGIN_X)} ${num(MARGIN_BOTTOM - 22)} l S`);
    out.push("0.4 0.43 0.5 rg");
    const pageLabel = `Page ${i + 1} of ${pages.length}`;
    if (ref) out.push(`BT /F1 8 Tf ${num(MARGIN_X)} ${num(MARGIN_BOTTOM - 34)} Td (${esc(ref)}) Tj ET`);
    out.push(`BT /F1 8 Tf ${num(PAGE_W - MARGIN_X - textWidth(pageLabel, 8))} ${num(MARGIN_BOTTOM - 34)} Td (${esc(pageLabel)}) Tj ET`);
    if (note) {
      const n = wrapLine(note, 7, width)[0];
      out.push(`BT /F1 7 Tf ${num(MARGIN_X)} ${num(MARGIN_BOTTOM - 46)} Td (${esc(n)}) Tj ET`);
    }
    return out.join("\n");
  });

  // Objects: 1 catalog, 2 pages, 3 F1, 4 F2, 5 info, then page/content pairs.
  const objs = [];
  const pageIds = pages.map((_, i) => 6 + i * 2);
  objs[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objs[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`;
  objs[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
  objs[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";
  const d = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date.replace(/-/g, "") : "";
  objs[5] = `<< /Title (${esc(toWinAnsi(title))}) /Producer (Zyllo Tech HRMS)${d ? ` /CreationDate (D:${d}000000Z)` : ""} >>`;
  streams.forEach((s, i) => {
    const pid = pageIds[i];
    objs[pid] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(PAGE_W)} ${num(PAGE_H)}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${pid + 1} 0 R >>`;
    objs[pid + 1] = `<< /Length ${s.length} >>\nstream\n${s}\nendstream`;
  });

  let pdf = "%PDF-1.4\n%\xe2\xe3\xcf\xd3\n";
  const offsets = [];
  for (let i = 1; i < objs.length; i++) {
    offsets[i] = pdf.length;
    pdf += `${i} 0 obj\n${objs[i]}\nendobj\n`;
  }
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < objs.length; i++) pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objs.length} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${xref}\n%%EOF\n`;

  const bytes = new Uint8Array(pdf.length);
  for (let i = 0; i < pdf.length; i++) bytes[i] = pdf.charCodeAt(i) & 0xff;
  return bytes;
}

/** SHA-256 hex digest of bytes (Web Crypto). */
export async function sha256Hex(bytes) {
  const buf = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Trigger a browser download of PDF bytes. */
export function downloadPdf(bytes, fileName) {
  const blob = new Blob([bytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName.endsWith(".pdf") ? fileName : `${fileName}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const LETTER_FOOTER =
  "System-generated by Zyllo Tech HRMS. Acknowledgement in the Employee Portal is a record of receipt, not a digital signature.";
