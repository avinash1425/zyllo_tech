import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { messages, calcContext, stream: enableStream, language, languageName } = await req.json();
    const normalizedLanguage = typeof language === "string" ? language.toLowerCase() : "en";
    const preferredLanguageName =
      typeof languageName === "string" && languageName.trim().length > 0
        ? languageName.trim()
        : "English";

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(
        JSON.stringify({ error: "AI service not configured" }),
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
- Tax: Section 80C (₹1.5L), 80D (health insurance), 80CCD(1B) NPS (₹50K extra), HRA, home loan interest 24(b), standard deduction ₹75K (new regime FY 2025-26)
- New Tax Regime FY 2025-26: 0-4L: nil, 4-8L: 5%, 8-12L: 10%, 12-16L: 15%, 16-20L: 20%, 20-24L: 25%, 24L+: 30%. Rebate up to ₹12L taxable income.
- Investments: Mutual funds (ELSS, index, large/mid/small cap, debt, hybrid), PPF (7.1%), NPS, FD, RD, SGB, REITs
- Insurance: Term insurance (must-have), health insurance, ULIP vs Term+MF comparison
- Loans: Home, car, personal, education — EMI calculation, prepayment strategies
- Goals: Emergency fund (6 months expenses), retirement corpus (25x annual expenses), children education, home purchase
- Budgeting: 50/30/20 rule adapted for India, zero-based budgeting

Rules:
1. Never recommend specific mutual fund scheme names or specific stocks
2. Always add a brief disclaimer for major investment decisions: "Consult a SEBI-registered advisor"
3. Give specific ₹ numbers and percentages when helpful
4. Keep responses focused — max 250 words unless the question needs more depth
5. Use bullet points for lists
6. Always end complex advice with a clear "Next Step" or action item
7. Be encouraging, not preachy
8. Use markdown formatting: **bold** for emphasis, - for bullets, ## for sections
9. Always respond in ${preferredLanguageName} unless the user explicitly requests another language in that specific message

${calcContext ? `\nCurrent calculator context (reference if relevant):\n${calcContext}` : ""}`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "system",
            content: `User language preference: ${preferredLanguageName} (${normalizedLanguage}). Reply in this language by default.`,
          },
          ...messages,
        ],
        stream: !!enableStream,
      }),
    });

    if (response.status === 429) {
      return new Response(
        JSON.stringify({ error: "Rate limited. Please try again in a moment." }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (response.status === 402) {
      return new Response(
        JSON.stringify({ error: "AI credits exhausted. Please add credits." }),
        { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (!response.ok) {
      const errText = await response.text();
      console.error("AI gateway error:", response.status, errText);
      throw new Error("AI service temporarily unavailable");
    }

    // If streaming, pass through the SSE stream
    if (enableStream) {
      return new Response(response.body, {
        headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
      });
    }

    // Non-streaming response
    const data = await response.json();
    const message = data.choices?.[0]?.message?.content || "Sorry, I could not generate a response.";

    return new Response(
      JSON.stringify({ message }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("ArthaGuru chat error:", msg);
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
