// ai-search: public. POST { query: string } -> { reply: string }
// Port of src/app/api/ai-search/route.js. Secret: GEMINI_API_KEY.
// Optional secret: GEMINI_MODEL (default matches the old route).
import { json, preflight } from "../_shared/cors.ts";
import { SERVICES } from "../_shared/services.ts";

const MAX_QUERY_CHARS = 500; // same cap as the Next route
const MAX_BODY_BYTES = 4096; // reject oversized bodies before parsing
const DEFAULT_MODEL = "gemini-3.6-flash";

const SERVICES_SUMMARY = SERVICES.map((s) => `- ${s.title}: ${s.description}`).join("\n");

const SYSTEM_PROMPT = `You are the site search assistant for Zyllo Tech, a software development company based in India offering web, mobile, AI, and cloud engineering services.

Answer questions ONLY about Zyllo Tech's services, industries served, how to get in touch, or how to navigate the site. Here is what Zyllo Tech actually offers:

${SERVICES_SUMMARY}

Contact: info@zyllotech.com, +91 70757 73680.

Rules:
- Keep answers short — 2-4 sentences, plain language, no markdown headers.
- If asked something unrelated to Zyllo Tech or its services (general knowledge, other companies, personal advice), politely say you can only help with questions about Zyllo Tech and suggest they use the Contact page for anything else.
- Never invent services, pricing, timelines, client names, or statistics that aren't listed above.
- When relevant, point the visitor to a specific page (e.g. "/services", "/contact", "/careers", "/portfolio") using its path.
- Do not claim to take actions (booking calls, sending emails) — only provide information.`;

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return json(req, { error: "Method not allowed." }, 405);

  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) {
    return json(req, { error: "AI search isn't configured yet — add a GEMINI_API_KEY to enable it." }, 503);
  }

  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) return json(req, { error: "Request too large." }, 413);

  let body: { query?: unknown };
  try {
    body = JSON.parse(raw);
  } catch {
    return json(req, { error: "Invalid request body." }, 400);
  }

  const query = typeof body?.query === "string" ? body.query.trim().slice(0, MAX_QUERY_CHARS) : "";
  if (!query) return json(req, { error: "No query provided." }, 400);

  const model = Deno.env.get("GEMINI_MODEL") || DEFAULT_MODEL;
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
          contents: [{ role: "user", parts: [{ text: query }] }],
          generationConfig: { maxOutputTokens: 512 },
        }),
      },
    );
    if (!res.ok) {
      console.error("Gemini error", res.status, (await res.text()).slice(0, 300));
      throw new Error(`Gemini ${res.status}`);
    }
    const data = await res.json();
    const reply = (data?.candidates?.[0]?.content?.parts ?? [])
      .map((p: { text?: string }) => p.text ?? "")
      .join("");
    return json(req, { reply });
  } catch (e) {
    console.error("AI search error:", (e as Error)?.message ?? e);
    return json(req, { error: "Search is having trouble responding right now. Please try again in a moment." }, 502);
  }
});
