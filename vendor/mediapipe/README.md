# MediaPipe Tasks Vision (self-hosted)

Used by the Nellio meeting room (`meeting-effects.js`) to separate the person from the background (background blur and background images). Everything runs in the browser of the person: no video or image is sent to any server.

- Package: `@mediapipe/tasks-vision` **1.2.2** (npm, published 2026-11-03), license **Apache-2.0** (Google). Downloaded 2026-11-24 from `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.2/` with the owner's OK.
  - `vision_bundle.mjs` (sha256 `b65acb59b370cd6561afd9d04c29ed7a87e7ed6386922ac1b263af1f1ad06b7d`)
  - `wasm/vision_wasm_internal.js` (sha256 `f2b9c17131ea79716ec6bf07b117a087b2749a6f8a1e2f1f2e77a9382092db5b`)
  - `wasm/vision_wasm_internal.wasm` (14.6 MB, sha256 `f5bd25147ac89d506074293ce2675969b10e827180db95a0d9689c2ed80764ab`)
- Model: `selfie_segmenter.tflite` (float16, 0.25 MB, sha256 `191ac9529ae506ee0beefa6b2c945a172dab9d07d1e802a290a4e4038226658b`), from the official MediaPipe model store `https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite` (Apache-2.0, see the MediaPipe model card "Selfie Segmentation").

The files are loaded only when someone chooses a background effect, and the browser keeps them in its cache.

**To update:** download the same three files of a newer `@mediapipe/tasks-vision` version (at least two weeks old) into this folder, keep the folder layout, update the version here and in `meeting-effects.js` (`MEDIAPIPE_VERSION`), and test blur and images on a computer and a phone.
