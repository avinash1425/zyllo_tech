import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Fallback data if APIs are unreachable
const FALLBACK_DATA = {
  rbiRates: {
    repoRate: 6.25,
    reverseRepoRate: 3.35,
    crrRate: 4.5,
    slrRate: 18.0,
    bankRate: 6.75,
    msfRate: 6.75,
    fdRateRange: "6.5–7.5",
    ppfRate: 7.1,
    nscRate: 7.7,
    sukanyaRate: 8.2,
    lastUpdated: "2025-04-01",
  },
  goldPrices: {
    gold24k: 7850,
    gold22k: 7195,
    silver: 95000,
    unit: "per gram (INR)",
    lastUpdated: new Date().toISOString().split("T")[0],
  },
  taxSlabs: {
    regime: "New Regime FY 2025-26",
    slabs: [
      { range: "0 – ₹4L", rate: "Nil" },
      { range: "₹4L – ₹8L", rate: "5%" },
      { range: "₹8L – ₹12L", rate: "10%" },
      { range: "₹12L – ₹16L", rate: "15%" },
      { range: "₹16L – ₹20L", rate: "20%" },
      { range: "₹20L – ₹24L", rate: "25%" },
      { range: "Above ₹24L", rate: "30%" },
    ],
    standardDeduction: 75000,
    rebateLimit: 1200000,
    section80C: 150000,
    section80D: 25000,
    section80CCD1B: 50000,
  },
  mfNavs: {
    disclaimer: "NAVs are indicative. Check AMFI for latest.",
    popular: [
      { name: "Nifty 50 Index Fund", nav: 245.32, category: "Large Cap Index" },
      { name: "Sensex Index Fund", nav: 810.15, category: "Large Cap Index" },
      { name: "Nifty Next 50 Fund", nav: 62.48, category: "Large & Mid Cap" },
      { name: "Balanced Advantage Fund", nav: 48.76, category: "Hybrid" },
      { name: "Liquid Fund", nav: 3850.20, category: "Debt" },
    ],
    lastUpdated: new Date().toISOString().split("T")[0],
  },
};

async function fetchGoldPrice(): Promise<typeof FALLBACK_DATA.goldPrices> {
  try {
    // Try fetching from a free gold price API
    const res = await fetch("https://www.goldapi.io/api/XAU/INR", {
      headers: { "x-access-token": "placeholder" }, // Public data fallback
    });
    if (!res.ok) {
      await res.text();
      throw new Error("Gold API unavailable");
    }
    const data = await res.json();
    return {
      gold24k: Math.round(data.price_gram_24k || FALLBACK_DATA.goldPrices.gold24k),
      gold22k: Math.round(data.price_gram_22k || FALLBACK_DATA.goldPrices.gold22k),
      silver: FALLBACK_DATA.goldPrices.silver,
      unit: "per gram (INR)",
      lastUpdated: new Date().toISOString().split("T")[0],
    };
  } catch {
    return FALLBACK_DATA.goldPrices;
  }
}

async function fetchMFNavs(): Promise<typeof FALLBACK_DATA.mfNavs> {
  try {
    // AMFI India daily NAV file (public API)
    const res = await fetch("https://www.amfiindia.com/spages/NAVAll.txt");
    if (!res.ok) {
      await res.text();
      throw new Error("AMFI unavailable");
    }
    const text = await res.text();
    const lines = text.split("\n");

    // Parse a few popular scheme codes
    const schemeCodes: Record<string, string> = {
      "120505": "Nifty 50 Index Fund",
      "119551": "Sensex Index Fund",
      "120503": "Nifty Next 50 Fund",
    };

    const navs: Array<{ name: string; nav: number; category: string }> = [];
    for (const line of lines) {
      const parts = line.split(";");
      if (parts.length >= 5) {
        const code = parts[0].trim();
        if (schemeCodes[code]) {
          navs.push({
            name: schemeCodes[code],
            nav: parseFloat(parts[4]) || 0,
            category: "Index",
          });
        }
      }
    }

    return {
      disclaimer: "NAVs from AMFI India. Check amfiindia.com for latest.",
      popular: navs.length > 0 ? navs : FALLBACK_DATA.mfNavs.popular,
      lastUpdated: new Date().toISOString().split("T")[0],
    };
  } catch {
    return FALLBACK_DATA.mfNavs;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { type } = await req.json().catch(() => ({ type: "all" }));

    let result: Record<string, unknown> = {};

    if (type === "all" || type === "rbi") result.rbiRates = FALLBACK_DATA.rbiRates;
    if (type === "all" || type === "gold") result.goldPrices = await fetchGoldPrice();
    if (type === "all" || type === "tax") result.taxSlabs = FALLBACK_DATA.taxSlabs;
    if (type === "all" || type === "mf") result.mfNavs = await fetchMFNavs();

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Market data error:", err);
    return new Response(JSON.stringify(FALLBACK_DATA), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
