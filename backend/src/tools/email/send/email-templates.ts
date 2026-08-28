// Email HTML templates and builders.

const SENDER_NAME = process.env.EMAIL_SENDER_NAME || "Sigma";

export interface EmailTemplate {
  title?: string;
  headerText?: string;
  footerText?: string;
  brandColor?: string;
  accentColor?: string;
}

const defaultTemplate: EmailTemplate = {
  brandColor: '#6366f1',
  accentColor: '#8b5cf6',
  headerText: SENDER_NAME,
  footerText: `Sent by ${SENDER_NAME} AI`,
};

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function buildHtmlEmail(
  body: string,
  subject: string,
  template?: Partial<EmailTemplate>
): string {
  const t = { ...defaultTemplate, ...template };
  const safeSubject = escapeHtml(subject);
  const safeTitle = t.title ? escapeHtml(t.title) : '';
  const safeHeaderText = escapeHtml(t.headerText || SENDER_NAME);
  const safeFooterText = escapeHtml(t.footerText || `Sent by ${SENDER_NAME} AI`);
  const safeBody = escapeHtml(body).replace(/\n/g, "<br>");

  return `<!DOCTYPE html>
<html lang="en" dir="ltr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${safeSubject}</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f7;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.06);">
          <tr>
            <td style="background:linear-gradient(135deg,${t.brandColor},${t.accentColor});padding:24px 32px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td>
                    <span style="font-size:22px;font-weight:700;color:#ffffff;letter-spacing:-0.5px;">${safeHeaderText}</span>
                  </td>
                  <td align="right" style="color:rgba(255,255,255,0.7);font-size:12px;">
                    ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })}
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          ${safeTitle ? `<tr><td style="padding:16px 32px;background:#f9fafb;border-bottom:1px solid #e5e7eb;">
              <p style="margin:0;font-size:14px;color:#6b7280;font-weight:500;">${safeTitle}</p>
            </td></tr>` : ''}
          <tr>
            <td style="padding:32px;color:#374151;font-size:15px;line-height:1.7;">
              ${safeBody}
            </td>
          </tr>
          <tr>
            <td style="padding:16px 32px;background:#f9fafb;border-top:1px solid #e5e7eb;">
              <span style="font-size:12px;color:#9ca3af;">${safeFooterText}</span>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export function buildTemplateEmail(
  template: 'welcome' | 'invoice' | 'notification' | 'reset' | 'custom',
  data: Record<string, any>,
  subject: string
): string {
  const templates: Record<string, { body: string; title?: string }> = {
    welcome: {
      title: 'Welcome!',
      body: `Hello ${data.name || 'there'}!\n\nWelcome to ${SENDER_NAME}. We're excited to have you on board.\n\nBest regards,\nThe ${SENDER_NAME} Team`,
    },
    invoice: {
      title: 'Invoice Details',
      body: `Invoice #${data.invoiceNumber || 'N/A'}\n\nAmount: ${data.amount || '$0.00'}\nDue Date: ${data.dueDate || 'N/A'}\n\n${data.notes || ''}`,
    },
    notification: {
      title: data.notificationTitle || 'Notification',
      body: `${data.message || 'You have a new notification.'}\n\n${data.actionText || ''}`,
    },
    reset: {
      title: 'Password Reset',
      body: `You requested a password reset.\n\nClick the link below to reset your password:\n${data.resetLink || '[link]'}\n\nIf you didn't request this, please ignore this email.`,
    },
    custom: {
      body: data.body || '',
    },
  };

  const t = templates[template] || templates.custom;
  return buildHtmlEmail(t.body, subject, { title: t.title });
}
