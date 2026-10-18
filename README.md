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

- Email/password sign-up and sign-in, with one workspace per account. Supabase Auth, PostgreSQL and Row Level Security (RLS) protect workspace data.
- Visual flow builder with branching steps, candidate preview and cloud saving. Free workspaces can create and edit flows; publishing requires active Premium.
- Published jobs use a stable public link backed by the active snapshot. Flow editors can explicitly publish saved edits into that snapshot without changing the link; unpublishing or loss of paid access invalidates it.
- Candidate applications include routed answers, contact information, privacy acknowledgment and a PDF/DOC/DOCX resume (up to 10 MB). Applicants can be reviewed in a searchable, flow-filtered Kanban with New, Failed, Promising and Approved stages.
- Resumes are stored in a private Supabase Storage bucket. PDFs can be previewed in the app; downloads remain available. Access is scoped to the workspace.
- **My Team:** Premium workspaces can add up to three members at no additional seat charge. Owners assign Flows, Candidates and Team permissions. Invitations are copyable links, expire after seven days, and are bound to the invited email. Members can leave without deleting their account.
- **My Plan:** workspace owners can view plan status, start checkout, schedule cancellation or resume renewal, update payment methods through Stripe, and view payment history. Team members cannot access billing.
- Dashboard reports flow totals, new applicants and published flows.
- **Confirmation e-mail:** after a new application is saved, the candidate receives an English confirmation through [Resend](https://resend.com), sent by the `applications` function. Sending is best effort and never fails an application, and only the first application from an address to a job triggers an e-mail. See [Candidate e-mail and abuse protection](#candidate-e-mail-and-abuse-protection).
- **Repeat applications:** a candidate may apply to the same job more than once. The Kanban shows one card per candidate (same job and e-mail address, ignoring case), with an "N applications" badge and one tab per application in the detail panel. The stage belongs to the candidate: moving a card moves all of their applications, and a new application inherits the current stage (including Failed). The form never reveals whether an address has applied before. Counts (including the dashboard's new applicants) count candidates.
- **Responsible people:** each job can name one or more responsible team members (the owner is included in the list), chosen in the "Create a new application flow" modal and editable in the first step's Job details. "All" is the default. Anyone in the workspace can read the list. A member who leaves, is removed or deletes their account is taken off every job automatically (a database trigger); a job left with nobody responsible goes back to "All". The list is stored in its own column and is never part of the public published snapshot.
- **Notifications:** a bell in the header shows one entry per job, "There are new applications for <job>" with the number of new candidates, however many arrive. It is checked every minute. Opening that job's applicants board clears it for that person only; the next new candidate brings it back. Only people with the Candidates permission are notified, and only the job's responsible people (everyone when it is set to All). Repeat applications and candidates in Failed do not count. Nothing is stored per application: each person has a "seen until" time per job.
- **Abuse protection on the public application form:** Cloudflare Turnstile CAPTCHA, a per-visitor limit (20 attempts per hour per job), per-job ceilings (300 per hour and 2,000 per day by default) and a hidden honeypot field.

## Architecture and security

The hiring UI is on `index.html`; the public application is served by `apply.html`. Frontend code is organized in `builder.js`, `backend.js`, `auth.js`, `candidate.js` and `pathway.js`. Supabase migrations live in `supabase/migrations/`; Edge Functions are `applications`, `team`, `billing` and `billing-webhook`.

RLS and server-side checks enforce workspace isolation and permissions; hidden UI controls are not security boundaries. Candidate rows cannot be inserted directly by the browser. The `applications` function validates public submissions against the active published flow. Resume storage is private. Invitation links require verified email matching and are single-use. Supabase publishable and Stripe publishable keys may be used in the browser; Supabase service-role keys and Stripe secret/webhook keys must remain server-side and must never be committed.

The configured subscription is **US$24.90/month**. Confirm Stripe test/live mode and server secrets before changing or accepting real payments. See [Stripe integration notes](STRIPE_INTEGRATION_TODO.md).

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

The static site is hosted on GitHub Pages from the repository root. Supabase project-specific configuration is in `supabase/config.toml`; database changes are timestamped migrations. Do not assume a migration or function in Git has reached production: check the project's deployed migration/function state before making operational claims or applying changes. Add database changes as forward migrations; do not rewrite migrations already applied to production.

For more detail, see [AI collaborator context](docs/ai-context/README.md), especially its [security and data model](docs/ai-context/SECURITY.md) and [development and operations](docs/ai-context/DEVELOPMENT.md) guides.

## Current limitations

Pathway does not currently send recruiter notifications, scan uploaded resumes for malware, or provide bulk applicant export. Candidate confirmation e-mails only reach real candidates once a sending domain is verified in Resend; until then Resend delivers only to the account owner. The in-app privacy notice is not a substitute for a reviewed legal privacy policy.
