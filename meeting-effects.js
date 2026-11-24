/* Background effects of the Nellio meeting room (plano-reunioes.md, Phase 1b): blur the background or put an image behind the person.
   Everything runs in the browser of the person (MediaPipe selfie segmenter, self-hosted in vendor/mediapipe, Apache 2.0): no video and no
   image leaves the device. The camera is drawn on a canvas, the background is replaced, and the canvas becomes the video that is sent.

   NellioEffects.create(cameraStream, { mode: 'blur' | 'image', image, phone, onSlow }) → { stream, setMode(mode, image), setSource(stream), stats(), stop() }
   The returned stream has the processed video and the ORIGINAL audio tracks. 'none' is not an effect: the caller just uses the camera itself.
   NellioEffects.lastStats keeps the numbers of the last effect (for "Copy connection details"), also after it was turned off. */
(function (root) {
  const MEDIAPIPE_VERSION = '1.2.2';
  const WORKER_VERSION = 'mw3-20261124l';
  const base = () => new URL('vendor/mediapipe/', document.baseURI).href;
  const segmenters = {};

  /** Loads the model once per page and per kind of processing (about 15 MB the first time; the browser caches it).
      'GPU' falls back to 'CPU' when the graphics card cannot be used. */
  function loadSegmenter(delegate = 'GPU') {
    if (!segmenters[delegate]) {
      segmenters[delegate] = (async () => {
        const vision = await import(base() + 'vision_bundle.mjs');
        const files = await vision.FilesetResolver.forVisionTasks(base() + 'wasm');
        const options = kind => ({ baseOptions: { modelAssetPath: base() + 'selfie_segmenter.tflite', delegate: kind }, runningMode: 'VIDEO', outputCategoryMask: false, outputConfidenceMasks: true });
        if (delegate === 'CPU') return { segmenter: await vision.ImageSegmenter.createFromOptions(files, options('CPU')), delegate: 'CPU' };
        try { return { segmenter: await vision.ImageSegmenter.createFromOptions(files, options('GPU')), delegate: 'GPU' }; }
        catch (_) { return { segmenter: await vision.ImageSegmenter.createFromOptions(files, options('CPU')), delegate: 'CPU' }; }
      })();
      segmenters[delegate].catch(() => { delete segmenters[delegate]; });
    }
    return segmenters[delegate];
  }

  /** Starts the model in a worker (phones). Resolves to { worker } or to null when it cannot start (old browser, error, 20 s). */
  function startHelper() {
    return new Promise(resolve => {
      let worker;
      try {
        if (typeof OffscreenCanvas === 'undefined' || typeof createImageBitmap !== 'function') return resolve(null);
        worker = new Worker(new URL('meeting-effects-worker.js?v=' + WORKER_VERSION, document.baseURI).href, { type: 'module' });
      } catch (_) { return resolve(null); }
      const give = ok => { clearTimeout(limit); if (!ok) worker.terminate(); resolve(ok ? { worker } : null); };
      const limit = setTimeout(() => give(false), 20000);
      worker.onmessage = event => give(event.data && event.data.type === 'ready');
      worker.onerror = () => give(false);
      worker.postMessage({ type: 'init', base: base(), model: 'selfie_segmenter_landscape.tflite' });
    });
  }

  const supported = () => typeof HTMLCanvasElement !== 'undefined' && 'captureStream' in HTMLCanvasElement.prototype && typeof WebAssembly === 'object';
  const average = list => list.length ? list.reduce((a, b) => a + b, 0) / list.length : 0;

  async function create(cameraStream, options = {}) {
    const phone = !!options.phone;
    // Phones: the model runs in its own worker (see meeting-effects-worker.js), as Google Meet does, so a slow phone never freezes the
    // picture; if the worker cannot start, the model runs on the page with the processor. Computers use the graphics card on the page.
    const helper = phone ? await startHelper() : null;
    let { segmenter, delegate } = helper ? { segmenter: null, delegate: 'CPU-worker' } : await loadSegmenter(phone ? 'CPU' : 'GPU');
    let mode = options.mode === 'image' ? 'image' : 'blur';
    let image = options.image || null;
    const fps = phone ? 15 : 24;
    // On phones the model runs on every other picture and the last cut-out is reused in between: half the work, hardly visible.
    const modelEvery = phone ? 2 : 1;

    // The camera is played in a tiny, almost invisible video that IS on the page: Chrome on Android stops updating a video that is not
    // on the page, and then the model never saw the person (everything was blurred, the face too).
    const video = document.createElement('video');
    video.muted = true; video.playsInline = true; video.autoplay = true;
    video.setAttribute('aria-hidden', 'true');
    video.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0.01;pointer-events:none;z-index:-1';
    document.body.appendChild(video);
    const setSource = async stream => { cameraStream = stream; video.srcObject = new MediaStream(stream.getVideoTracks()); await video.play().catch(() => {}); };
    await setSource(cameraStream);
    await new Promise(done => { if (video.videoWidth) done(); else video.onloadedmetadata = () => done(); setTimeout(done, 3000); });

    const settings = cameraStream.getVideoTracks()[0]?.getSettings() || {};
    const width = video.videoWidth || settings.width || 640;
    const height = video.videoHeight || settings.height || 360;
    const out = Object.assign(document.createElement('canvas'), { width, height });
    const ctx = out.getContext('2d');
    // The model sees a small copy of the picture: cheaper, and the mask is smoothed when it is enlarged (softer edges).
    let scale = 0.4; // phones too: a smaller picture (160x90) was too small for the model to find the person
    const small = document.createElement('canvas');
    const smallCtx = small.getContext('2d');
    const mask = document.createElement('canvas');
    const maskCtx = mask.getContext('2d');
    const person = Object.assign(document.createElement('canvas'), { width, height });
    const personCtx = person.getContext('2d');
    const resize = () => { small.width = Math.max(64, Math.round(width * scale)); small.height = Math.max(36, Math.round(height * scale)); };
    resize();
    // Phones: the blur is made by shrinking the picture a lot and enlarging it again (very cheap). The blur filter of the canvas,
    // used on computers, is far too slow on a phone and froze the picture.
    // (a canvas one quarter of the size, blurred there, where the filter is cheap; shrinking alone looked blocky. Strength: 3 px there =
    // about 12 px on the picture, ~3% of its width; one eighth was twice as strong and the owner found it too much, 2026-11-24)
    const tiny = Object.assign(document.createElement('canvas'), { width: Math.max(16, Math.round(width / 4)), height: Math.max(12, Math.round(height / 4)) });
    const tinyCtx = tiny.getContext('2d');

    const drawCover = (target, img, w, h) => {
      const iw = img.width || img.videoWidth, ih = img.height || img.videoHeight;
      if (!iw || !ih) return;
      const s = Math.max(w / iw, h / ih);
      const dw = iw * s, dh = ih * s;
      target.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
    };

    let running = true;
    let busy = false;
    const times = [];
    const modelTimes = [];
    const coverage = [];
    let slowSince = 0;
    let last = 0;
    let timer = null;
    let count = 0;
    let haveMask = false;
    let switchedToCpu = false;
    let sentFrames = 0;
    const startedAt = performance.now();
    let held = null, pixels = null;
    const MASK_LOW = 0.2, MASK_HIGH = 0.55;
    // Measured 2026-11-24: this MediaPipe build reads a canvas upside down, so the model saw an upside-down person and was only
    // ~40% sure (a clear face gave 0.36 at most; turned over first, 1.0). On phones, where the person was not found at all, the
    // picture is turned over before the model and the cut-out turned back. Computers work well enough as they are (owner: keep them).
    // How much of the old cut-out a new one keeps where the model became less sure. Phones (worker): 0.3, so where the person was a
    // moment ago turns back to background quickly when they move (with 0.75 the real background showed around them for about a second).
    const KEEP = helper ? 0.3 : 0.75;
    const flip = phone && !helper; // the landscape model of the worker sees the picture the right way up (measured)

    function readMask(result) {
      const masks = result.confidenceMasks || [];
      const conf = masks[masks.length - 1]; // the person (a model with "background, person" gives two masks)
      if (conf) readValues(conf.getAsFloat32Array(), conf.width, conf.height);
    }

    function readValues(values, maskWidth, maskHeight) {
      if (mask.width !== maskWidth || mask.height !== maskHeight || !held || held.length !== values.length) {
        mask.width = maskWidth; mask.height = maskHeight;
        held = new Float32Array(values.length);
        pixels = maskCtx.createImageData(maskWidth, maskHeight);
      }
      // The model is often only "half sure" about the face and the hair (above all on a wall of a similar colour), and that
      // half certainty used as transparency made the person look like a ghost. So: (1) the certainty is held for a moment and
      // fades slowly, so a one-frame doubt does not erase the person; (2) a contrast curve turns "fairly sure" into fully visible.
      let sum = 0;
      for (let i = 0, j = 3; i < values.length; i++, j += 4) {
        const v = values[i];
        const h = held[i] = v >= held[i] ? v : held[i] * KEEP + v * (1 - KEEP);
        let a = (h - MASK_LOW) / (MASK_HIGH - MASK_LOW);
        a = a <= 0 ? 0 : a >= 1 ? 1 : a * a * (3 - 2 * a);
        pixels.data[j] = a * 255;
        sum += a;
      }
      maskCtx.putImageData(pixels, 0, 0);
      haveMask = true;
      coverage.push(sum / values.length); if (coverage.length > 30) coverage.shift();
    }

    function compose() {
      // 1) background: the camera blurred, or the chosen image
      if (mode === 'image' && image) drawCover(ctx, image, width, height);
      else if (phone) {
        tinyCtx.filter = 'blur(3px)'; tinyCtx.drawImage(video, 0, 0, tiny.width, tiny.height); tinyCtx.filter = 'none';
        ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(tiny, 0, 0, width, height);
      } else { ctx.filter = 'blur(14px)'; ctx.drawImage(video, 0, 0, width, height); ctx.filter = 'none'; }
      // 2) the person, cut out with the (enlarged) mask, on top; computers also soften the edge a little
      personCtx.globalCompositeOperation = 'copy';
      personCtx.drawImage(video, 0, 0, width, height);
      personCtx.globalCompositeOperation = 'destination-in';
      if (!phone) personCtx.filter = 'blur(2px)';
      if (flip) personCtx.setTransform(1, 0, 0, -1, 0, height);
      personCtx.drawImage(mask, 0, 0, width, height);
      if (flip) personCtx.setTransform(1, 0, 0, 1, 0, 0);
      personCtx.filter = 'none';
      personCtx.globalCompositeOperation = 'source-over';
      ctx.drawImage(person, 0, 0);
      sentFrames++;
    }

    function blurredOnly() {
      tinyCtx.filter = 'blur(3px)'; tinyCtx.drawImage(video, 0, 0, tiny.width, tiny.height); tinyCtx.filter = 'none';
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(tiny, 0, 0, width, height);
    }

    function frame() {
      if (!running) return;
      const now = performance.now();
      if (busy || now - last < 1000 / fps - 2 || video.readyState < 2) return;
      last = now; busy = true;
      try {
        if (helper) askHelper(now);
        else if (count++ % modelEvery === 0 || !haveMask) {
          if (flip) smallCtx.setTransform(1, 0, 0, -1, 0, small.height);
          smallCtx.drawImage(video, 0, 0, small.width, small.height);
          if (flip) smallCtx.setTransform(1, 0, 0, 1, 0, 0);
          const before = performance.now();
          segmenter.segmentForVideo(small, now, readMask);
          modelTimes.push(performance.now() - before); if (modelTimes.length > 30) modelTimes.shift();
        }
        if (haveMask) compose();
        else if (phone) blurredOnly(); // while the first cut-out is not ready: the whole picture blurred, never a black square
      } catch (error) { console.debug('[effects]', error && error.message); }
      finally { busy = false; }
      watchSpeed(performance.now() - now);
    }

    // The worker gets the small picture as a bitmap (handed over, not copied) whenever it is free; the page keeps drawing meanwhile.
    let helperBusy = false;
    function askHelper(now) {
      if (helperBusy) return;
      helperBusy = true;
      smallCtx.drawImage(video, 0, 0, small.width, small.height);
      createImageBitmap(small).then(bitmap => {
        if (!running) { bitmap.close(); helperBusy = false; return; }
        helper.worker.postMessage({ type: 'frame', bitmap, timestamp: now }, [bitmap]);
      }).catch(() => { helperBusy = false; });
    }
    if (helper) helper.worker.onmessage = event => {
      const data = event.data || {};
      if (data.type !== 'mask') return;
      helperBusy = false;
      modelTimes.push(data.ms || 0); if (modelTimes.length > 30) modelTimes.shift();
      if (running && data.values) readValues(data.values, data.width, data.height);
    };

    function stats() {
      const seconds = (performance.now() - startedAt) / 1000;
      return {
        mode, phone, delegate, model: helper ? 'landscape' : 'square', switchedToCpu, size: width + 'x' + height, modelInput: small.width + 'x' + small.height,
        frameMs: Math.round(average(times)), modelMs: Math.round(average(modelTimes)),
        personShare: Math.round(average(coverage) * 100) / 100, framesPerSecond: Math.round(sentFrames / Math.max(1, seconds) * 10) / 10,
      };
    }

    // A phone whose graphics card is slow or gives an empty cut-out: try the processor once before giving up.
    async function tryCpu() {
      if (switchedToCpu || delegate === 'CPU') return false;
      switchedToCpu = true;
      try {
        const cpu = await loadSegmenter('CPU');
        segmenter = cpu.segmenter; delegate = cpu.delegate;
        held = null; haveMask = false; times.length = 0; modelTimes.length = 0; coverage.length = 0; slowSince = 0;
        return true;
      } catch (_) { return false; }
    }

    // A device that cannot keep up: first a smaller picture for the model, then the processor instead of the graphics card (phones),
    // then the effect is turned off and the page is told.
    function watchSpeed(ms) {
      times.push(ms); if (times.length > 30) times.shift();
      if (times.length < 30) return;
      if (helper) {
        // With the worker the picture stays smooth even when the model is slow; only a model slower than 1.5 s turns the effect off.
        if (modelTimes.length >= 10 && average(modelTimes) > 1500) {
          slowSince = slowSince || performance.now();
          if (performance.now() - slowSince > 3000 && options.onSlow) { const report = options.onSlow; options.onSlow = null; root.NellioEffects.lastStats = stats(); report(); }
        } else slowSince = 0;
        return;
      }
      if (phone && coverage.length >= 30 && average(coverage) < 0.01 && delegate !== 'CPU') { tryCpu(); return; }
      if (average(times) > 1000 / fps) {
        if (scale > 0.2) { scale = Math.max(0.2, scale - 0.1); resize(); times.length = 0; return; }
        if (phone && delegate !== 'CPU' && !switchedToCpu) { tryCpu(); return; }
        slowSince = slowSince || performance.now();
        if (performance.now() - slowSince > 3000 && options.onSlow) { const report = options.onSlow; options.onSlow = null; root.NellioEffects.lastStats = stats(); report(); }
      } else slowSince = 0;
    }

    // The rhythm comes from a small Web Worker: the browser slows the timers of a hidden tab to about one per second (or less), which would
    // freeze the picture the others see when the person looks at another tab during the interview; a worker's timer keeps its pace.
    let ticker = null;
    try {
      const code = 'let t=null;onmessage=e=>{clearInterval(t);if(e.data>0)t=setInterval(()=>postMessage(0),e.data);};';
      ticker = new Worker(URL.createObjectURL(new Blob([code], { type: 'text/javascript' })));
      ticker.onmessage = () => { if (running) frame(); };
      ticker.postMessage(Math.round(1000 / fps));
    } catch (_) { ticker = null; }
    const loop = () => { if (!running) return; frame(); timer = requestAnimationFrame(loop); };
    if (!ticker) loop();

    const outStream = out.captureStream(fps);
    for (const track of cameraStream.getAudioTracks()) outStream.addTrack(track);

    return {
      stream: outStream,
      setMode(next, nextImage) { mode = next === 'image' ? 'image' : 'blur'; image = nextImage || (mode === 'image' ? image : null); },
      setSource,
      stats,
      stop() {
        if (!running) return;
        root.NellioEffects.lastStats = stats();
        running = false;
        cancelAnimationFrame(timer);
        if (ticker) { ticker.postMessage(0); ticker.terminate(); }
        if (helper) helper.worker.terminate();
        for (const track of outStream.getVideoTracks()) track.stop();
        video.srcObject = null;
        video.remove();
      },
    };
  }

  root.NellioEffects = { supported, create, load: loadSegmenter, version: MEDIAPIPE_VERSION, lastStats: null };
})(window);
