// Offer letter PDF generation (no dependencies, runs in the browser and in
// Node tests). Produces a text-only A4 PDF 1.4 using the built-in Helvetica
// fonts: word-wrapped paragraphs, automatic page breaks, a company header and
// a "page x of y" footer with the letter reference/version.
//
// The letter TEXT is generated and versioned on the server
// (hr_offer_letter_versions); this module only lays out a stored version, so
// the same version always produces the same document content.
//
// Characters outside printable ASCII are transliterated (curly quotes, dashes,
// bullets, the rupee sign -> "INR") or replaced with "?", because the standard
// PDF fonts only cover a Latin character set.

const PAGE_W = 595.28;   // A4 in points
const PAGE_H = 841.89;
const MARGIN_X = 60;
const MARGIN_TOP = 64;
const MARGIN_BOTTOM = 64;

// Helvetica glyph widths (1/1000 em) for ASCII 32..126 (Adobe AFM).
const HELV = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];

const TRANSLIT = {
  "‘": "'", "’": "'", "‚": "'", "“": '"', "”": '"', "„": '"',
  "–": "-", "—": "-", "−": "-", "•": "*", "·": "*", "…": "...",
  " ": " ", " ": " ", " ": " ", "₹": "INR ", "é": "e", "è": "e",
  "á": "a", "à": "a", "ó": "o", "ö": "o", "ü": "u", "í": "i", "ñ": "n",
  "\t": "    ",
};

/** Make text safe for the standard fonts: printable ASCII only. */
export function sanitizePdfText(s) {
  return String(s ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[^\n\x20-\x7E]/g, (ch) => TRANSLIT[ch] ?? "?");
}

/** Width of a (sanitised) string in points. */
export function textWidth(s, size, bold = false) {
  let w = 0;
  for (const ch of s) {
    const c = ch.charCodeAt(0);
    w += c >= 32 && c <= 126 ? HELV[c - 32] : 556;
  }
  return (w / 1000) * size * (bold ? 1.06 : 1);
}

/** Greedy word wrap of one paragraph line to maxWidth (breaks long words). */
export function wrapLine(line, size, maxWidth, bold = false) {
  if (line === "") return [""];
  const words = line.split(/ +/);
  const out = [];
  let cur = "";
  for (let word of words) {
    while (textWidth(word, size, bold) > maxWidth) {   // hard-break very long tokens (URLs)
      let cut = word.length;
      while (cut > 1 && textWidth(word.slice(0, cut), size, bold) > maxWidth) cut--;
      if (cur) { out.push(cur); cur = ""; }
      out.push(word.slice(0, cut));
      word = word.slice(cut);
    }
    const next = cur ? `${cur} ${word}` : word;
    if (textWidth(next, size, bold) <= maxWidth) cur = next;
    else { if (cur) out.push(cur); cur = word; }
  }
  out.push(cur);
  return out;
}

const esc = (s) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
const num = (n) => (Math.round(n * 100) / 100).toString();

/**
 * Build the PDF. Returns the document as a binary-safe string (all bytes < 128).
 * @param {object} o
 * @param {string} o.companyName  header line (bold)
 * @param {string} [o.companyLine] smaller second header line (legal name / address)
 * @param {string} o.subject       letter subject (bold)
 * @param {string} o.body          letter text; blank lines separate paragraphs
 * @param {string} [o.footer]      footer text, e.g. "OFR-1234 · version 2"
 * @param {string} [o.title]       PDF document title metadata
 */
export function buildOfferLetterPdf({ companyName = "", companyLine = "", subject = "", body = "", footer = "", title = "Offer letter" } = {}) {
  const maxW = PAGE_W - 2 * MARGIN_X;
  const lines = [];   // { text, size, bold, gap }
  const push = (text, size, bold, gapAfter = 0) => {
    for (const l of wrapLine(sanitizePdfText(text), size, maxW, bold)) lines.push({ text: l, size, bold, gap: 0 });
    if (lines.length) lines[lines.length - 1].gap = gapAfter;
  };
  if (companyName) push(companyName, 15, true, companyLine ? 2 : 6);
  if (companyLine) push(companyLine, 9, false, 6);
  lines.push({ rule: true, gap: 14 });
  if (subject) push(subject, 12, true, 12);
  for (const para of sanitizePdfText(body).split("\n")) push(para, 10.5, false, 0);

  // Paginate.
  const pages = [[]];
  let y = PAGE_H - MARGIN_TOP;
  for (const l of lines) {
    const lead = l.rule ? 0 : l.size * 1.45;
    if (!l.rule && y - lead < MARGIN_BOTTOM) { pages.push([]); y = PAGE_H - MARGIN_TOP; }
    if (l.rule) { pages[pages.length - 1].push({ rule: true, y: y - 4 }); y -= 4 + l.gap; continue; }
    y -= lead;
    pages[pages.length - 1].push({ ...l, y });
    y -= l.gap;
  }

  const total = pages.length;
  const streams = pages.map((items, i) => {
    const ops = [];
    for (const it of items) {
      if (it.rule) { ops.push(`0.86 0.38 0.02 RG 1 w ${num(MARGIN_X)} ${num(it.y)} m ${num(PAGE_W - MARGIN_X)} ${num(it.y)} l S`); continue; }
      if (!it.text) continue;
      ops.push(`BT /${it.bold ? "F2" : "F1"} ${num(it.size)} Tf 0.06 0.10 0.23 rg ${num(MARGIN_X)} ${num(it.y)} Td (${esc(it.text)}) Tj ET`);
    }
    const foot = sanitizePdfText(`${footer ? `${footer}   ` : ""}Page ${i + 1} of ${total}`);
    ops.push(`BT /F1 8 Tf 0.45 0.49 0.55 rg ${num(MARGIN_X)} 36 Td (${esc(foot)}) Tj ET`);
    return ops.join("\n");
  });

  // Objects: 1 catalog, 2 pages, 3 F1, 4 F2, 5 info, then (page, content) pairs.
  const objs = [];
  const pageIds = pages.map((_, i) => 6 + i * 2);
  objs[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objs[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${total} >>`;
  objs[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
  objs[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";
  objs[5] = `<< /Title (${esc(sanitizePdfText(title))}) /Producer (Zyllo Tech HRMS) >>`;
  streams.forEach((s, i) => {
    const pid = pageIds[i];
    objs[pid] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(PAGE_W)} ${num(PAGE_H)}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${pid + 1} 0 R >>`;
    objs[pid + 1] = `<< /Length ${s.length} >>\nstream\n${s}\nendstream`;
  });

  let out = "%PDF-1.4\n";
  const offsets = [];
  for (let id = 1; id < objs.length; id++) {
    offsets[id] = out.length;
    out += `${id} 0 obj\n${objs[id]}\nendobj\n`;
  }
  const xref = out.length;
  out += `xref\n0 ${objs.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objs.length; id++) out += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return out;
}

/** PDF string -> bytes (every char is < 128 by construction). */
export function pdfBytes(pdf) {
  const b = new Uint8Array(pdf.length);
  for (let i = 0; i < pdf.length; i++) b[i] = pdf.charCodeAt(i) & 0xff;
  return b;
}

/** Trigger a browser download of an offer letter version. */
export function downloadOfferLetterPdf(fileName, opts) {
  const blob = new Blob([pdfBytes(buildOfferLetterPdf(opts))], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName.replace(/[^A-Za-z0-9._-]+/g, "_");
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
