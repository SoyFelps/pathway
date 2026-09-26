# Pathway

**A calmer, clearer way to hire.** Pathway is an early-access web app for creating thoughtful job pages and application flows. The current foundation adds authenticated company workspaces and cloud-saved flows on Supabase.

## Run the app

This repository is a static HTML/CSS/JavaScript app with no build step. Publish the root of `main` with GitHub Pages. `supabase-config.js` contains the project URL and browser-safe publishable key; the Supabase `service_role` key must never be placed in client code.

For local development, serve the repository root with any static file server (for example `python3 -m http.server 8000`). Authentication and data access still use the configured Supabase project.

Run the local checks with `node --test tests/*.test.js`.

## What is implemented

- Email/password sign-up and sign-in through Supabase Auth. A new account receives exactly one private workspace, created by a database trigger.
- Job-flow drafts are saved to Supabase under the authenticated owner’s workspace. Autosaves are debounced; the browser no longer acts as the primary data store.
- Workspace-scoped Row Level Security protects reading, creating, updating, and deleting drafts. Owners cannot create a flow under another workspace.
- Publish creates an immutable snapshot. The share link contains an unguessable snapshot ID; `apply.html` fetches the snapshot through a narrowly scoped public Postgres function, not from the private drafts table.
- Flows have a persisted Draft/Published status. The editor provides a **Copy job link** action while published. Unpublishing clears the active snapshot pointer, immediately invalidating its public link; republishing creates a new snapshot and link.
- The visual builder still supports a fixed candidate-details step, optional fields, draggable questions, branching answers, preview, and distinct completion paths.
- Public job applications collect the configured contact details, a required PDF/DOC/DOCX resume (10 MB maximum), and the exact answers reached in the published journey. Candidate details are validated against the active snapshot server-side before any applicant row is inserted.
- Candidate files live in a private `applicant-resumes` Storage bucket. Short-lived links are generated only after the authenticated workspace owner requests access. PDFs can be previewed inside the application; a separate download action remains available for every resume type. DOC/DOCX files are download-only. No third-party document viewer receives candidate files.
- The Applicants section has a job filter, search, four-stage Kanban (New, Failed, Promising, Approved), card drag-and-drop, and a full-height application review view. Candidate details and answers occupy the left pane; selecting **Preview resume** opens a private PDF in the full-height right pane. A separate download action remains available, and Word files are download-only. Disqualified flow endings start in Failed; other completed applications start in New.
- Applicants and resume reads are scoped to the authenticated workspace by RLS. Only the status column can be changed through the authenticated client. Public visitors cannot query the private applicant table or bucket.
- Deleting a job pauses its public intake, removes its private resume files, and then cascades the flow, snapshots, and applicant records. The deletion flow explicitly warns that the operation is permanent.
- A privacy notice and required acknowledgment appear before candidates proceed. Applications are used for role selection, visible only to the hiring workspace, retained while the job exists, and no email receipt/notification is sent in this first release.

## Database migration

The migrations are under `supabase/migrations/`. They create `workspaces`, `application_flows`, `published_flows`, and `applicants`; add owner RLS, private resume Storage policies, flow lifecycle fields, bounded intake rate limiting, and a database trigger that accepts applications only for the currently active published snapshot. Applicant data is inserted by the `applications` Supabase Edge Function; the client does not receive an insert grant.

Deploy or update the public Edge Function using the Supabase dashboard or `supabase functions deploy applications --no-verify-jwt`. It is intentionally deployed with platform JWT verification disabled because applicants are not logged in; the function implements custom publishable-key/origin checks, server-side form and branch validation, and separately verifies the authenticated owner before flow deletion. It uses the Edge Function's server-only Supabase service key and must never be copied into `supabase-config.js`.

## Important configuration

Before using a deployed site, configure Supabase Auth’s **Site URL** and allowed **Redirect URLs** for the exact GitHub Pages origin and repository path. The app sends confirmation links to its current page. Configure email delivery and confirmation policies in Supabase Auth as appropriate for the launch.

The currently selected project is **PathwayAPP**. The publishable key committed in `supabase-config.js` is intentionally public. Security relies on Auth, RLS, and the restricted publish RPC—not secrecy of that key. Never use a service-role/secret key in the browser.

## Deliberate limits in this first backend phase

Each user owns one workspace; team invites and multiple-workspace membership are not implemented. Applications do not send confirmation emails, notify recruiters by email, scan uploaded files for malware, or support bulk export/deletion. The intake endpoint limits resumes to PDF/DOC/DOCX under 10 MB and rate-limits public attempts. The privacy notice is product copy, not a substitute for your legal privacy policy; add a reviewed policy URL before broad production hiring use. Use test candidate data while the product is in early access.
