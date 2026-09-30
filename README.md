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
- Published jobs use immutable snapshots and public application links. Unpublishing or loss of paid access invalidates the active link.
- Candidate applications include routed answers, contact information, privacy acknowledgment and a PDF/DOC/DOCX resume (up to 10 MB). Applicants can be reviewed in a searchable, flow-filtered Kanban with New, Failed, Promising and Approved stages.
- Resumes are stored in a private Supabase Storage bucket. PDFs can be previewed in the app; downloads remain available. Access is scoped to the workspace.
- **My Team:** Premium workspaces can add up to three members at no additional seat charge. Owners assign Flows, Candidates and Team permissions. Invitations are copyable links, expire after seven days, and are bound to the invited email. Members can leave without deleting their account.
- **My Plan:** workspace owners can view plan status, start checkout, schedule cancellation or resume renewal, update payment methods through Stripe, and view payment history. Team members cannot access billing.
- Dashboard reports flow totals, new applicants and published flows.

## Architecture and security

The hiring UI is on `index.html`; the public application is served by `apply.html`. Frontend code is organized in `builder.js`, `backend.js`, `auth.js`, `candidate.js` and `pathway.js`. Supabase migrations live in `supabase/migrations/`; Edge Functions are `applications`, `team`, `billing` and `billing-webhook`.

RLS and server-side checks enforce workspace isolation and permissions; hidden UI controls are not security boundaries. Candidate rows cannot be inserted directly by the browser. The `applications` function validates public submissions against the active published flow. Resume storage is private. Invitation links require verified email matching and are single-use. Supabase publishable and Stripe publishable keys may be used in the browser; Supabase service-role keys and Stripe secret/webhook keys must remain server-side and must never be committed.

The configured subscription is **US$24.90/month**. Confirm Stripe test/live mode and server secrets before changing or accepting real payments. See [Stripe integration notes](STRIPE_INTEGRATION_TODO.md).

## Deployment

The static site is hosted on GitHub Pages from the repository root. Supabase project-specific configuration is in `supabase/config.toml`; database changes are timestamped migrations. Do not assume a migration or function in Git has reached production: check the project's deployed migration/function state before making operational claims or applying changes. Add database changes as forward migrations; do not rewrite migrations already applied to production.

For more detail, see [AI collaborator context](docs/ai-context/README.md), especially its [security and data model](docs/ai-context/SECURITY.md) and [development and operations](docs/ai-context/DEVELOPMENT.md) guides.

## Current limitations

Pathway does not currently send recruiter notifications or candidate receipt emails, scan uploaded resumes for malware, or provide bulk applicant export. The in-app privacy notice is not a substitute for a reviewed legal privacy policy.
