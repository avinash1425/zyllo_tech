import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { context } = await req.json();
    if (!context) {
      return new Response(
        JSON.stringify({ error: "context is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(
        JSON.stringify({ error: "LOVABLE_API_KEY is not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const systemPrompt = `You are ArthaGuru, India's most trusted AI financial advisor. You give specific, actionable, unbiased advice tailored to Indian personal finance.

Rules:
1. Analyse the calculator results provided and give 3-5 specific, numbered action items
2. Be concise — max 200 words total
3. Use ₹ for all amounts, format in lakhs/crores where appropriate
4. Reference specific Indian instruments: PPF (7.1%), NPS, ELSS, SSY (8.2%), EPF, FD, SGB, index funds
5. Include relevant tax sections (80C, 80D, 80CCD, 24b) where applicable
6. End with ONE clear immediate next step the user should take TODAY
7. If the user's financial health looks concerning (high FOIR, no emergency fund, no insurance), flag it prominently
8. Never recommend specific stock names or mutual fund scheme names
9. Add a brief disclaimer at the end: "This is educational guidance. Consult a SEBI-registered advisor for personalised advice."
10. Use bullet points and bold for key numbers`;

    const response = await fetch(
      "https://ai.gateway.lovable.dev/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash-lite",
          messages: [
            { role: "system", content: systemPrompt },
            {
              role: "user",
              content: `Here are my financial calculator results:\n\n${context}\n\nGive me specific, personalised financial advice based on these numbers.`,
            },
          ],
        }),
      }
    );

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
      return new Response(
        JSON.stringify({ error: "AI service temporarily unavailable" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const data = await response.json();
    const advice =
      data.choices?.[0]?.message?.content || "Unable to generate advice at this time.";

    return new Response(
      JSON.stringify({ advice }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Advice function error:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
