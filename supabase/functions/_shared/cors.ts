// Shared CORS + response helpers for all Edge Functions.
// Set ALLOWED_ORIGINS (comma-separated) as a function secret to restrict;
// defaults to the production site + Lovable preview/localhost patterns.
const DEFAULT_ORIGINS = [
  "https://zyllotech.com",
  "https://www.zyllotech.com",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:5173",
  "http://localhost:8080",
];

export function corsHeaders(req: Request): Record<string, string> {
  const allowed = (Deno.env.get("ALLOWED_ORIGINS") ?? "")
    .split(",").map((s) => s.trim()).filter(Boolean);
  const list = allowed.length ? allowed : DEFAULT_ORIGINS;
  const origin = req.headers.get("origin") ?? "";
  const ok = list.includes(origin) || /^https:\/\/[a-z0-9-]+\.(lovable\.app|lovableproject\.com)$/.test(origin);
  return {
    "Access-Control-Allow-Origin": ok ? origin : list[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Vary": "Origin",
  };
}

export function json(req: Request, body: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json", ...extra },
  });
}

export function preflight(req: Request): Response | null {
  return req.method === "OPTIONS" ? new Response("ok", { headers: corsHeaders(req) }) : null;
}
