# pdf.js (self-hosted)

Mozilla's open-source PDF renderer, version **3.11.174** (Apache License 2.0, see `LICENSE`).

- Files: `pdf.min.js` and `pdf.worker.min.js`, copied unchanged from
  `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/` (the official `pdfjs-dist` build).
- Why it is here: phone browsers (for example Chrome on Android) have no built-in PDF viewer inside a page, so the
  resume preview draws the pages itself. Hosting the files in this repository means resumes are never sent to a
  third-party viewer and no external script is loaded.
- It is loaded only when needed (see `loadPdfJs` in `builder.js`).
- To update: replace both files with the same version of `pdfjs-dist`, change the `PDFJS_VERSION` constant in
  `builder.js` and the `?v=` used for cache busting.
