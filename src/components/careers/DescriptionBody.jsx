import { Check } from "lucide-react";

const HEADING_RE =
  /^(about( this| the)? role|about( the)? (job|position|team)|overview|what you(?:'|’)?ll do|what you will do|responsibilities|key responsibilities|requirements|qualifications|skills|required skills|what we(?:'|’)?re looking for|nice to have|preferred|who you are|benefits|what we offer)\s*:?$/i;
const BULLET_RE = /^\s*(?:[-*•–]|\d+[.)])\s+(.*)$/;

// Turns the plain-text job description into blocks WITHOUT inventing any
// content: headings only appear when the text itself contains them, bullet
// lines become lists, everything else is a paragraph.
export function parseDescription(text) {
  const lines = String(text || "").replace(/\r/g, "").split("\n");
  const blocks = [];
  let para = [];
  let list = null;
  const flushPara = () => {
    if (para.length) blocks.push({ type: "p", text: para.join("\n") });
    para = [];
  };
  const flushList = () => {
    if (list) blocks.push({ type: "ul", items: list });
    list = null;
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      flushPara();
      flushList();
      continue;
    }
    const bullet = BULLET_RE.exec(raw);
    if (bullet) {
      flushPara();
      if (!list) list = [];
      list.push(bullet[1].trim());
    } else if (HEADING_RE.test(line)) {
      flushPara();
      flushList();
      blocks.push({ type: "h", text: line.replace(/:$/, "") });
    } else {
      flushList();
      para.push(line);
    }
  }
  flushPara();
  flushList();
  return blocks;
}

export default function DescriptionBody({ text, className = "" }) {
  const blocks = parseDescription(text);
  return (
    <div className={`space-y-4 ${className}`}>
      {blocks.map((b, i) => {
        if (b.type === "h")
          return (
            <h3
              key={i}
              className="flex items-center gap-2 pt-2 text-xs font-bold uppercase tracking-[0.16em] text-[#173a52]"
            >
              <span aria-hidden="true" className="h-1.5 w-5 rounded-full bg-gradient-to-r from-[#f96706] to-[#ffb15c]" />
              {b.text}
            </h3>
          );
        if (b.type === "ul")
          return (
            <ul key={i} className="space-y-2.5">
              {b.items.map((it, j) => (
                <li key={j} className="flex items-start gap-3 text-[15px] leading-relaxed text-[#4a4f5e]">
                  <span className="mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#3089a6]/12 text-[#3089a6]">
                    <Check className="h-3 w-3" strokeWidth={3} aria-hidden="true" />
                  </span>
                  {it}
                </li>
              ))}
            </ul>
          );
        return (
          <p key={i} className="whitespace-pre-line text-[15px] leading-[1.75] text-[#4a4f5e]">
            {b.text}
          </p>
        );
      })}
    </div>
  );
}
