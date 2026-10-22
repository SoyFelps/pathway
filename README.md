# Pathway

**A calmer, clearer way to hire.** Pathway is an early-access hiring app for employers and recruiting teams. Build branching application journeys, publish job links, and review applicants in a private workspace.

## Run locally

Pathway is a static HTML/CSS/JavaScript app with no build step or `package.json`. Serve the repository root with any static server, for example:

```sh
python3 -m http.server 8000
```

Run automated checks with:

```sh
node --test tests/*.test.js
```

The app connects to the configured Supabase project. Supabase Auth Site URL and redirect URLs must include the deployed GitHub Pages app URL.

## Current features

- Email/password sign-up and sign-in (with first and last name), with one workspace per account. Supabase Auth, PostgreSQL and Row Level Security (RLS) protect workspace data.
- Visual flow builder with branching steps, candidate preview and cloud saving. Free workspaces can create and edit flows; publishing requires active Premium.
- Published jobs use a stable public link backed by the active snapshot. Flow editors can explicitly publish saved edits into that snapshot without changing the link; unpublishing or loss of paid access invalidates it.
- **Incomplete jobs are locked.** The database refuses to save or publish a job that lacks the minimum structure (one "your details" step, at least one ending, valid connections). If a damaged job ever exists, the dashboard shows it as a red, locked card (only "Delete flow" is offered), it is unpublished automatically, and the public page and the application function stop serving it.
- Candidate applications include routed answers, contact information, privacy acknowledgment and a PDF/DOC/DOCX resume (up to 10 MB).
- **Applicant board (Kanban).** Ten stages in a fixed order: Failed, New, Screening, Team Fit, Skill Fit, Interview, Promising, Offer, Withdrawn, Hired. The board is searchable and filterable by job, and cards can be dragged between stages.
  - **Customize** (needs the "Customize stages" permission): turn stages on or off (Failed and New are always on; a stage that holds candidates cannot be turned off), reorder the stages in between (Failed and New stay first, Hired stays last), and create up to **5 custom columns** (rename, delete when empty). The setup is stored per workspace and shared by the whole team.
- Resumes are stored in a private Supabase Storage bucket. PDFs can be previewed in the app; downloads remain available. Access is scoped to the workspace.
- **Automatic screening ("auto-fail"):** an employer can mark answers (and a numeric minimum) that move a candidate to Failed on the server. The candidate sees the same final screen; the hiring team sees the reason and can move the candidate on.
- **Internal team comments** on each candidate, with @mentions (in-app notification only, no e-mail). Comments are internal notes and are never exported.
- **Data-rights tools:** Settings → "Download my data" (CSV of the signed-in person's own account data); in the candidate panel, "Export data" (CSV of the application data held about that candidate for the job, without internal comments) and "Delete candidate" (applications, resume file and comments); "Clear all failed" removes every Failed candidate.
- **My Team:** Premium workspaces can add up to three members at no additional seat charge. Owners assign Flows, Candidates, Reports, Team and Customize stages permissions (all on by default, adjustable before the invitation is sent). Invitations are copyable links, expire after seven days, and are bound to the invited email. Members can leave without deleting their account.
- **My Team (view only):** people without the Team permission can open My Team and see the owner and every member with what each can access, but cannot invite, remove or change anyone (pending invitations stay manager-only). They can still leave the workspace.
- **My Companies:** company profiles (name, description, logo) that can be attached to jobs and are shown to candidates on the job page.
- **My Plan:** workspace owners can view plan status, start checkout, schedule cancellation or resume renewal, update payment methods through Stripe, and view payment history. Team members cannot access billing.
- Dashboard reports flow totals, new applicants and published flows.
- **Confirmation e-mail:** after a new application is saved, the candidate receives an English confirmation through [Resend](https://resend.com), sent by the `applications` function. Sending is best effort and never fails an application, and only the first application from an address to a job triggers an e-mail. See [Candidate e-mail and abuse protection](#candidate-e-mail-and-abuse-protection).
- **Repeat applications:** a candidate may apply to the same job more than once. The Kanban shows one card per candidate (same job and e-mail address, ignoring case), with an "N applications" badge and one tab per application in the detail panel. The stage belongs to the candidate: moving a card moves all of their applications, and a new application inherits the current stage (including Failed and custom columns). The form never reveals whether an address has applied before. Counts (including the dashboard's new applicants) count candidates.
- **Responsible people:** each job can name one or more responsible team members (the owner is included in the list), chosen in the "Create a new application flow" modal and editable in the first step's Job details. "All" is the default. Anyone in the workspace can read the list. A member who leaves, is removed or deletes their account is taken off every job automatically (a database trigger); a job left with nobody responsible goes back to "All". The list is stored in its own column and is never part of the public published snapshot.
- **Notifications (in the app):** a bell in the header shows one entry per job, "There are new applications for <job>" with the number of new candidates, however many arrive, and entries for @mentions. It is checked every minute. Opening that job's applicants board clears it for that person only; the next new candidate brings it back. Only people with the Candidates permission are notified, and only the job's responsible people (everyone when it is set to All). Repeat applications and candidates in Failed do not count. Nothing is stored per application: each person has a "seen until" time per job. There are no e-mail notifications to recruiters.
- **Abuse protection on the public application form:** Cloudflare Turnstile CAPTCHA, a per-visitor limit (20 attempts per hour per job), per-job ceilings (300 per hour and 2,000 per day by default) and a hidden honeypot field.
- **Reports:** a sidebar page, shown to people with the Reports permission (on by default and independent of Candidates), with the hiring numbers of the workspace for a chosen period (and for one company or one job): page visits, form starts, new candidates, completion rate, a chart over time, the application funnel, where candidates are now (stages), how many were moved to Failed by auto-fail rules (with the reasons, grouped by question, when one job is chosen) and a list of jobs (10 at a time, with search, sorting and a company filter) that scales to many jobs. The report can be exported as CSV. All numbers are aggregated in the database; no name, e-mail or answer text reaches the page.
- **Where candidates drop off (Reports, one job):** for the chosen job, how many people reached each step of the published form (opened the page, started, completed the first page, each question, submitted) and how many stopped there. It is exact even for forms whose paths branch and meet again, because the step counters remember where each visit came from. It is versioned: when the structure of a published form changes (questions, connections or the optional first-page fields; renaming a question does not count) a new form version starts, the counters are kept per version, and a "Form version" select appears in the card header only when a job has more than one version. The other Reports blocks always use all data and are not affected by edits to a job.
- **Recruiting metrics (data capture):** every stage change is recorded with its date (no personal data, removed with the candidate), and public job pages are counted anonymously (page views, form starts and the step reached, per job, day and form version: no cookie, no IP address, no person). The Reports page reads these counters.
- **Legal page** (`legal.html`): Terms, Privacy Policy and data-processing text, linked from sign-up and sign-in. They are drafts that still need a lawyer's review.

## Architecture and security

The hiring UI is on `index.html`; the public application is served by `apply.html`; the legal text is `legal.html`. Frontend code is organized in `builder.js`, `backend.js`, `auth.js`, `candidate.js` and `pathway.js`. Supabase migrations live in `supabase/migrations/`; Edge Functions are `applications`, `team`, `billing`, `billing-webhook` and `delete-account`.

RLS and server-side checks enforce workspace isolation and permissions; hidden UI controls are not security boundaries. Candidate rows cannot be inserted directly by the browser. The `applications` function validates public submissions against the active published flow. Resume storage is private. Invitation links require verified email matching and are single-use. Supabase publishable and Stripe publishable keys may be used in the browser; Supabase service-role keys and Stripe secret/webhook keys must remain server-side and must never be committed.

The configured subscription is **US$24.90/month**. Confirm Stripe test/live mode and server secrets before changing or accepting real payments. See [Stripe integration notes](STRIPE_INTEGRATION_TODO.md) and [Supabase support views](SUPPORT_VIEWS.md).

## Candidate e-mail and abuse protection

Both run inside the `applications` Edge Function (`supabase/functions/applications/`: `index.ts`, `email.ts`, `captcha.ts`). Secrets are set in each Supabase project's dashboard (Edge Functions → Secrets) and are never committed.

| Secret | Purpose |
|---|---|
| `RESEND_API_KEY` | Enables the candidate confirmation e-mail. Without it, sending is skipped. |
| `EMAIL_FROM` | Sender address. Defaults to `onboarding@resend.dev`, which Resend only delivers to the account owner until a sending domain is verified. |
| `TURNSTILE_SECRET_KEY` | Cloudflare Turnstile secret. The CAPTCHA is enforced whenever this secret exists. |
| `FLOW_MAX_APPLICATIONS_PER_HOUR`, `FLOW_MAX_APPLICATIONS_PER_DAY` | Optional per-job ceilings (defaults 300 and 2,000). |

- The public Turnstile **site key** lives in `turnstile-config.js` (safe for the browser). The candidate page requests a token at the moment of submission, because tokens expire after five minutes and work once. An empty site key disables the widget.
- **Rollout order matters:** publish the site key before setting `TURNSTILE_SECRET_KEY`, otherwise the live form is rejected until the page catches up.
- Turnstile allows `soyfelps.github.io` and `localhost`. Cloudflare publishes dummy site and secret keys for automated tests; the real widget needs a human click when it decides a browser looks automated.
- The page never reveals whether an e-mail address has applied before, so the form cannot be used to find out who applied where.

## Deployment

The static site is hosted on GitHub Pages from the repository root. Supabase project-specific configuration is in `supabase/config.toml`; database changes are timestamped migrations. Do not assume a migration or function in Git has reached production: check the project's deployed migration/function state before making operational claims or applying changes. Add database changes as forward migrations; do not rewrite migrations already applied to production. When a loaded script or stylesheet changes, bump its `?v=` version in `index.html` and `apply.html` (and the tests that check it) so browsers fetch the new file.

## Current limitations

Pathway does not send e-mail notifications to recruiters (the in-app bell only), scan uploaded resumes for malware, or provide bulk applicant export (export is per candidate). Reports does not yet show where candidates drop off across all jobs at once (only per job), and auto-fail reasons are grouped by their text, so a renamed question starts a separate group. Visits and form starts are anonymous page counters and can be inflated by anyone who knows the job link. Candidate confirmation e-mails only reach real candidates once a sending domain is verified in Resend; until then Resend delivers only to the account owner. The legal pages are drafts that still need a lawyer's review, and the in-app privacy notice is not a substitute for a reviewed legal privacy policy.
