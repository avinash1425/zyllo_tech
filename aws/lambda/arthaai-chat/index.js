/**
 * ArthaAI Chat — AWS Lambda Handler
 * Powered by Google Gemini 1.5 Flash (free tier — no credit card required).
 * Get your free API key: https://aistudio.google.com/app/apikey
 *
 * Deployed in: ap-south-2 (Asia Pacific – Hyderabad)
 * Runtime: Node.js 22.x
 * Env vars required: GEMINI_API_KEY
 */

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

const SYSTEM_PROMPT = `You are ArthaGuru, a friendly and knowledgeable AI financial advisor specialising in Indian personal finance. You provide warm, practical guidance on:

• Budgeting and saving strategies tailored to Indian households
• SIP, mutual funds, ELSS, PPF, NPS, and other Indian investment vehicles
• Tax planning under the Indian Income Tax Act (80C, 80D, HRA, etc.)
• Emergency fund building, debt management, and loan advice
• Financial goal planning — home, education, retirement
• Stock market basics (NSE/BSE), index funds, and risk management
• Insurance — term life, health, and general

Always:
- Give advice in INR (₹) and Indian context
- Be encouraging, never condescending
- Recommend consulting a SEBI-registered financial advisor for large decisions
- Keep responses concise but complete (under 300 words unless deep detail is needed)
- Use simple language — avoid heavy jargon
- If unsure, say so honestly rather than guessing

You are part of the ArthaAI platform by Zyllotech.`;

exports.handler = async (event) => {
  // Handle CORS preflight
  const method =
    event.httpMethod ||
    event.requestContext?.http?.method ||
    "POST";

  if (method === "OPTIONS") {
    return { statusCode: 200, headers: CORS_HEADERS, body: "" };
  }

  try {
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    if (!GEMINI_API_KEY) {
      return {
        statusCode: 500,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: "GEMINI_API_KEY environment variable not set.",
        }),
      };
    }

    const body = JSON.parse(event.body || "{}");
    const userMessages = body.messages || [];

    if (!userMessages.length) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: "messages array is required." }),
      };
    }

    // Convert to Gemini contents format
    // Gemini uses "user" / "model" roles (not "assistant")
    const contents = userMessages.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

    const geminiPayload = {
      system_instruction: {
        parts: [{ text: SYSTEM_PROMPT }],
      },
      contents,
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 1024,
      },
    };

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(geminiPayload),
      }
    );

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      throw new Error(`Gemini API error ${geminiRes.status}: ${errText}`);
    }

    const geminiData = await geminiRes.json();
    const replyText =
      geminiData?.candidates?.[0]?.content?.parts?.[0]?.text ||
      "Sorry, I could not generate a response. Please try again.";

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ message: replyText }),
    };
  } catch (err) {
    console.error("ArthaGuru Lambda error:", err);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
