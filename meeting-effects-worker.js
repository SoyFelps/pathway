/* Background effects of the Nellio meeting room: the model that finds the person, running OUTSIDE the page (a module Web Worker).
   Used on phones (plano-reunioes.md, Phase 1b), as Google Meet does: the model is the slow part, and here it never freezes the picture,
   the buttons or the sound; the page keeps drawing with the last cut-out while the next one is being made.

   Messages in:  { type: 'init', base, model }            → { type: 'ready', delegate } or { type: 'error', message }
                 { type: 'frame', bitmap, timestamp }      → { type: 'mask', values (Float32Array), width, height, ms }
   The bitmap is transferred (not copied) and closed here. */
let segmenter = null;

self.onmessage = async event => {
  const data = event.data || {};
  if (data.type === 'init') {
    try {
      const vision = await import(data.base + 'vision_bundle.mjs');
      const files = await vision.FilesetResolver.forVisionTasks(data.base + 'wasm');
      // A module worker has no importScripts, which MediaPipe uses to load its WebAssembly loader ("ModuleFactory not set").
      // So the loader (our own self-hosted copy) is run here first, in the worker's global scope, and MediaPipe finds it.
      if (!self.ModuleFactory) {
        const loader = await (await fetch(files.wasmLoaderPath)).text();
        (0, eval)(loader + '\n;self.ModuleFactory = self.ModuleFactory || (typeof ModuleFactory !== "undefined" ? ModuleFactory : undefined);');
      }
      segmenter = await vision.ImageSegmenter.createFromOptions(files, {
        baseOptions: { modelAssetPath: data.base + data.model, delegate: 'CPU' },
        canvas: new OffscreenCanvas(1, 1),
        runningMode: 'VIDEO', outputCategoryMask: false, outputConfidenceMasks: true,
      });
      self.postMessage({ type: 'ready', delegate: 'CPU-worker' });
    } catch (error) { self.postMessage({ type: 'error', message: String(error && error.message || error) }); }
    return;
  }
  if (data.type === 'frame') {
    const bitmap = data.bitmap;
    if (!segmenter) { bitmap.close(); return; }
    const started = performance.now();
    try {
      let reply = null;
      segmenter.segmentForVideo(bitmap, data.timestamp, result => {
        const masks = result.confidenceMasks || [];
        const conf = masks[masks.length - 1];
        if (conf) reply = { type: 'mask', values: conf.getAsFloat32Array().slice(), width: conf.width, height: conf.height };
      });
      if (reply) { reply.ms = performance.now() - started; self.postMessage(reply, [reply.values.buffer]); }
      else self.postMessage({ type: 'mask', values: null, ms: performance.now() - started });
    } catch (error) {
      self.postMessage({ type: 'mask', values: null, ms: performance.now() - started, error: String(error && error.message || error) });
    } finally { bitmap.close(); }
  }
};
