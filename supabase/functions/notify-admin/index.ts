import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

const ADMIN_EMAIL = "info@zyllotech.com";
const SMTP_HOST = "smtp.zoho.in";

type Payload = {
  type: "contact" | "career" | "newsletter";
  data: Record<string, string | number | null | undefined>;
};

function render(payload: Payload): { subject: string; body: string } {
  const d = payload.data;
  switch (payload.type) {
    case "contact":
      return {
        subject: `New enquiry from ${d.full_name || d.name || "website visitor"}`,
        body: [
          `Name: ${d.full_name || d.name || "-"}`,
          `Email: ${d.email || "-"}`,
          `Phone: ${d.phone || "-"}`,
          `Company: ${d.company || "-"}`,
          `Service: ${d.service || "-"}`,
          "",
          "Message:",
          `${d.message || "-"}`,
        ].join("\n"),
      };
    case "career":
      return {
        subject: `New application: ${d.role || "Open role"} — ${d.full_name || ""}`,
        body: [
          `Name: ${d.full_name || "-"}`,
          `Email: ${d.email || "-"}`,
          `Phone: ${d.phone || "-"}`,
          `Role: ${d.role || "-"}`,
          `Experience (years): ${d.experience_years ?? "-"}`,
          `Resume path: ${d.resume_url || "-"} (open it from the admin panel)`,
          "",
          "Cover note:",
          `${d.cover_note || "-"}`,
        ].join("\n"),
      };
    default:
      return {
        subject: `New newsletter subscriber: ${d.email}`,
        body: `A new visitor subscribed to the newsletter.\n\nEmail: ${d.email}`,
      };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const payload = (await req.json()) as Payload;
    if (!payload?.type || !["contact", "career", "newsletter"].includes(payload.type)) {
      return new Response(JSON.stringify({ error: "Invalid notification type" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { subject, body } = render({ type: payload.type, data: payload.data ?? {} });
    const password = Deno.env.get("ZOHO_APP_PASSWORD");

    if (!password) {
      console.log(`[notify-admin] no mailer configured — ${subject}\n${body}`);
      return new Response(JSON.stringify({ delivered: false, logged: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const client = new SMTPClient({
      connection: {
        hostname: SMTP_HOST,
        port: 465,
        tls: true,
        auth: { username: ADMIN_EMAIL, password },
      },
    });

    try {
      await client.send({
        from: `Zyllo Tech Website <${ADMIN_EMAIL}>`,
        to: ADMIN_EMAIL,
        replyTo: typeof payload.data?.email === "string" ? payload.data.email : undefined,
        subject,
        content: body,
      });
      await client.close();
    } catch (mailError) {
      console.error("[notify-admin] SMTP delivery failed:", mailError);
      console.log(`[notify-admin] fallback log — ${subject}\n${body}`);
      return new Response(JSON.stringify({ delivered: false, logged: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ delivered: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[notify-admin] error:", error);
    return new Response(JSON.stringify({ error: "Failed to process notification" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
