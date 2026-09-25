# Pathway

**A clearer way to hire.** Pathway is a static, interactive prototype for designing job application journeys. It is intended for portfolio demonstration—not as a live hiring product.

## Try it

Open `index.html` from a static web server or publish the repository with GitHub Pages. There is no build step, package installation, backend, or authentication.

The builder includes a seeded **Senior Product Designer** example so the branching canvas is immediately explorable. Use **New flow** to create another job. Drafts are saved in the current browser.

## Files

- `index.html` — HR dashboard and visual flow builder.
- `apply.html` — standalone public job page and candidate flow.
- `pathway.js` — shared flow model, validation, branching traversal, local draft storage, and compressed URL encoding.
- `candidate.js` — shared landing, candidate-details form, interstitial, question, and completion experience.
- `builder.js` — dashboard, canvas interactions, step editing, preview, and publish action.
- `styles.css` — responsive shared visual system.

## Prototype behavior

- Create multiple job flows and edit company name, title, and description.
- The fixed Candidate Details step always collects name, email, and a resume file name. Optional fields can be selected per flow.
- Add short-text, single-choice (answer-specific branches), multi-choice, and end steps. Drag canvas nodes and connection handles.
- Preview the candidate experience before sharing.
- Publish a snapshot as `apply.html#data=...`. The flow JSON is compressed with the browser's built-in deflate stream when available and encoded in the link; a plain encoded fallback is used in older browsers.
- Candidate submissions are logged to the console and stored only in the current browser under `pathway:demo-submissions:v1`. The resume input is not uploaded; only its filename is collected.

## GitHub Pages

In the repository settings, choose **Pages → Deploy from a branch**, select `main` and `/ (root)`, and save. GitHub Pages serves the static files directly. Since `apply.html` uses a relative path, published links also work when the repository is hosted under a project subpath.

## Honest limitations

There is no candidate database, real resume upload/storage, email notification, user account, or cross-device synchronization. Drafts and demo submission records are local to one browser. Published links contain the full flow snapshot and can become long for unusually large flows. Do not enter real applicant information.
