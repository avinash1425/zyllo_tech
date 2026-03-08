/**
 * ArthaAI Notify — AWS Lambda Handler
 * Sends admin notification emails via AWS SES.
 * Deployed in ap-south-2 (Asia Pacific – Hyderabad).
 *
 * Environment variables required:
 *   ADMIN_EMAIL  — destination address (default: info@zyllotech.com)
 *   FROM_EMAIL   — SES-verified sender (default: notifications@zyllotech.com)
 *   AWS_REGION   — automatically set by Lambda runtime
 */

const { SESClient, SendEmailCommand } = require("@aws-sdk/client-ses");

// SES is available in ap-south-1 (Mumbai), not ap-south-2 (Hyderabad)
const ses = new SESClient({ region: "ap-south-1" });

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "info@zyllotech.com";
const FROM_EMAIL  = process.env.FROM_EMAIL  || "notifications@zyllotech.com";

exports.handler = async (event) => {
  const method = event.httpMethod || event.requestContext?.http?.method || "POST";
  if (method === "OPTIONS") {
    return { statusCode: 200, headers: CORS_HEADERS, body: "" };
  }

  try {
    const { type, data } = JSON.parse(event.body || "{}");

    let subject = "";
    let bodyText = "";

    switch (type) {
      case "contact":
        subject = `New Contact Inquiry from ${data.name}`;
        bodyText = `New contact form submission:\n\nName: ${data.name}\nEmail: ${data.email}\nPhone: ${data.phone || "Not provided"}\nSubject: ${data.subject}\nService: ${data.service || "Not specified"}\n\nMessage:\n${data.message}`;
        break;

      case "career":
        subject = `New Career Application: ${data.role} — ${data.fullName}`;
        bodyText = `New career application:\n\nName: ${data.fullName}\nEmail: ${data.email}\nPhone: ${data.phone}\nRole: ${data.role}\nLocation: ${data.location}\nExperience: ${data.experience}\nLinkedIn: ${data.linkedIn || "Not provided"}\n\nCover Letter:\n${data.coverLetter}`;
        break;

      case "newsletter":
        subject = `New Newsletter Subscriber: ${data.email}`;
        bodyText = `New newsletter subscriber:\n\nEmail: ${data.email}`;
        break;

      default:
        throw new Error(`Unknown notification type: ${type}`);
    }

    console.log(`Sending ${type} notification to ${ADMIN_EMAIL}`);

    await ses.send(new SendEmailCommand({
      Source: FROM_EMAIL,
      Destination: { ToAddresses: [ADMIN_EMAIL] },
      Message: {
        Subject: { Data: subject, Charset: "UTF-8" },
        Body: { Text: { Data: bodyText, Charset: "UTF-8" } },
      },
    }));

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ success: true, message: "Notification sent via SES" }),
    };
  } catch (err) {
    console.error("Notify Lambda error:", err);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
