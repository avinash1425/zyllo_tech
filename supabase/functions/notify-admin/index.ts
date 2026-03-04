import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface NotificationPayload {
  type: 'contact' | 'career' | 'newsletter';
  data: Record<string, string>;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { type, data } = await req.json() as NotificationPayload;
    
    const ADMIN_EMAIL = 'info@zyllotech.com';
    
    let subject = '';
    let body = '';

    switch (type) {
      case 'contact':
        subject = `New Contact Inquiry from ${data.name}`;
        body = `
New contact form submission:

Name: ${data.name}
Email: ${data.email}
Phone: ${data.phone || 'Not provided'}
Subject: ${data.subject}
Service: ${data.service || 'Not specified'}

Message:
${data.message}
        `.trim();
        break;

      case 'career':
        subject = `New Career Application: ${data.role} - ${data.fullName}`;
        body = `
New career application received:

Name: ${data.fullName}
Email: ${data.email}
Phone: ${data.phone}
Role: ${data.role}
Location: ${data.location}
Experience: ${data.experience}
LinkedIn: ${data.linkedIn || 'Not provided'}
Resume: Uploaded (check storage bucket)

Cover Letter:
${data.coverLetter}
        `.trim();
        break;

      case 'newsletter':
        subject = `New Newsletter Subscriber: ${data.email}`;
        body = `A new user has subscribed to the newsletter:\n\nEmail: ${data.email}`;
        break;

      default:
        throw new Error(`Unknown notification type: ${type}`);
    }

    // Log the notification (in production, integrate with an email service)
    console.log(`📧 Notification to ${ADMIN_EMAIL}`);
    console.log(`Subject: ${subject}`);
    console.log(`Body: ${body}`);

    return new Response(
      JSON.stringify({ success: true, message: 'Notification logged successfully' }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Notification error:', errorMessage);
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
