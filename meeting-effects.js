/* Background effects of the Nellio meeting room (plano-reunioes.md, Phase 1b): blur the background or put an image behind the person.
   Everything runs in the browser of the person (MediaPipe selfie segmenter, self-hosted in vendor/mediapipe, Apache 2.0): no video and no
   image leaves the device. The camera is drawn on a canvas, the background is replaced, and the canvas becomes the video that is sent.

   NellioEffects.create(cameraStream, { mode: 'blur' | 'image', image, phone, onSlow }) → { stream, setMode(mode, image), setSource(stream), stop() }
   The returned stream has the processed video and the ORIGINAL audio tracks. 'none' is not an effect: the caller just uses the camera itself. */
(function (root) {
  const MEDIAPIPE_VERSION = '1.2.2';
  const base = () => new URL('vendor/mediapipe/', document.baseURI).href;
  let segmenterPromise = null;

  /** Loads the model once per page (about 15 MB the first time; the browser caches it). GPU first, the processor as a fallback. */
  function loadSegmenter() {
    if (!segmenterPromise) {
      segmenterPromise = (async () => {
        const vision = await import(base() + 'vision_bundle.mjs');
        const files = await vision.FilesetResolver.forVisionTasks(base() + 'wasm');
        const options = delegate => ({ baseOptions: { modelAssetPath: base() + 'selfie_segmenter.tflite', delegate }, runningMode: 'VIDEO', outputCategoryMask: false, outputConfidenceMasks: true });
        try { return await vision.ImageSegmenter.createFromOptions(files, options('GPU')); }
        catch (_) { return await vision.ImageSegmenter.createFromOptions(files, options('CPU')); }
      })();
      segmenterPromise.catch(() => { segmenterPromise = null; });
    }
    return segmenterPromise;
  }

  const supported = () => typeof HTMLCanvasElement !== 'undefined' && 'captureStream' in HTMLCanvasElement.prototype && typeof WebAssembly === 'object';

  async function create(cameraStream, options = {}) {
    const segmenter = await loadSegmenter();
    let mode = options.mode === 'image' ? 'image' : 'blur';
    let image = options.image || null;
    const phone = !!options.phone;
    const fps = phone ? 20 : 24;

    const video = document.createElement('video');
    video.muted = true; video.playsInline = true; video.autoplay = true;
    const setSource = async stream => { cameraStream = stream; video.srcObject = new MediaStream(stream.getVideoTracks()); await video.play().catch(() => {}); };
    await setSource(cameraStream);
    await new Promise(done => { if (video.videoWidth) done(); else video.onloadedmetadata = () => done(); setTimeout(done, 3000); });

    const settings = cameraStream.getVideoTracks()[0]?.getSettings() || {};
    const width = video.videoWidth || settings.width || 640;
    const height = video.videoHeight || settings.height || 360;
    const out = Object.assign(document.createElement('canvas'), { width, height });
    const ctx = out.getContext('2d');
    // The model sees a small copy of the picture: cheaper, and the mask is smoothed when it is enlarged (softer edges).
    let scale = phone ? 0.25 : 0.4;
    const small = document.createElement('canvas');
    const smallCtx = small.getContext('2d', { willReadFrequently: true });
    const mask = document.createElement('canvas');
    const maskCtx = mask.getContext('2d');
    const person = Object.assign(document.createElement('canvas'), { width, height });
    const personCtx = person.getContext('2d');
    const resize = () => { small.width = Math.max(64, Math.round(width * scale)); small.height = Math.max(36, Math.round(height * scale)); };
    resize();

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
    let slowSince = 0;
    let last = 0;
    let timer = null;
    let held = null, pixels = null;
    const MASK_LOW = 0.2, MASK_HIGH = 0.55;

    function frame() {
      if (!running) return;
      const now = performance.now();
      if (busy || now - last < 1000 / fps - 2 || video.readyState < 2) return;
      last = now; busy = true;
      try {
        smallCtx.drawImage(video, 0, 0, small.width, small.height);
        segmenter.segmentForVideo(small, now, result => {
          const masks = result.confidenceMasks || [];
          const conf = masks[masks.length - 1]; // the person (a model with "background, person" gives two masks)
          if (!conf) return;
          const values = conf.getAsFloat32Array();
          if (mask.width !== conf.width || mask.height !== conf.height || !held || held.length !== values.length) {
            mask.width = conf.width; mask.height = conf.height;
            held = new Float32Array(values.length);
            pixels = maskCtx.createImageData(conf.width, conf.height);
          }
          // The model is often only "half sure" about the face and the hair (above all on a wall of a similar colour), and that
          // half certainty used as transparency made the person look like a ghost. So: (1) the certainty is held for a moment and
          // fades slowly, so a one-frame doubt does not erase the person; (2) a contrast curve turns "fairly sure" into fully visible.
          for (let i = 0, j = 3; i < values.length; i++, j += 4) {
            const v = values[i];
            const h = held[i] = v >= held[i] ? v : held[i] * 0.75 + v * 0.25;
            let a = (h - MASK_LOW) / (MASK_HIGH - MASK_LOW);
            a = a <= 0 ? 0 : a >= 1 ? 1 : a * a * (3 - 2 * a);
            pixels.data[j] = a * 255;
          }
          maskCtx.putImageData(pixels, 0, 0);
          // 1) background: the camera blurred, or the chosen image
          if (mode === 'image' && image) drawCover(ctx, image, width, height);
          else { ctx.filter = `blur(${phone ? 10 : 14}px)`; ctx.drawImage(video, 0, 0, width, height); ctx.filter = 'none'; }
          // 2) the person, cut out with the (enlarged, slightly feathered) mask, on top
          personCtx.globalCompositeOperation = 'copy';
          personCtx.drawImage(video, 0, 0, width, height);
          personCtx.globalCompositeOperation = 'destination-in';
          personCtx.filter = 'blur(2px)';
          personCtx.drawImage(mask, 0, 0, width, height);
          personCtx.filter = 'none';
          personCtx.globalCompositeOperation = 'source-over';
          ctx.drawImage(person, 0, 0);
        });
      } catch (error) { console.debug('[effects]', error && error.message); }
      finally { busy = false; }
      watchSpeed(performance.now() - now);
    }

    // A device that cannot keep up: first a smaller picture for the model, then the effect is turned off and the page is told.
    function watchSpeed(ms) {
      times.push(ms); if (times.length > 30) times.shift();
      if (times.length < 30) return;
      const average = times.reduce((a, b) => a + b, 0) / times.length;
      if (average > 1000 / fps) {
        if (scale > 0.2) { scale = Math.max(0.2, scale - 0.1); resize(); times.length = 0; return; }
        slowSince = slowSince || performance.now();
        if (performance.now() - slowSince > 3000 && options.onSlow) { const report = options.onSlow; options.onSlow = null; report(); }
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
      stop() {
        running = false;
        cancelAnimationFrame(timer);
        if (ticker) { ticker.postMessage(0); ticker.terminate(); }
        for (const track of outStream.getVideoTracks()) track.stop();
        video.srcObject = null;
      },
    };
  }

  root.NellioEffects = { supported, create, load: loadSegmenter, version: MEDIAPIPE_VERSION };
})(window);
