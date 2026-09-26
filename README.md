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
- Flows have a persisted Draft/Published status. Unpublishing clears the active snapshot pointer, immediately invalidating its public link; republishing creates a new snapshot and link.
- The visual builder still supports a fixed candidate-details step, optional fields, draggable questions, branching answers, preview, and distinct completion paths.

## Database migration

The migrations create `workspaces`, `application_flows`, and `published_flows`; add the first-account workspace trigger; enable RLS; and add flow publication lifecycle fields. Public and authenticated clients can call the published-snapshot lookup function, but it returns data only for the flow's currently active token. Keep applicant-submission tables private until a dedicated submission, anti-abuse, privacy, and retention design is implemented.

## Important configuration

Before using a deployed site, configure Supabase Auth’s **Site URL** and allowed **Redirect URLs** for the exact GitHub Pages origin and repository path. The app sends confirmation links to its current page. Configure email delivery and confirmation policies in Supabase Auth as appropriate for the launch.

The currently selected project is **PathwayAPP**. The publishable key committed in `supabase-config.js` is intentionally public. Security relies on Auth, RLS, and the restricted publish RPC—not secrecy of that key. Never use a service-role/secret key in the browser.

## Deliberate limits in this first backend phase

Each user owns one workspace; team invites and multiple-workspace membership are not implemented. Public candidate pages are demos: candidate details and answers are not stored or sent to employers, and resume files are not uploaded. There is no applicant database, email workflow, billing, audit/history UI, or account recovery interface yet. Use test data only until the candidate-submission phase and privacy notices are designed.
