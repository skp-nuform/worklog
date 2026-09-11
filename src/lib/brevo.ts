import "server-only";

export type SendMagicLinkEmailParams = {
  toEmail: string;
  magicLinkUrl: string;
  recipientName?: string | null;
};

/**
 * Sends a branded magic link email via Brevo's Transactional Email API.
 * Bypasses Supabase's default mailer rate limits (2 emails/hr).
 */
export async function sendMagicLinkViaBrevo({
  toEmail,
  magicLinkUrl,
  recipientName,
}: SendMagicLinkEmailParams) {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) {
    throw new Error(
      "BREVO_API_KEY is not configured. Please set it in your environment variables.",
    );
  }

  const senderEmail =
    process.env.BREVO_SENDER_EMAIL || "sushant@nuformsocial.com";
  const senderName = process.env.BREVO_SENDER_NAME || "Nuform Worklog";

  const htmlContent = `
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Sign in to Nuform Worklog</title>
  </head>
  <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #0A0D14; color: #FFFFFF; margin: 0; padding: 40px 16px;">
    <table align="center" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 520px; background-color: #121722; border: 1px solid #1E2638; border-radius: 12px; overflow: hidden; padding: 36px 32px; box-shadow: 0 10px 25px rgba(0,0,0,0.5);">
      <tr>
        <td>
          <div style="font-size: 11px; font-weight: 700; letter-spacing: 0.16em; text-transform: uppercase; color: #3B82F6; margin-bottom: 12px;">
            Nuform Social • Team Journal
          </div>
          <h1 style="font-size: 24px; font-weight: 600; color: #FFFFFF; margin: 0 0 16px 0; line-height: 1.25; letter-spacing: -0.02em;">
            Your Sign-In Link
          </h1>
          <p style="font-size: 14px; line-height: 1.6; color: #94A3B8; margin: 0 0 28px 0;">
            Hello${recipientName ? ` ${recipientName}` : ""},<br/>
            Click the button below to sign in to your Nuform Worklog workspace. This link is valid for 1 hour and can only be used once.
          </p>
          <div style="margin: 28px 0;">
            <a href="${magicLinkUrl}" target="_blank" rel="noopener noreferrer" style="background-color: #2563EB; color: #FFFFFF; font-size: 14px; font-weight: 600; text-decoration: none; padding: 13px 26px; border-radius: 8px; display: inline-block; letter-spacing: 0.02em;">
              Sign In to Worklog &rarr;
            </a>
          </div>
          <p style="font-size: 12px; line-height: 1.6; color: #64748B; margin: 28px 0 0 0; word-break: break-all;">
            If the button doesn't work, copy and paste this link into your browser:<br/>
            <a href="${magicLinkUrl}" style="color: #3B82F6; text-decoration: underline;">${magicLinkUrl}</a>
          </p>
          <hr style="border: none; border-top: 1px solid #1E2638; margin: 28px 0 20px 0;" />
          <p style="font-size: 11px; color: #475569; margin: 0; line-height: 1.4;">
            If you did not request this link, you can safely ignore this email. Only authorized @nuformsocial.com accounts can access this workspace.
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>
  `.trim();

  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": apiKey,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      sender: { name: senderName, email: senderEmail },
      to: [{ email: toEmail, name: recipientName ?? toEmail.split("@")[0] }],
      subject: "Sign in to Nuform Worklog",
      htmlContent,
    }),
  });

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    const errorMsg = data?.message || res.statusText;
    if (
      data?.code === "unauthorized" &&
      String(errorMsg).includes("authorised_ips")
    ) {
      throw new Error(
        "Brevo IP restriction: Please visit https://app.brevo.com/security/authorised_ips to disable IP restriction or whitelist your IP.",
      );
    }
    throw new Error(`Brevo delivery failed (${res.status}): ${errorMsg}`);
  }

  return { ok: true, messageId: data?.messageId };
}
