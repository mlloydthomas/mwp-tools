// ============================================================
// Email Notifications (alerts for the team)
// ============================================================

import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "smtp.gmail.com",
  port: parseInt(process.env.SMTP_PORT || "587"),
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

export async function sendAlert(params: {
  subject: string;
  html: string;
  to?: string;
}) {
  if (!process.env.SMTP_USER) {
    console.log("Email not configured - skipping alert:", params.subject);
    return;
  }

  await transporter.sendMail({
    from: `MWP Tools <${process.env.SMTP_USER}>`,
    to: params.to || process.env.ALERT_EMAIL_TO,
    subject: params.subject,
    html: params.html,
  });
}

export function buildDailyDigestEmail(params: {
  pricing_count: number;
  engagement_count: number;
  competitor_count: number;
  itinerary_count: number;
  app_url: string;
}): string {
  const total =
    params.pricing_count +
    params.engagement_count +
    params.competitor_count +
    params.itinerary_count;

  return `
<!DOCTYPE html>
<html>
<body style="font-family: Georgia, serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #1a1a30;">
  <h2 style="color: #0d0d1a; border-bottom: 2px solid #4fffb0; padding-bottom: 8px;">
    🌌 MWP Daily Intelligence Digest
  </h2>
  
  <p>You have <strong>${total} item${total !== 1 ? "s" : ""}</strong> awaiting review in your inbox.</p>
  
  <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
    ${params.pricing_count > 0 ? `
    <tr>
      <td style="padding: 8px; border-bottom: 1px solid #e0e0eb;">💰 Pricing recommendations</td>
      <td style="padding: 8px; border-bottom: 1px solid #e0e0eb; font-weight: bold;">${params.pricing_count}</td>
    </tr>` : ""}
    ${params.competitor_count > 0 ? `
    <tr>
      <td style="padding: 8px; border-bottom: 1px solid #e0e0eb;">🔍 Competitor price changes</td>
      <td style="padding: 8px; border-bottom: 1px solid #e0e0eb; font-weight: bold;">${params.competitor_count}</td>
    </tr>` : ""}
    ${params.engagement_count > 0 ? `
    <tr>
      <td style="padding: 8px; border-bottom: 1px solid #e0e0eb;">✉️ Outreach drafts ready</td>
      <td style="padding: 8px; border-bottom: 1px solid #e0e0eb; font-weight: bold;">${params.engagement_count}</td>
    </tr>` : ""}
    ${params.itinerary_count > 0 ? `
    <tr>
      <td style="padding: 8px; border-bottom: 1px solid #e0e0eb;">🗺️ Itinerary drafts ready</td>
      <td style="padding: 8px; border-bottom: 1px solid #e0e0eb; font-weight: bold;">${params.itinerary_count}</td>
    </tr>` : ""}
  </table>
  
  <a href="${params.app_url}" 
     style="display: inline-block; background: #0d0d1a; color: #4fffb0; padding: 12px 24px; 
            text-decoration: none; border-radius: 4px; font-family: monospace; margin-top: 8px;">
    Review in MWP Tools →
  </a>
  
  <p style="color: #6b6b99; font-size: 12px; margin-top: 32px;">
    Milky Way Park · AI Tools Platform
  </p>
</body>
</html>`;
}
