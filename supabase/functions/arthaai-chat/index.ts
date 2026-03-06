import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { messages, calcContext } = await req.json();

    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_API_KEY) {
      return new Response(
        JSON.stringify({ error: "ANTHROPIC_API_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const systemPrompt = `You are ArthaGuru — an AI-powered personal finance advisor built exclusively for India by Zyllo Tech. You are knowledgeable, empathetic, and practical.

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
7. Be encouraging, not preachy

${calcContext ? `\nCurrent calculator context (reference if relevant):\n${calcContext}` : ""}`;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
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

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error?.message || "Anthropic API error");
    }

    return new Response(
      JSON.stringify({ message: data.content[0].text }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
