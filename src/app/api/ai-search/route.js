import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { SERVICES } from "@/data/services";

// A short, factual grounding of what Zyllo Tech actually offers, so the
// assistant answers from real site content instead of guessing. Keep this
// in sync with the services list — it's regenerated on every request, not
// cached, so new services show up automatically.
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

export async function POST(request) {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { error: "AI search isn't configured yet — add a GEMINI_API_KEY to enable it." },
      { status: 503 }
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const query = typeof body?.query === "string" ? body.query.trim().slice(0, 500) : "";
  if (!query) {
    return NextResponse.json({ error: "No query provided." }, { status: 400 });
  }

  try {
    const ai = new GoogleGenAI({ apiKey });

    const response = await ai.models.generateContent({
      model: "gemini-3.6-flash",
      contents: [{ role: "user", parts: [{ text: query }] }],
      config: {
        systemInstruction: SYSTEM_PROMPT,
        maxOutputTokens: 512,
      },
    });

    const reply = response.text ?? "";
    return NextResponse.json({ reply });
  } catch (error) {
    console.error("AI search error:", error?.message || error);
    return NextResponse.json(
      { error: "Search is having trouble responding right now. Please try again in a moment." },
      { status: 502 }
    );
  }
}
