// Candidate confirmation e-mail: pure helpers with no Deno or network access, so they can be unit-tested in Node.
// E-mail clients cannot read CSS variables, so the brand colours below are written out on purpose.

export interface ConfirmationInput {
  name: string;
  jobTitle?: unknown;
  companyName?: unknown;
}

export interface ConfirmationEmail {
  subject: string;
  text: string;
  html: string;
  fromName: string;
}

// Control characters plus the Unicode line and paragraph separators (U+2028, U+2029), which are built at run time on purpose.
const CONTROL_CHARACTERS = new RegExp(`[\\u0000-\\u001f\\u007f${String.fromCharCode(0x2028, 0x2029)}]`, "g");

/** One line of plain text: control characters removed, whitespace collapsed, length capped. */
export function singleLine(value: unknown, max: number): string {
  return String(value ?? "")
    .replace(CONTROL_CHARACTERS, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Display name for the From header: no quotes, angle brackets or other characters that could break the header. */
export function safeDisplayName(value: string): string {
  return singleLine(value, 60).replace(/["<>@\\,;:()[\]]/g, "").trim() || "Pathway";
}

export function buildConfirmationEmail(input: ConfirmationInput): ConfirmationEmail {
  const name = singleLine(input.name, 120) || "there";
  const job = singleLine(input.jobTitle, 120) || "the open role";
  const company = singleLine(input.companyName, 80) || "the hiring team";

  const subject = singleLine(`We received your application for ${job} at ${company}`, 200);
  const text = [
    `Hi ${name},`,
    "",
    `Thank you for applying for ${job} at ${company}. This message confirms that your application and resume were received.`,
    "",
    `The hiring team at ${company} will review your application and contact you if they would like to move forward.`,
    "",
    `This is an automated message sent by Pathway on behalf of ${company}. Please do not reply to this e-mail.`,
  ].join("\n");

  const n = escapeHtml(name);
  const j = escapeHtml(job);
  const c = escapeHtml(company);
  const html = `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:0;background:#f8f8f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#17251e;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8f8f8;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid #e2e9e4;border-radius:12px;">
            <tr>
              <td style="padding:32px;">
                <p style="margin:0 0 8px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#315f4a;font-weight:700;">Application received</p>
                <h1 style="margin:0 0 20px;font-size:22px;line-height:1.3;color:#17251e;">Thanks for applying, ${n}.</h1>
                <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#34463a;">We confirm that your application for <strong>${j}</strong> at <strong>${c}</strong> and your resume were received.</p>
                <p style="margin:0;font-size:15px;line-height:1.6;color:#34463a;">The hiring team at ${c} will review your application and contact you if they would like to move forward.</p>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 32px;border-top:1px solid #edf1ed;font-size:12px;line-height:1.5;color:#748178;">
                Automated message sent by Pathway on behalf of ${c}. Please do not reply to this e-mail.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { subject, text, html, fromName: safeDisplayName(`${company} via Pathway`) };
}
