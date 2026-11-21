// E-mails of the human interview (pure helpers, no Deno or network access, so they can be unit-tested in Node).
// To the candidate: invitation, update, cancellation and the 24 h / 2 h reminders, in the language of the JOB. NO attachment: one button
// opens the answer page of the Nellio site (owner decision, 2026-11-19: attachments weigh against a new domain's reputation).
// To the recruiter: a notice when the candidate answers (no copy when the invitation is sent: nothing is certain until the candidate confirms), in the recruiter's own language.
// E-mail clients cannot read CSS variables, so the brand colours are written out on purpose (same look as the application e-mail).

export type Language = "en" | "pt" | "es";
export const HEADER_URL = "https://nellio.app/brand/nellio-email-header.png";

export function emailLanguage(value: unknown): Language {
  return value === "pt" || value === "es" ? value : "en";
}
/** The recruiter's interface language (profiles.ui_language: 'en', 'pt-BR', 'es' or empty) as an e-mail language. */
export function languageOfProfile(value: unknown): Language {
  return value === "pt-BR" ? "pt" : value === "es" ? "es" : "en";
}

const CONTROL_CHARACTERS = new RegExp(`[\\u0000-\\u001f\\u007f${String.fromCharCode(0x2028, 0x2029)}]`, "g");
/** One line of plain text: control characters removed, whitespace collapsed, length capped. */
export function singleLine(value: unknown, max: number): string {
  return String(value ?? "").replace(CONTROL_CHARACTERS, " ").replace(/\s+/g, " ").trim().slice(0, max);
}
/** Free text with line breaks kept (notes of the recruiter, message of the candidate). */
export function multiLine(value: unknown, max: number): string {
  return String(value ?? "").replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, max);
}
export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
export function safeDisplayName(value: string): string {
  return singleLine(value, 60).replace(/["<>@\\,;:()[\]]/g, "").trim() || "Nellio";
}

const LOCALE: Record<Language, string> = { en: "en-US", pt: "pt-BR", es: "es" };

/** "Tuesday, December 1, 2026, 14:00–14:30 (GMT-3, America/Sao_Paulo)": the wall-clock time of the interview's own time zone. */
export function formatWhen(startsAt: Date, durationMinutes: number, timeZone: string, language: Language): string {
  const locale = LOCALE[language];
  const end = new Date(startsAt.getTime() + durationMinutes * 60_000);
  const day = new Intl.DateTimeFormat(locale, { timeZone, weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(startsAt);
  const clock = (d: Date) => new Intl.DateTimeFormat(locale, { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
  const zone = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "short" }).formatToParts(startsAt).find((p) => p.type === "timeZoneName")?.value || timeZone;
  return `${day}, ${clock(startsAt)}–${clock(end)} (${zone}, ${timeZone})`;
}

export interface InterviewDetails {
  kind: "online" | "in_person";
  startsAt: Date;
  durationMinutes: number;
  timeZone: string;
  meetingLink?: string | null;
  address?: string | null;
  notes?: string | null;
}

// ---------------------------------------------------------------------------------------------------------------
// Texts. Candidates are addressed as "você" in Portuguese and "usted" in Spanish, like the job page.
interface CandidateCopy {
  htmlLang: string; fallbackName: string; fallbackJob: string; fallbackCompany: string;
  greeting: (name: string) => string;
  labels: { when: string; format: string; online: string; inPerson: string; link: string; address: string; notes: string };
  kinds: Record<"invite" | "update" | "cancel" | "reminder24" | "reminder2" | "reminder10", {
    subject: (job: string, company: string) => string;
    eyebrow: string;
    heading: (company: string) => string;
    intro: (job: string, company: string) => string;
  }>;
  respondLine: string; cancelLine: string; reminderLine: string;
  buttonRespond: string; buttonView: string;
  footer: (company: string) => string;
}

const CANDIDATE: Record<Language, CandidateCopy> = {
  en: {
    htmlLang: "en", fallbackName: "there", fallbackJob: "the open role", fallbackCompany: "the hiring team",
    greeting: (n) => `Hi ${n},`,
    labels: { when: "When", format: "Format", online: "Online", inPerson: "In person", link: "Meeting link", address: "Address", notes: "Notes" },
    kinds: {
      invite: { subject: (j, c) => `Interview invitation: ${j} – ${c}`, eyebrow: "Interview invitation", heading: (c) => `${c} would like to talk to you.`, intro: (j, c) => `You are invited to an interview for ${j} at ${c}.` },
      update: { subject: (j, c) => `Interview updated: ${j} – ${c}`, eyebrow: "Interview updated", heading: () => "Your interview details changed.", intro: (j, c) => `The details of your interview for ${j} at ${c} were updated. Please check the new time and answer again.` },
      cancel: { subject: (j, c) => `Interview cancelled: ${j} – ${c}`, eyebrow: "Interview cancelled", heading: () => "Your interview was cancelled.", intro: (j, c) => `The interview for ${j} at ${c} scheduled for the time below was cancelled. The hiring team may contact you about a new time.` },
      reminder24: { subject: (j) => `Reminder: your interview for ${j} is in 24 hours`, eyebrow: "Interview reminder", heading: () => "Your interview is tomorrow.", intro: (j, c) => `A reminder that your interview for ${j} at ${c} is coming up in about 24 hours.` },
      reminder2: { subject: (j) => `Reminder: your interview for ${j} is in 2 hours`, eyebrow: "Interview reminder", heading: () => "Your interview is in 2 hours.", intro: (j, c) => `A reminder that your interview for ${j} at ${c} starts in about 2 hours.` },
      reminder10: { subject: (j) => `Reminder: your interview for ${j} starts in 10 minutes`, eyebrow: "Interview reminder", heading: () => "Your interview starts in 10 minutes.", intro: (j, c) => `A reminder that your interview for ${j} at ${c} starts in about 10 minutes.` },
    },
    respondLine: "Confirm you can attend, ask for another time or add the interview to your calendar with the button below.",
    cancelLine: "", reminderLine: "You can see the details and add the interview to your calendar with the button below.",
    buttonRespond: "View and reply", buttonView: "View details",
    footer: (c) => `Automated message sent by Nellio on behalf of ${c}. Please do not reply to this e-mail.`,
  },
  pt: {
    htmlLang: "pt-BR", fallbackName: "", fallbackJob: "a vaga em aberto", fallbackCompany: "a equipe de contratação",
    greeting: (n) => n ? `Olá, ${n},` : "Olá,",
    labels: { when: "Quando", format: "Formato", online: "Online", inPerson: "Presencial", link: "Link da reunião", address: "Endereço", notes: "Observações" },
    kinds: {
      invite: { subject: (j, c) => `Convite para entrevista: ${j} – ${c}`, eyebrow: "Convite para entrevista", heading: (c) => `${c} quer conversar com você.`, intro: (j, c) => `Você foi convidado(a) para uma entrevista para ${j} – ${c}.` },
      update: { subject: (j, c) => `Entrevista atualizada: ${j} – ${c}`, eyebrow: "Entrevista atualizada", heading: () => "Os dados da sua entrevista mudaram.", intro: (j, c) => `Os dados da sua entrevista para ${j} – ${c} foram atualizados. Confira o novo horário e responda novamente.` },
      cancel: { subject: (j, c) => `Entrevista cancelada: ${j} – ${c}`, eyebrow: "Entrevista cancelada", heading: () => "Sua entrevista foi cancelada.", intro: (j, c) => `A entrevista para ${j} – ${c} marcada para o horário abaixo foi cancelada. A equipe de contratação pode entrar em contato para combinar um novo horário.` },
      reminder24: { subject: (j) => `Lembrete: sua entrevista para ${j} é em 24 horas`, eyebrow: "Lembrete de entrevista", heading: () => "Sua entrevista é amanhã.", intro: (j, c) => `Um lembrete de que sua entrevista para ${j} – ${c} acontece em cerca de 24 horas.` },
      reminder2: { subject: (j) => `Lembrete: sua entrevista para ${j} é em 2 horas`, eyebrow: "Lembrete de entrevista", heading: () => "Sua entrevista é em 2 horas.", intro: (j, c) => `Um lembrete de que sua entrevista para ${j} – ${c} começa em cerca de 2 horas.` },
      reminder10: { subject: (j) => `Lembrete: sua entrevista para ${j} começa em 10 minutos`, eyebrow: "Lembrete de entrevista", heading: () => "Sua entrevista começa em 10 minutos.", intro: (j, c) => `Um lembrete de que sua entrevista para ${j} – ${c} começa em cerca de 10 minutos.` },
    },
    respondLine: "Confirme sua presença, peça outro horário ou adicione a entrevista à sua agenda pelo botão abaixo.",
    cancelLine: "", reminderLine: "Veja os detalhes e adicione a entrevista à sua agenda pelo botão abaixo.",
    buttonRespond: "Ver e responder", buttonView: "Ver detalhes",
    footer: (c) => `Mensagem automática enviada pelo Nellio em nome de ${c}. Por favor, não responda a este e-mail.`,
  },
  es: {
    htmlLang: "es", fallbackName: "", fallbackJob: "la vacante", fallbackCompany: "el equipo de selección",
    greeting: (n) => n ? `Hola, ${n}:` : "Hola:",
    labels: { when: "Cuándo", format: "Formato", online: "En línea", inPerson: "Presencial", link: "Enlace de la reunión", address: "Dirección", notes: "Observaciones" },
    kinds: {
      invite: { subject: (j, c) => `Invitación a entrevista: ${j} – ${c}`, eyebrow: "Invitación a entrevista", heading: (c) => `${c} quiere conversar con usted.`, intro: (j, c) => `Usted está invitado(a) a una entrevista para ${j} – ${c}.` },
      update: { subject: (j, c) => `Entrevista actualizada: ${j} – ${c}`, eyebrow: "Entrevista actualizada", heading: () => "Cambiaron los datos de su entrevista.", intro: (j, c) => `Se actualizaron los datos de su entrevista para ${j} – ${c}. Revise el nuevo horario y responda de nuevo.` },
      cancel: { subject: (j, c) => `Entrevista cancelada: ${j} – ${c}`, eyebrow: "Entrevista cancelada", heading: () => "Su entrevista fue cancelada.", intro: (j, c) => `La entrevista para ${j} – ${c} programada para el horario indicado abajo fue cancelada. El equipo de selección podrá contactarlo para acordar un nuevo horario.` },
      reminder24: { subject: (j) => `Recordatorio: su entrevista para ${j} es en 24 horas`, eyebrow: "Recordatorio de entrevista", heading: () => "Su entrevista es mañana.", intro: (j, c) => `Le recordamos que su entrevista para ${j} – ${c} es en aproximadamente 24 horas.` },
      reminder2: { subject: (j) => `Recordatorio: su entrevista para ${j} es en 2 horas`, eyebrow: "Recordatorio de entrevista", heading: () => "Su entrevista es en 2 horas.", intro: (j, c) => `Le recordamos que su entrevista para ${j} – ${c} comienza en aproximadamente 2 horas.` },
      reminder10: { subject: (j) => `Recordatorio: su entrevista para ${j} empieza en 10 minutos`, eyebrow: "Recordatorio de entrevista", heading: () => "Su entrevista empieza en 10 minutos.", intro: (j, c) => `Le recordamos que su entrevista para ${j} – ${c} empieza en aproximadamente 10 minutos.` },
    },
    respondLine: "Confirme su asistencia, pida otro horario o agregue la entrevista a su calendario con el botón de abajo.",
    cancelLine: "", reminderLine: "Vea los detalles y agregue la entrevista a su calendario con el botón de abajo.",
    buttonRespond: "Ver y responder", buttonView: "Ver detalles",
    footer: (c) => `Mensaje automático enviado por Nellio en nombre de ${c}. Por favor, no responda a este correo.`,
  },
};

export type CandidateEmailKind = "invite" | "update" | "cancel" | "reminder24" | "reminder2" | "reminder10";

export interface CandidateEmailInput {
  kind: CandidateEmailKind;
  language?: unknown;
  candidateName?: unknown;
  jobTitle?: unknown;
  companyName?: unknown;
  interview: InterviewDetails;
  /** The answer page with the secret of this interview in the part after the #. */
  pageUrl: string;
}

export interface BuiltEmail { subject: string; text: string; html: string; fromName: string }

/** A line of the details box: label, plain text (used in the text version) and, optionally, short links shown instead of the text in the HTML version. */
type Row = [string, string] | [string, string, Array<{ label: string; url: string }>];

interface LayoutInput {
  htmlLang: string; eyebrow: string; heading: string; paragraphs: string[]; rows: Row[];
  button?: { url: string; label: string }; footer: string; greeting?: string;
}

function layout(i: LayoutInput): { html: string; text: string } {
  const rowsHtml = i.rows.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;background:#f3f7f4;border-radius:8px;"><tr><td style="padding:16px;font-size:15px;line-height:1.7;color:#17251e;">${
      i.rows.map(([k, v, links]) => `<strong>${escapeHtml(k)}:</strong> ${links?.length
        ? links.map((a) => `<a href="${escapeHtml(a.url)}" style="color:#1f6b4a;font-weight:600;">${escapeHtml(a.label)}</a>`).join(" &middot; ")
        : escapeHtml(v).replace(/\n/g, "<br>")}`).join("<br>")}</td></tr></table>`
    : "";
  const paragraphs = i.paragraphs.filter(Boolean).map((p) => `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#34463a;">${escapeHtml(p).replace(/\n/g, "<br>")}</p>`).join("\n");
  const button = i.button
    ? `<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="background:#1f6b4a;border-radius:8px;"><a href="${escapeHtml(i.button.url)}" style="display:inline-block;padding:12px 22px;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;">${escapeHtml(i.button.label)}</a></td></tr></table>`
    : "";
  const html = `<!doctype html>
<html lang="${i.htmlLang}">
  <body style="margin:0;padding:0;background:#f8f8f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#17251e;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8f8f8;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid #e2e9e4;border-radius:12px;">
            <tr>
              <td style="padding:0;line-height:0;font-size:0;">
                <img src="${HEADER_URL}" width="520" height="110" alt="Nellio" style="display:block;width:100%;max-width:520px;height:auto;border:0;outline:none;">
              </td>
            </tr>
            <tr>
              <td style="padding:32px;">
                <p style="margin:0 0 8px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#315f4a;font-weight:700;">${escapeHtml(i.eyebrow)}</p>
                <h1 style="margin:0 0 20px;font-size:22px;line-height:1.3;color:#17251e;">${escapeHtml(i.heading)}</h1>
                ${paragraphs}
                ${rowsHtml}
                ${button}
              </td>
            </tr>
            <tr>
              <td style="padding:16px 32px;border-top:1px solid #edf1ed;font-size:12px;line-height:1.5;color:#748178;">
                ${escapeHtml(i.footer)}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
  const text = [
    i.greeting || "",
    i.heading,
    "",
    ...i.paragraphs.filter(Boolean).flatMap((p) => [p, ""]),
    ...i.rows.map(([k, v]) => `${k}: ${v}`),
    i.rows.length ? "" : "",
    i.button ? `${i.button.label}: ${i.button.url}` : "",
    "",
    i.footer,
  ].filter((line, index, all) => !(line === "" && (index === 0 || all[index - 1] === ""))).join("\n");
  return { html, text };
}

function detailRows(copy: CandidateCopy["labels"], d: InterviewDetails, language: Language): Row[] {
  const rows: Row[] = [[copy.when, formatWhen(d.startsAt, d.durationMinutes, d.timeZone, language)]];
  rows.push([copy.format, d.kind === "online" ? copy.online : copy.inPerson]);
  if (d.kind === "online" && d.meetingLink) rows.push([copy.link, singleLine(d.meetingLink, 500)]);
  if (d.kind === "in_person" && d.address) rows.push([copy.address, singleLine(d.address, 300)]);
  const notes = multiLine(d.notes, 1000);
  if (notes) rows.push([copy.notes, notes]);
  return rows;
}

export function buildCandidateEmail(input: CandidateEmailInput): BuiltEmail {
  const language = emailLanguage(input.language);
  const copy = CANDIDATE[language];
  const name = singleLine(input.candidateName, 120) || copy.fallbackName;
  const job = singleLine(input.jobTitle, 120) || copy.fallbackJob;
  const company = singleLine(input.companyName, 80) || copy.fallbackCompany;
  const k = copy.kinds[input.kind];
  const isCancel = input.kind === "cancel";
  const isReminder = input.kind === "reminder24" || input.kind === "reminder2" || input.kind === "reminder10";
  const closing = isCancel ? "" : isReminder ? copy.reminderLine : copy.respondLine;
  const built = layout({
    htmlLang: copy.htmlLang,
    eyebrow: k.eyebrow,
    heading: k.heading(company),
    greeting: copy.greeting(name),
    paragraphs: [k.intro(job, company), closing],
    // a cancelled interview shows only the date and time (so the person knows which one): no meeting link, address or notes
    rows: isCancel ? detailRows(copy.labels, input.interview, language).slice(0, 1) : detailRows(copy.labels, input.interview, language),
    button: isCancel ? undefined : { url: input.pageUrl, label: input.kind === "invite" || input.kind === "update" ? copy.buttonRespond : copy.buttonView },
    footer: copy.footer(company),
  });
  return { subject: singleLine(k.subject(job, company), 200), text: built.text, html: built.html, fromName: safeDisplayName(`${company} via Nellio`) };
}

// ---------------------------------------------------------------------------------------------------------------
// To the recruiter
interface RecruiterCopy {
  htmlLang: string;
  kinds: Record<"confirmed" | "declined" | "reschedule" | "no_link" | "assigned", {
    subject: (name: string, job: string) => string; eyebrow: string; heading: (name: string) => string; intro: (name: string, job: string, company: string) => string;
  }>;
  labels: CandidateCopy["labels"] & { message: string; suggested: string; addToCalendar: string; email: string };
  button: string;
  footer: string;
}

const RECRUITER: Record<Language, RecruiterCopy> = {
  en: {
    htmlLang: "en",
    kinds: {
      confirmed: { subject: (n, j) => `${n} confirmed the interview – ${j}`, eyebrow: "Interview confirmed", heading: (n) => `${n} confirmed.`, intro: (n, j, c) => `${n} confirmed the interview for ${j} at ${c}.` },
      declined: { subject: (n, j) => `${n} denied the interview – ${j}`, eyebrow: "Interview denied", heading: (n) => `${n} denied the interview.`, intro: (n, j, c) => `${n} denied the interview for ${j} at ${c}. The candidate was not moved or rejected: it is your decision.` },
      reschedule: { subject: (n, j) => `${n} asked for another time – ${j}`, eyebrow: "Another time requested", heading: (n) => `${n} asked for another time.`, intro: (n, j, c) => `${n} asked for another time for the interview for ${j} at ${c}. Open the candidate and schedule a new time to send a new invitation.` },
      no_link: { subject: (n, j) => `Add the meeting link: interview with ${n} – ${j}`, eyebrow: "Meeting link missing", heading: (n) => `The interview with ${n} has no meeting link.`, intro: (n, j, c) => `The interview with ${n} for ${j} at ${c} is in about 24 hours and has no meeting link yet. Open the candidate, edit the interview and add the link: the candidate receives the updated invitation.` },
      assigned: { subject: (n, j) => `You are now responsible for the interview with ${n} – ${j}`, eyebrow: "Responsible for an interview", heading: (n) => `You were added as responsible for the interview with ${n}.`, intro: (n, j, c) => `You were added as one of the people responsible for the interview with ${n} for ${j} at ${c}. You will be told when the candidate answers.` },
    },
    labels: { when: "When", format: "Format", online: "Online", inPerson: "In person", link: "Meeting link", address: "Address", notes: "Notes", message: "Candidate message", suggested: "Suggested times", addToCalendar: "Add to my calendar", email: "E-mail" },
    button: "Open candidates",
    footer: "Automated message from Nellio. Please do not reply to this e-mail.",
  },
  pt: {
    htmlLang: "pt-BR",
    kinds: {
      confirmed: { subject: (n, j) => `${n} confirmou a entrevista – ${j}`, eyebrow: "Entrevista confirmada", heading: (n) => `${n} confirmou.`, intro: (n, j, c) => `${n} confirmou a entrevista para ${j} – ${c}.` },
      declined: { subject: (n, j) => `${n} recusou a entrevista – ${j}`, eyebrow: "Entrevista recusada", heading: (n) => `${n} recusou a entrevista.`, intro: (n, j, c) => `${n} recusou a entrevista para ${j} – ${c}. A pessoa não foi movida nem reprovada: a decisão é sua.` },
      reschedule: { subject: (n, j) => `${n} pediu outro horário – ${j}`, eyebrow: "Pedido de outro horário", heading: (n) => `${n} pediu outro horário.`, intro: (n, j, c) => `${n} pediu outro horário para a entrevista para ${j} – ${c}. Abra o candidato e agende um novo horário para enviar um novo convite.` },
      no_link: { subject: (n, j) => `Falta o link da reunião: entrevista com ${n} – ${j}`, eyebrow: "Falta o link da reunião", heading: (n) => `A entrevista com ${n} está sem link.`, intro: (n, j, c) => `A entrevista com ${n} para ${j} – ${c} será em cerca de 24 horas e ainda não tem link de reunião. Abra o candidato, edite a entrevista e adicione o link: a pessoa recebe o convite atualizado.` },
      assigned: { subject: (n, j) => `Você agora é responsável pela entrevista com ${n} – ${j}`, eyebrow: "Responsável por uma entrevista", heading: (n) => `Você foi incluído como responsável pela entrevista com ${n}.`, intro: (n, j, c) => `Você foi incluído como um dos responsáveis pela entrevista com ${n} para ${j} – ${c}. Você será avisado quando o candidato responder.` },
    },
    labels: { when: "Quando", format: "Formato", online: "Online", inPerson: "Presencial", link: "Link da reunião", address: "Endereço", notes: "Observações", message: "Mensagem do candidato", suggested: "Horários sugeridos", addToCalendar: "Adicionar à minha agenda", email: "E-mail" },
    button: "Abrir candidatos",
    footer: "Mensagem automática do Nellio. Por favor, não responda a este e-mail.",
  },
  es: {
    htmlLang: "es",
    kinds: {
      confirmed: { subject: (n, j) => `${n} confirmó la entrevista – ${j}`, eyebrow: "Entrevista confirmada", heading: (n) => `${n} confirmó.`, intro: (n, j, c) => `${n} confirmó la entrevista para ${j} – ${c}.` },
      declined: { subject: (n, j) => `${n} rechazó la entrevista – ${j}`, eyebrow: "Entrevista rechazada", heading: (n) => `${n} rechazó la entrevista.`, intro: (n, j, c) => `${n} rechazó la entrevista para ${j} – ${c}. La persona no fue movida ni rechazada: la decisión es tuya.` },
      reschedule: { subject: (n, j) => `${n} pidió otro horario – ${j}`, eyebrow: "Solicitud de otro horario", heading: (n) => `${n} pidió otro horario.`, intro: (n, j, c) => `${n} pidió otro horario para la entrevista para ${j} – ${c}. Abre el candidato y programa un nuevo horario para enviar una nueva invitación.` },
      no_link: { subject: (n, j) => `Falta el enlace de la reunión: entrevista con ${n} – ${j}`, eyebrow: "Falta el enlace de la reunión", heading: (n) => `La entrevista con ${n} no tiene enlace.`, intro: (n, j, c) => `La entrevista con ${n} para ${j} – ${c} es en unas 24 horas y aún no tiene enlace de reunión. Abre el candidato, edita la entrevista y agrega el enlace: la persona recibe la invitación actualizada.` },
      assigned: { subject: (n, j) => `Ahora eres responsable de la entrevista con ${n} – ${j}`, eyebrow: "Responsable de una entrevista", heading: (n) => `Te agregaron como responsable de la entrevista con ${n}.`, intro: (n, j, c) => `Te agregaron como uno de los responsables de la entrevista con ${n} para ${j} – ${c}. Se te avisará cuando el candidato responda.` },
    },
    labels: { when: "Cuándo", format: "Formato", online: "En línea", inPerson: "Presencial", link: "Enlace de la reunión", address: "Dirección", notes: "Observaciones", message: "Mensaje del candidato", suggested: "Horarios sugeridos", addToCalendar: "Agregar a mi calendario", email: "Correo" },
    button: "Abrir candidatos",
    footer: "Mensaje automático de Nellio. Por favor, no respondas a este correo.",
  },
};

export type RecruiterEmailKind = "confirmed" | "declined" | "reschedule" | "no_link" | "assigned";

export interface RecruiterEmailInput {
  kind: RecruiterEmailKind;
  language?: unknown;
  candidateName?: unknown;
  /** Shown in the body (the title shows the name); also the name when the candidate has none. */
  candidateEmail?: unknown;
  jobTitle?: unknown;
  companyName?: unknown;
  /** Null for an interview with no date yet (a person added as responsible before it is scheduled). */
  interview: InterviewDetails | null;
  /** The candidate's own words, for a request of another time. */
  message?: unknown;
  /** Suggested times as written by the candidate, e.g. "2026-12-03T14:00". */
  suggestedTimes?: unknown[];
  appUrl: string;
  /** "Add to my calendar" links (no attachment), only in the notice that the candidate CONFIRMED (a calendar entry makes no sense before that). */
  calendarLinks?: { google?: string; outlook?: string };
}

export function buildRecruiterEmail(input: RecruiterEmailInput): BuiltEmail {
  const language = emailLanguage(input.language);
  const copy = RECRUITER[language];
  const candidateEmail = singleLine(input.candidateEmail, 254);
  const name = singleLine(input.candidateName, 120) || candidateEmail || "—";
  const job = singleLine(input.jobTitle, 120) || "—";
  const company = singleLine(input.companyName, 80) || "—";
  const k = copy.kinds[input.kind];
  const rows = input.interview ? detailRows(copy.labels, input.interview, language) : [];
  // The title and the text name the person; the address is in the body, so the team has both.
  if (candidateEmail) rows.unshift([copy.labels.email, candidateEmail]);
  const message = multiLine(input.message, 1000);
  if (input.kind === "reschedule") {
    const times = (input.suggestedTimes || []).map((t) => singleLine(t, 20).replace("T", " ")).filter(Boolean);
    if (times.length) rows.push([copy.labels.suggested, times.join("\n")]);
    if (message) rows.push([copy.labels.message, message]);
  }
  if (input.kind === "confirmed" && input.calendarLinks) {
    // In the HTML the long addresses hide behind two short words; the text version keeps the full addresses.
    const shown: Array<{ label: string; url: string }> = [];
    if (input.calendarLinks.google) shown.push({ label: "Google", url: input.calendarLinks.google });
    if (input.calendarLinks.outlook) shown.push({ label: "Outlook", url: input.calendarLinks.outlook });
    if (shown.length) rows.push([copy.labels.addToCalendar, shown.map((a) => `${a.label}: ${a.url}`).join("\n"), shown]);
  }
  const built = layout({
    htmlLang: copy.htmlLang,
    eyebrow: k.eyebrow,
    heading: k.heading(name),
    paragraphs: [k.intro(name, job, company)],
    rows,
    button: { url: input.appUrl, label: copy.button },
    footer: copy.footer,
  });
  return { subject: singleLine(k.subject(name, job), 200), text: built.text, html: built.html, fromName: "Nellio" };
}
