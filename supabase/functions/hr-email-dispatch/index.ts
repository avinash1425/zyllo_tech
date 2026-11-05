// Delivers queued rows from public.hr_email_outbox.
// Invoke on a schedule (Supabase cron -> this function with the service-role
// key) or manually by a user holding settings.manage.
//
// Provider: EMAIL_PROVIDER=resend with RESEND_API_KEY and EMAIL_FROM secrets.
// If no provider is configured, rows are marked FAILED with an explicit reason
// (never "sent"), so the UI shows the truth.
import { json, preflight } from "../_shared/cors.ts";
import { callerClient, callerProfile, serviceClient, isServiceRoleRequest } from "../_shared/hr.ts";

const BATCH = 25;

async function deliver(to: string, subject: string, text: string): Promise<{ ok: boolean; error?: string }> {
  const provider = (Deno.env.get("EMAIL_PROVIDER") ?? "").toLowerCase();
  const from = Deno.env.get("EMAIL_FROM");
  if (provider === "resend") {
    const key = Deno.env.get("RESEND_API_KEY");
    if (!key || !from) return { ok: false, error: "Email provider is not fully configured (RESEND_API_KEY / EMAIL_FROM)." };
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [to], subject, text }),
    });
    if (!r.ok) return { ok: false, error: `Provider rejected the message (HTTP ${r.status}).` };
    return { ok: true };
  }
  return { ok: false, error: "No email provider configured (set EMAIL_PROVIDER)." };
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

  if (!isServiceRoleRequest(req)) {
    const caller = callerClient(req);
    const profile = caller ? await callerProfile(caller) : null;
    if (!profile || !profile.permissions.includes("settings.manage")) return json(req, { error: "Not allowed." }, 403);
  }

  const admin = serviceClient();
  // Claim a batch (queued -> sending) so concurrent runs don't double-send.
  const { data: rows, error } = await admin.from("hr_email_outbox")
    .select("id, to_email, subject, body_text, attempts")
    .eq("status", "queued").order("created_at").limit(BATCH);
  if (error) return json(req, { error: error.message }, 500);

  let sent = 0, failed = 0;
  for (const row of rows ?? []) {
    const { data: claimed } = await admin.from("hr_email_outbox")
      .update({ status: "sending", attempts: (row.attempts ?? 0) + 1 })
      .eq("id", row.id).eq("status", "queued").select("id");
    if (!claimed?.length) continue;
    const result = await deliver(row.to_email, row.subject, row.body_text);
    await admin.from("hr_email_outbox").update(result.ok
      ? { status: "sent", sent_at: new Date().toISOString(), last_error: null }
      : { status: "failed", last_error: result.error ?? "Unknown error" }).eq("id", row.id);
    if (result.ok) sent++; else failed++;
  }
  return json(req, { processed: (rows ?? []).length, sent, failed });
});
