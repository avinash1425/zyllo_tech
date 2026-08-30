import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

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


// Minimal SMTP-over-TLS client. Third-party mailer libraries exceed the edge
// runtime's CPU budget, so we speak just enough SMTP to send one plain message.
async function sendMail(opts: {
  password: string;
  subject: string;
  body: string;
  replyTo?: string;
}) {
  const conn = await Deno.connectTls({ hostname: SMTP_HOST, port: 465 });
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const buffer = new Uint8Array(4096);

  // SMTP replies can be multi-line ("250-..." continuation lines) and can also
  // arrive across several TCP reads, so keep reading until a final line
  // ("250 ...") is complete.
  const read = async () => {
    let text = "";
    for (let i = 0; i < 20; i++) {
      const n = await conn.read(buffer);
      if (!n) break;
      text += decoder.decode(buffer.subarray(0, n));
      if (/^\d{3} [^\n]*\r?\n$/m.test(text.split(/\r?\n(?=\d{3})/).pop() ?? "") || /^\d{3} .*\r\n$/m.test(text)) {
        const lines = text.split(/\r?\n/).filter(Boolean);
        const last = lines[lines.length - 1] ?? "";
        if (/^\d{3} /.test(last)) break;
      }
    }
    return text;
  };
  const send = async (line: string, expect = "2") => {
    await conn.write(encoder.encode(line + "\r\n"));
    const reply = await read();
    if (!reply.startsWith(expect)) throw new Error(`SMTP error after "${line.split(" ")[0]}": ${reply}`);
    return reply;
  };

  try {
    await read(); // greeting
    await send(`EHLO zyllotech.com`);
    await send("AUTH LOGIN", "3");
    await send(btoa(ADMIN_EMAIL), "3");
    await send(btoa(opts.password), "2");
    await send(`MAIL FROM:<${ADMIN_EMAIL}>`);
    await send(`RCPT TO:<${ADMIN_EMAIL}>`);
    await send("DATA", "3");

    const headers = [
      `From: Zyllo Tech Website <${ADMIN_EMAIL}>`,
      `To: ${ADMIN_EMAIL}`,
      opts.replyTo ? `Reply-To: ${opts.replyTo}` : null,
      `Subject: ${opts.subject}`,
      "MIME-Version: 1.0",
      'Content-Type: text/plain; charset="utf-8"',
    ].filter(Boolean).join("\r\n");
    const safeBody = opts.body.replace(/\r?\n/g, "\r\n").replace(/\r\n\./g, "\r\n..");
    await send(`${headers}\r\n\r\n${safeBody}\r\n.`);
    await send("QUIT", "2").catch(() => {});
  } finally {
    try { conn.close(); } catch { /* already closed */ }
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

    try {
      await sendMail({
        password,
        subject,
        body,
        replyTo: typeof payload.data?.email === "string" ? payload.data.email : undefined,
      });
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
