// E-mails about a scheduled downgrade from Agency to Business (plano-planos.md, phase 4b): one when it is scheduled, one a week before and one
// the day before. The same file lives in billing and billing-reconcile and must stay identical (a test checks it).
// A failed e-mail NEVER blocks or undoes the downgrade: every error is caught here, and the caller only records that the notice went out.
// The builder is pure (no Deno, no network) so it can be unit-tested in Node. E-mail clients cannot read CSS variables, so colours are written out.

export type NoticeKind = "confirmation" | "week" | "day";
type Language = "en" | "pt" | "es";

export interface DowngradeEmailInput {
  kind: NoticeKind;
  language?: unknown; // the person's interface language (profiles.ui_language: 'en', 'pt-BR' or 'es'); anything else = English
  workspaceName: string;
  effectiveAt: string; // ISO date of the change
  keepCompanyName: string | null; // null: no company is chosen to keep
  removedCompanyNames: string[];
  planUrl: string; // My Plan in the app
}

export interface DowngradeEmail { subject: string; text: string; html: string }

const MONTHS_LOCALE: Record<Language, string> = { en: "en-US", pt: "pt-BR", es: "es-ES" };

export function noticeLanguage(value: unknown): Language {
  if (value === "pt-BR" || value === "pt") return "pt";
  return value === "es" ? "es" : "en";
}

const COPY: Record<Language, {
  htmlLang: string;
  subject: (kind: NoticeKind, date: string) => string;
  eyebrow: (kind: NoticeKind) => string;
  intro: (workspace: string, date: string, kind: NoticeKind) => string;
  keep: (company: string) => string;
  noKeep: string;
  remove: string;
  removeNone: string;
  cancel: string;
  button: string;
  footer: string;
  more: (count: number) => string;
}> = {
  en: {
    htmlLang: "en",
    subject: (kind, date) => kind === "confirmation" ? `Your plan will change to Business on ${date}` : kind === "week" ? `Reminder: your plan changes to Business on ${date}` : `Your plan changes to Business on ${date}: last reminder`,
    eyebrow: (kind) => kind === "confirmation" ? "Plan change scheduled" : "Plan change reminder",
    intro: (workspace, date, kind) => kind === "confirmation"
      ? `You scheduled a change for the workspace ${workspace}: on ${date}, at the end of the period you already paid, it moves from Agency to Business. Until then everything stays as it is.`
      : `This is a reminder that the workspace ${workspace} moves from Agency to Business on ${date}.`,
    keep: (company) => `Business includes one company. The company that stays is ${company}.`,
    noKeep: "No company is chosen to keep yet. Cancel the change and schedule it again to choose one; nothing is deleted without a choice.",
    remove: "On that date these companies are permanently deleted, with their jobs, public links, candidates, resumes and AI interviews:",
    removeNone: "Nothing will be deleted: the workspace has only one company.",
    cancel: "You can cancel the change at any time before that date in My Plan.",
    button: "Open My Plan",
    footer: "Automated message sent by Nellio about your workspace plan. Please do not reply to this e-mail.",
    more: (count) => `and ${count} more`,
  },
  pt: {
    htmlLang: "pt-BR",
    subject: (kind, date) => kind === "confirmation" ? `Seu plano vai mudar para o Business em ${date}` : kind === "week" ? `Lembrete: seu plano muda para o Business em ${date}` : `Seu plano muda para o Business em ${date}: último lembrete`,
    eyebrow: (kind) => kind === "confirmation" ? "Mudança de plano agendada" : "Lembrete de mudança de plano",
    intro: (workspace, date, kind) => kind === "confirmation"
      ? `Você agendou uma mudança para o workspace ${workspace}: em ${date}, no fim do período que você já pagou, ele passa do Agency para o Business. Até lá tudo continua como está.`
      : `Este é um lembrete de que o workspace ${workspace} passa do Agency para o Business em ${date}.`,
    keep: (company) => `O Business inclui uma empresa. A empresa que fica é ${company}.`,
    noKeep: "Nenhuma empresa foi escolhida para ficar. Cancele a mudança e agende de novo para escolher uma; nada é excluído sem uma escolha.",
    remove: "Nessa data, estas empresas são excluídas para sempre, com suas vagas, links públicos, candidatos, currículos e entrevistas com IA:",
    removeNone: "Nada será excluído: o workspace tem só uma empresa.",
    cancel: "Você pode cancelar a mudança a qualquer momento antes dessa data, em Meu plano.",
    button: "Abrir Meu plano",
    footer: "Mensagem automática enviada pelo Nellio sobre o plano do seu workspace. Por favor, não responda a este e-mail.",
    more: (count) => `e mais ${count}`,
  },
  es: {
    htmlLang: "es",
    subject: (kind, date) => kind === "confirmation" ? `Tu plan cambiará a Business el ${date}` : kind === "week" ? `Recordatorio: tu plan cambia a Business el ${date}` : `Tu plan cambia a Business el ${date}: último recordatorio`,
    eyebrow: (kind) => kind === "confirmation" ? "Cambio de plan programado" : "Recordatorio de cambio de plan",
    intro: (workspace, date, kind) => kind === "confirmation"
      ? `Programaste un cambio para el espacio de trabajo ${workspace}: el ${date}, al final del período que ya pagaste, pasa de Agency a Business. Hasta entonces todo sigue como está.`
      : `Este es un recordatorio de que el espacio de trabajo ${workspace} pasa de Agency a Business el ${date}.`,
    keep: (company) => `Business incluye una empresa. La empresa que se queda es ${company}.`,
    noKeep: "Todavía no hay ninguna empresa elegida para conservar. Cancela el cambio y prográmalo de nuevo para elegir una; no se elimina nada sin una elección.",
    remove: "En esa fecha estas empresas se eliminan para siempre, con sus vacantes, enlaces públicos, candidatos, currículums y entrevistas con IA:",
    removeNone: "No se eliminará nada: el espacio de trabajo tiene una sola empresa.",
    cancel: "Puedes cancelar el cambio en cualquier momento antes de esa fecha, en Mi plan.",
    button: "Abrir Mi plan",
    footer: "Mensaje automático enviado por Nellio sobre el plan de tu espacio de trabajo. Por favor, no respondas a este correo.",
    more: (count) => `y ${count} más`,
  },
};

// Control characters plus the line and paragraph separators (U+2028, U+2029), built at run time on purpose.
const CONTROL_CHARACTERS = new RegExp(`[\\u0000-\\u001f\\u007f${String.fromCharCode(0x2028, 0x2029)}]`, "g");
const clean = (value: unknown, max: number) => String(value ?? "").replace(CONTROL_CHARACTERS, " ").replace(/\s+/g, " ").trim().slice(0, max);
const escapeHtml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

export function buildDowngradeEmail(input: DowngradeEmailInput): DowngradeEmail {
  const language = noticeLanguage(input.language);
  const copy = COPY[language];
  const when = new Date(input.effectiveAt);
  const date = Number.isNaN(when.getTime()) ? "" : new Intl.DateTimeFormat(MONTHS_LOCALE[language], { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }).format(when);
  const workspace = clean(input.workspaceName, 120) || "Nellio";
  const keep = input.keepCompanyName ? clean(input.keepCompanyName, 120) : "";
  const removed = input.removedCompanyNames.map((name) => clean(name, 120)).filter(Boolean);
  const shown = removed.slice(0, 10);
  const extra = removed.length - shown.length;

  const subject = clean(copy.subject(input.kind, date), 200);
  const intro = copy.intro(workspace, date, input.kind);
  const keepLine = keep ? copy.keep(keep) : copy.noKeep;
  const listLines = shown.map((name) => `- ${name}`).concat(extra > 0 ? [`- ${copy.more(extra)}`] : []);
  const text = [
    intro, "", keepLine, "",
    ...(!keep ? [] : removed.length ? [copy.remove, ...listLines, ""] : [copy.removeNone, ""]),
    copy.cancel, "", `${copy.button}: ${input.planUrl}`, "", copy.footer,
  ].join("\n");

  const listHtml = !keep ? "" : removed.length
    ? `<p style="margin:0 0 8px;font-size:15px;line-height:1.6;color:#34463a;">${escapeHtml(copy.remove)}</p><ul style="margin:0 0 16px;padding-left:20px;font-size:15px;line-height:1.6;color:#34463a;">${shown.map((name) => `<li>${escapeHtml(name)}</li>`).join("")}${extra > 0 ? `<li>${escapeHtml(copy.more(extra))}</li>` : ""}</ul>`
    : `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#34463a;">${escapeHtml(copy.removeNone)}</p>`;
  const html = `<!doctype html>
<html lang="${copy.htmlLang}">
  <body style="margin:0;padding:0;background:#f8f8f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#17251e;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8f8f8;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid #e2e9e4;border-radius:12px;">
            <tr>
              <td style="padding:32px;">
                <p style="margin:0 0 8px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#315f4a;font-weight:700;">${escapeHtml(copy.eyebrow(input.kind))}</p>
                <h1 style="margin:0 0 20px;font-size:22px;line-height:1.3;color:#17251e;">${escapeHtml(subject)}</h1>
                <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#34463a;">${escapeHtml(intro)}</p>
                <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#34463a;">${escapeHtml(keepLine)}</p>
                ${listHtml}
                <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#34463a;">${escapeHtml(copy.cancel)}</p>
                <a href="${escapeHtml(input.planUrl)}" style="display:inline-block;background:#315f4a;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 20px;border-radius:10px;">${escapeHtml(copy.button)}</a>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 32px;border-top:1px solid #edf1ed;font-size:12px;line-height:1.5;color:#748178;">${escapeHtml(copy.footer)}</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
  return { subject, text, html };
}

export interface NoticeEnvironment { resendKey: string; emailFrom: string; appUrl: string }

// deno-lint-ignore no-explicit-any
type Admin = any;

/** Sends one notice. Returns true only when Resend accepted it; never throws (a failure is logged without personal data and the caller goes on). */
export async function sendDowngradeNotice(admin: Admin, change: { id: string; workspace_id: string; keep_company_id: string | null; effective_at: string }, kind: NoticeKind, env: NoticeEnvironment): Promise<boolean> {
  try {
    if (!env.resendKey) { console.log("Downgrade e-mail skipped: RESEND_API_KEY is not configured."); return false; }
    const { data: workspace, error: workspaceError } = await admin.from("workspaces").select("id,name,owner_id").eq("id", change.workspace_id).maybeSingle();
    if (workspaceError || !workspace) return false;
    const [owner, profile, companies] = await Promise.all([
      admin.auth.admin.getUserById(workspace.owner_id),
      admin.from("profiles").select("ui_language").eq("user_id", workspace.owner_id).maybeSingle(),
      admin.from("workspace_companies").select("id,name").eq("workspace_id", workspace.id).order("created_at"),
    ]);
    const to = owner?.data?.user?.email as string | undefined;
    if (!to || companies.error) return false;
    const all = (companies.data || []) as Array<{ id: string; name: string }>;
    const keep = all.find((company) => company.id === change.keep_company_id) || null;
    const planUrl = new URL("index.html", env.appUrl);
    planUrl.hash = "my-plan";
    const mail = buildDowngradeEmail({
      kind, language: profile?.data?.ui_language, workspaceName: workspace.name, effectiveAt: change.effective_at,
      keepCompanyName: keep?.name || null,
      removedCompanyNames: all.filter((company) => company.id !== keep?.id && (keep || all.length > 1)).map((company) => company.name),
      planUrl: planUrl.href,
    });
    const from = env.emailFrom.includes("<") ? env.emailFrom : `Nellio <${env.emailFrom}>`;
    const result = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.resendKey}`, "Content-Type": "application/json", "Idempotency-Key": `plan-downgrade/${change.id}/${kind}` },
      body: JSON.stringify({ from, to: [to], subject: mail.subject, text: mail.text, html: mail.html }),
      signal: AbortSignal.timeout(8000),
    });
    if (!result.ok) { console.error(`Downgrade e-mail rejected (HTTP ${result.status}).`); return false; }
    return true;
  } catch (error) {
    console.error("Downgrade e-mail failed:", error instanceof Error ? error.name : "unknown error");
    return false;
  }
}
