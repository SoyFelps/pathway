// Candidate confirmation e-mail: pure helpers with no Deno or network access, so they can be unit-tested in Node.
// E-mail clients cannot read CSS variables, so the brand colours below are written out on purpose.

export interface ConfirmationInput {
  name: string;
  jobTitle?: unknown;
  companyName?: unknown;
  /** The job's language ('en', 'pt' or 'es', from application_flows.interview_language). Anything else = English. */
  language?: unknown;
}

type Language = "en" | "pt" | "es";

// The texts of the e-mail in each job language. name may be empty (then the greeting has no name).
// Candidates are addressed as "você" in Portuguese and "usted" in Spanish, like the job page.
const COPY: Record<Language, {
  htmlLang: string;
  fallbackName: string; fallbackJob: string; fallbackCompany: string;
  subject: (job: string, company: string) => string;
  greeting: (name: string) => string;
  thanks: (job: string, company: string) => string;
  review: (company: string) => string;
  automated: (company: string) => string;
  eyebrow: string;
  heading: (name: string) => string;
  confirmHtml: (job: string, company: string) => string;
  footer: (company: string) => string;
}> = {
  en: {
    htmlLang: "en", fallbackName: "there", fallbackJob: "the open role", fallbackCompany: "the hiring team",
    subject: (job, company) => `We received your application for ${job} at ${company}`,
    greeting: (name) => `Hi ${name},`,
    thanks: (job, company) => `Thank you for applying for ${job} at ${company}. This message confirms that your application and resume were received.`,
    review: (company) => `The hiring team at ${company} will review your application and contact you if they would like to move forward.`,
    automated: (company) => `This is an automated message sent by Pathway on behalf of ${company}. Please do not reply to this e-mail.`,
    eyebrow: "Application received",
    heading: (name) => `Thanks for applying, ${name}.`,
    confirmHtml: (job, company) => `We confirm that your application for <strong>${job}</strong> at <strong>${company}</strong> and your resume were received.`,
    footer: (company) => `Automated message sent by Pathway on behalf of ${company}. Please do not reply to this e-mail.`,
  },
  pt: {
    htmlLang: "pt-BR", fallbackName: "", fallbackJob: "a vaga em aberto", fallbackCompany: "a equipe de contratação",
    subject: (job, company) => `Recebemos sua candidatura para ${job} – ${company}`,
    greeting: (name) => name ? `Olá, ${name},` : "Olá,",
    thanks: (job, company) => `Obrigado por se candidatar para ${job} – ${company}. Esta mensagem confirma que sua candidatura e seu currículo foram recebidos.`,
    review: (company) => `A equipe de contratação de ${company} vai avaliar sua candidatura e entrará em contato se quiser seguir com o processo.`,
    automated: (company) => `Esta é uma mensagem automática enviada pelo Pathway em nome de ${company}. Por favor, não responda a este e-mail.`,
    eyebrow: "Candidatura recebida",
    heading: (name) => name ? `Obrigado por se candidatar, ${name}.` : "Obrigado por se candidatar.",
    confirmHtml: (job, company) => `Confirmamos que sua candidatura para <strong>${job}</strong> – <strong>${company}</strong> e seu currículo foram recebidos.`,
    footer: (company) => `Mensagem automática enviada pelo Pathway em nome de ${company}. Por favor, não responda a este e-mail.`,
  },
  es: {
    htmlLang: "es", fallbackName: "", fallbackJob: "la vacante", fallbackCompany: "el equipo de selección",
    subject: (job, company) => `Recibimos su postulación para ${job} – ${company}`,
    greeting: (name) => name ? `Hola, ${name}:` : "Hola:",
    thanks: (job, company) => `Gracias por postularse para ${job} – ${company}. Este mensaje confirma que recibimos su postulación y su currículum.`,
    review: (company) => `El equipo de selección de ${company} revisará su postulación y se pondrá en contacto con usted si desea avanzar en el proceso.`,
    automated: (company) => `Este es un mensaje automático enviado por Pathway en nombre de ${company}. Por favor, no responda a este correo.`,
    eyebrow: "Postulación recibida",
    heading: (name) => name ? `Gracias por postularse, ${name}.` : "Gracias por postularse.",
    confirmHtml: (job, company) => `Confirmamos que recibimos su postulación para <strong>${job}</strong> – <strong>${company}</strong> y su currículum.`,
    footer: (company) => `Mensaje automático enviado por Pathway en nombre de ${company}. Por favor, no responda a este correo.`,
  },
};

export function emailLanguage(value: unknown): Language {
  return value === "pt" || value === "es" ? value : "en";
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
  const copy = COPY[emailLanguage(input.language)];
  const name = singleLine(input.name, 120) || copy.fallbackName;
  const job = singleLine(input.jobTitle, 120) || copy.fallbackJob;
  const company = singleLine(input.companyName, 80) || copy.fallbackCompany;

  const subject = singleLine(copy.subject(job, company), 200);
  const text = [
    copy.greeting(name),
    "",
    copy.thanks(job, company),
    "",
    copy.review(company),
    "",
    copy.automated(company),
  ].join("\n");

  const n = escapeHtml(name);
  const j = escapeHtml(job);
  const c = escapeHtml(company);
  const html = `<!doctype html>
<html lang="${copy.htmlLang}">
  <body style="margin:0;padding:0;background:#f8f8f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#17251e;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8f8f8;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid #e2e9e4;border-radius:12px;">
            <tr>
              <td style="padding:32px;">
                <p style="margin:0 0 8px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#315f4a;font-weight:700;">${copy.eyebrow}</p>
                <h1 style="margin:0 0 20px;font-size:22px;line-height:1.3;color:#17251e;">${copy.heading(n)}</h1>
                <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#34463a;">${copy.confirmHtml(j, c)}</p>
                <p style="margin:0;font-size:15px;line-height:1.6;color:#34463a;">${copy.review(c)}</p>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 32px;border-top:1px solid #edf1ed;font-size:12px;line-height:1.5;color:#748178;">
                ${copy.footer(c)}
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
