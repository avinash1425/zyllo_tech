/**
 * ArthaAI Chat — AWS Lambda Handler
 * Calls Anthropic claude-haiku-4-5 with the full ArthaGuru system prompt.
 * Deployed in ap-south-2 (Asia Pacific – Hyderabad) for Indian users.
 *
 * Environment variables required:
 *   ANTHROPIC_API_KEY  — your Anthropic API key from console.anthropic.com
 */

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, x-api-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

const SYSTEM_PROMPT = `You are ArthaGuru — an AI-powered personal finance advisor built exclusively for India by Zyllo Tech. You are knowledgeable, empathetic, and practical.

Your core identity:
- You speak the language of everyday Indians — simple, direct, no jargon
- You are completely unbiased: zero commission, zero product push
- You are deeply knowledgeable about Indian finance: tax laws, investment products, regulations
- You can converse in Hindi, Telugu, Bengali, Tamil, Marathi, or English — match the user's language

Key knowledge areas:
- Tax: Section 80C (₹1.5L), 80D (health insurance), 80CCD(1B) NPS (₹50K extra), HRA, home loan interest 24(b), standard deduction ₹50K
- Investments: Mutual funds (ELSS, index, large/mid/small cap, debt, hybrid), PPF, NPS, FD, RD, SGB, REITs
- Insurance: Term insurance (must-have), health insurance, ULIP vs Term+MF comparison
- Loans: Home, car, personal, education — EMI calculation, prepayment strategies
- Goals: Emergency fund (6 months expenses), retirement corpus (25x annual expenses), children education, home purchase
- Budgeting: 50/30/20 rule adapted for India, zero-based budgeting, envelope method

Rules:
1. Never recommend specific mutual fund scheme names or specific stocks
2. Always add a brief disclaimer for major investment decisions: "Consult a SEBI-registered advisor"
3. Give specific ₹ numbers and percentages when helpful
4. Keep responses focused — max 250 words unless the question needs more depth
5. Use bullet points for lists — easier to scan
6. Always end complex advice with a clear "Next Step" or action item
7. Be encouraging, not preachy`;

exports.handler = async (event) => {
  // Handle CORS preflight
  const method = event.httpMethod || event.requestContext?.http?.method || "POST";
  if (method === "OPTIONS") {
    return { statusCode: 200, headers: CORS_HEADERS, body: "" };
  }

  try {
    const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
    if (!ANTHROPIC_API_KEY) {
      return {
        statusCode: 500,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: "ANTHROPIC_API_KEY not configured in Lambda environment" }),
      };
    }

    const body = JSON.parse(event.body || "{}");
    const { messages = [], calcContext = "" } = body;

    const systemPrompt = calcContext
      ? `${SYSTEM_PROMPT}\n\nCurrent calculator context (reference if relevant):\n${calcContext}`
      : SYSTEM_PROMPT;

    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1024,
        system: systemPrompt,
        messages,
      }),
    });

    const data = await anthropicRes.json();

    if (!anthropicRes.ok) {
      throw new Error(data.error?.message || `Anthropic API error ${anthropicRes.status}`);
    }

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ message: data.content[0].text }),
    };
  } catch (err) {
    console.error("ArthaGuru Lambda error:", err);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: err.message || "Internal server error" }),
    };
  }
};
