/* Nellio meeting room page (meeting.html), Phase 1 of plano-reunioes.md. Anyone with the link joins (the secret after the #), no sign-in.
   Opening the page only SHOWS the room; the camera and microphone are asked for only after a click (Safari/iPhone rule), and the
   channel of the room and the TURN credentials are fetched only when the person enters. The video goes straight between the browsers
   (meeting-room.js); this page is the lobby, the room and every state around them. Every text follows the language of the JOB, like
   the answer page of the interview (i18n.js forLanguage). */
(function () {
  const I18N = window.PathwayI18n;
  const config = window.PATHWAY_SUPABASE_CONFIG || {};
  const FUNCTION_URL = `${String(config.url || '').replace(/\/$/, '')}/functions/v1/meetings`;
  const root = document.getElementById('meeting-app');
  let tr = I18N ? I18N.forLanguage(I18N.language) : { language: 'en', t: text => String(text) };
  const t = (text, vars) => tr.t(text, vars);
  const esc = value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const secret = String(window.location.hash || '').replace(/^#/, '').trim();
  // Phones start lower (360p, 24 fps, ~600 kbps): their mobile upload is small; computers send 720p (Phase 0 tests, 2026-11-23).
  const PHONE = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
  const VIDEO = PHONE ? { width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 24, max: 24 } } : { width: { ideal: 1280 }, height: { ideal: 720 } };
  const AUDIO = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
  let view = null;
  let stream = null; // what is sent: the camera itself, or the camera with the background effect
  let camera = null; // the camera and microphone as the browser gives them
  let effect = null; // NellioEffects pipeline while a background effect is on
  let effectNote = '';
  let bgBusy = false;
  let room = null;
  let supabase = null;
  let micOn = true, camOn = true;
  let wakeLock = null;
  let pollTimer = null;
  let deviceError = '';
  let checked = false; // the camera/microphone check is required before "Join" appears (owner decision, 2026-11-23)
  let meterStop = null;
  let closingTimer = null; // the 10-minute warning and the end of the meeting at the closing time
  let busy = false;
  let peers = [];
  const logLines = []; // what happened in the connections, for "Copy connection details" (support)

  // Phase 3: a person signed in to Nellio in this browser (the hiring team) sends the session along, so the server knows they are "team";
  // anyone else is the candidate. Only read here, never changed (no sign-in on this page).
  let authClient = null;
  async function sessionToken() {
    // First the session the app keeps in this browser (read directly: the Supabase client can wait on a lock for a long time); only when it
    // is missing or expired, the client (which can renew it), never for more than 2 seconds.
    try {
      const ref = new URL(config.url).hostname.split('.')[0];
      const saved = JSON.parse(localStorage.getItem(`sb-${ref}-auth-token`) || 'null');
      const session = saved && (saved.currentSession || saved);
      if (session && session.access_token && Number(session.expires_at || 0) * 1000 > Date.now() + 60000) return session.access_token;
      if (!session || !session.refresh_token) return '';
    } catch (_) { return ''; }
    try {
      if (!window.supabase || !config.url) return '';
      authClient = authClient || window.supabase.createClient(config.url, config.publishableKey, { auth: { persistSession: true, autoRefreshToken: false, detectSessionInUrl: false } });
      // never wait long for it: without an answer in 2 seconds the person is treated as the candidate (the page must not hang)
      const result = await Promise.race([authClient.auth.getSession(), new Promise(done => setTimeout(() => done(null), 2000))]);
      const data = result && result.data;
      return (data && data.session && data.session.access_token) || '';
    } catch (_) { return ''; }
  }
  async function headers(extra = {}) {
    const token = await sessionToken();
    return { apikey: config.publishableKey || '', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...extra };
  }

  async function call(body) {
    let result;
    try { result = await fetch(FUNCTION_URL, { method: 'POST', headers: await headers({ 'Content-Type': 'application/json' }), body: JSON.stringify(body) }); }
    catch (_) { throw new Error(t('Could not reach the meeting service. Check your connection and try again.')); }
    let payload = {};
    try { payload = await result.json(); } catch (_) { /* stable fallback below */ }
    if (!result.ok) { const error = new Error(payload.error || 'Something went wrong. Please try again.'); error.status = result.status; throw error; }
    return payload;
  }

  const localTime = (iso, options) => new Intl.DateTimeFormat(tr.language, options).format(new Date(iso));
  const whenText = () => view && view.startsAt ? localTime(view.startsAt, { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) : '';

  function shell(inner, wide) {
    const brand = view ? esc(view.companyName || t('Hiring team')) : '';
    return `<div class="candidate-app"><header class="candidate-header"><div class="candidate-header-brands"><a class="brand" href="./" aria-label="${t('Nellio home')}"><img class="brand-logo" src="brand/nellio-logo.svg" alt="Nellio"></a></div><span class="candidate-header-note">${brand || t('Interview')}</span></header><main class="${wide ? 'meeting-main is-wide' : 'meeting-main'}">${inner}</main><footer class="candidate-footer">${t('Powered by Nellio · A clearer way to hire')}</footer></div>`;
  }
  // When there is no picture, the tile shows the initials and the name (like other meeting apps); a struck microphone when muted.
  const initials = name => String(name || '').trim().split(/\s+/).filter(Boolean).slice(0, 2).map(word => word[0]).join('').toUpperCase() || '?';
  const MIC_OFF = '<svg class="meeting-mic-off" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M9 9v3a3 3 0 0 0 5.1 2.1M15 9.3V5a3 3 0 0 0-5.9-.7"/><path d="M19 11a7 7 0 0 1-1.2 3.9M5 11a7 7 0 0 0 11.1 5.7M12 18v3M3 3l18 18"/></svg>';
  const tileInner = (name, label) => '<video autoplay playsinline' + (label ? ' muted' : '') + '></video><div class="meeting-avatar"><span class="meeting-initials">' + esc(initials(name)) + '</span></div><span class="meeting-label">' + MIC_OFF + '<span class="meeting-name">' + esc(label || name) + '</span></span><span class="meeting-badge"></span>';
  const heading = () => `<div class="eyebrow">${t('Interview')}</div><h1 class="meeting-title">${esc(view.jobTitle || t('Interview'))}</h1><p class="meeting-sub">${esc(view.companyName || '')}${view.startsAt ? ' · ' + esc(whenText()) : ''}</p>`;

  function renderMessage(title, text, extra = '') {
    root.innerHTML = shell(`<section class="candidate-form-card meeting-card">${view ? heading() : ''}<div class="meeting-note"><strong>${title}</strong><p>${text}</p></div>${extra}</section>`);
  }

  function renderInvalid(text) {
    root.innerHTML = `<main class="invalid-screen"><section class="invalid-content"><div class="invalid-mark" aria-hidden="true">!</div><div class="eyebrow" style="margin-bottom:13px">${t('Link unavailable')}</div><h1>${t('This link is invalid or incomplete.')}</h1><p>${esc(text || t('This meeting link was not found.'))}</p><a class="btn btn-primary" href="./">${t('Back to Nellio')}</a></section></main>`;
  }

  // ---- Before the room is open, after it closed --------------------------------------------------------------------------
  function renderState() {
    clearTimeout(pollTimer);
    if (view.status === 'early') {
      renderMessage(t('The room is not open yet.'), t('It opens at {time}, 30 minutes before the interview.', { time: esc(localTime(view.opensAt, { hour: '2-digit', minute: '2-digit' })) }));
      pollTimer = setTimeout(load, Math.max(5000, Math.min(60000, Date.parse(view.opensAt) - Date.now() + 1000)));
    } else if (view.status === 'closed') renderMessage(t('This meeting room is closed.'), t('The room closes 2 hours after the interview starts. Contact the hiring team if you need a new time.'));
    else if (view.status === 'cancelled') renderMessage(t('This interview was cancelled.'), t('The hiring team may contact you about a new time.'));
    else if (view.status === 'refused') renderMessage(t('You refused the transcription.'), t('The hiring team was told. Contact them if you change your mind.'));
    else if (view.consentNeeded) renderConsent();
    else if (view.status === 'unscheduled') renderMessage(t('This interview has no date yet.'), t('The room opens 30 minutes before the interview, once it is scheduled.'));
    else renderLobby();
  }

  // ---- Transcription consent (Phase 3): the candidate accepts or refuses before entering; refusing = the interview is declined -------------
  function renderConsent(confirming = false) {
    const body = confirming
      ? '<p>' + t('If you refuse, you will not join the meeting and the interview will be marked as declined. Refuse the transcription?') + '</p><div class="meeting-actions"><button class="btn" type="button" id="consent-back">' + t('Back') + '</button><button class="btn btn-danger" type="button" id="consent-refuse-yes">' + t('Yes, refuse') + '</button></div>'
      : '<p>' + t('To help the hiring team, what is said in this meeting is transcribed and summarized by artificial intelligence. Only the hiring team sees the transcript, and the audio is deleted as soon as it is transcribed.') + '</p><p>' + t('You need to accept the transcription to join this interview.') + '</p><div class="meeting-actions"><button class="btn" type="button" id="consent-refuse">' + t('Refuse') + '</button><button class="btn btn-primary" type="button" id="consent-accept">' + t('Accept and continue') + '</button></div>';
    root.innerHTML = shell('<section class="candidate-form-card meeting-card">' + heading() + '<div class="meeting-note meeting-consent"><strong>' + t('This interview will be transcribed') + '</strong>' + body + '</div></section>');
    const answer = async (accept, button) => {
      button.disabled = true;
      try { await call({ action: 'consent', secret, accept }); await load(); }
      catch (error) { button.disabled = false; renderMessage(t('Could not save your answer.'), esc(t(error.message || 'Something went wrong. Please try again.')), '<div class="meeting-actions"><button class="btn btn-primary" type="button" id="meeting-retry">' + t('Try again') + '</button></div>'); document.getElementById('meeting-retry').addEventListener('click', load); }
    };
    document.getElementById('consent-accept')?.addEventListener('click', event => answer(true, event.currentTarget));
    document.getElementById('consent-refuse')?.addEventListener('click', () => renderConsent(true));
    document.getElementById('consent-back')?.addEventListener('click', () => renderConsent(false));
    document.getElementById('consent-refuse-yes')?.addEventListener('click', event => answer(false, event.currentTarget));
  }
  const transcriptionNote = () => !view || !view.transcription || view.transcriptionEnded ? '' : '<p class="meeting-hint meeting-transcribed">' + (view.role === 'team' ? t('This meeting is transcribed. The transcription starts by itself when the candidate and someone of the team are in the room.') : t('This meeting is transcribed. Only the hiring team sees the transcript.')) + '</p>';

  // ---- Lobby: name, camera preview, devices ----------------------------------------------------------------------------
  function deviceMessage(error) {
    const name = error && error.name;
    if (name === 'NotAllowedError' || name === 'SecurityError') return t('The browser blocked the camera and microphone. Allow them for this site (usually in the address bar) and try again.');
    if (name === 'NotReadableError' || name === 'AbortError') return t('Your camera or microphone is being used by another app. Close it and try again.');
    if (name === 'NotFoundError' || name === 'OverconstrainedError') return t('No camera or microphone was found. You can still join to see and hear the others.');
    return t('The camera and microphone could not be started. You can still join to see and hear the others.');
  }

  async function startDevices(cameraId, micId) {
    checked = true;
    deviceError = '';
    const video = cameraId ? { ...VIDEO, deviceId: { exact: cameraId } } : VIDEO;
    const audio = micId ? { ...AUDIO, deviceId: { exact: micId } } : AUDIO;
    try {
      const fresh = await navigator.mediaDevices.getUserMedia({ video, audio });
      stopCamera();
      camera = fresh;
    } catch (error) {
      // Without a camera, try the microphone alone before giving up.
      try { if (!camera) camera = await navigator.mediaDevices.getUserMedia({ audio }); deviceError = deviceMessage(error); }
      catch (_) { deviceError = deviceMessage(error); }
    }
    stream = camera;
    (await applyBackground())(); // the background chosen last time comes back by itself
  }

  // ---- Background (blur or an image behind the person, Phase 1b) ----------------------------------------------------------
  // The browser remembers the last choice (none, blur, an image of ours or the person's own image) and applies it in the next meeting.
  // The person's own image stays in this browser (IndexedDB), reduced to 1280x720 on the device: it is never sent to us. Phones: none or blur.
  const BG_KEY = 'nellio-meeting-background';
  const STOCK = () => [
    { id: 'office-elegant', label: t('Office') }, { id: 'office-elegant-desk', label: t('Office') }, { id: 'home-office', label: t('Home office') },
    { id: 'meeting-room', label: t('Meeting room') }, { id: 'meeting-room-desk', label: t('Meeting room') }, { id: 'lobby', label: t('Hotel lobby') },
    { id: 'nellio-forest', label: t('Nellio green') }, { id: 'nellio-mint', label: t('Nellio light') },
  ];
  let background = { kind: 'none' };
  try { const saved = JSON.parse(localStorage.getItem(BG_KEY) || 'null'); if (saved && ['none', 'blur', 'stock', 'custom'].includes(saved.kind)) background = saved; } catch (_) {}
  let customImage = null, customUrl = '';
  const choice = () => (PHONE && background.kind !== 'blur') ? { kind: 'none' } : background;
  const saveChoice = () => { try { localStorage.setItem(BG_KEY, JSON.stringify(background)); } catch (_) {} };
  const effectsReady = () => !!(window.NellioEffects && window.NellioEffects.supported());

  function idb() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('nellio-meeting', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('files');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  async function idbGet(key) { try { const db = await idb(); return await new Promise(done => { const q = db.transaction('files').objectStore('files').get(key); q.onsuccess = () => done(q.result || null); q.onerror = () => done(null); }); } catch (_) { return null; } }
  async function idbPut(key, value) { const db = await idb(); await new Promise((done, fail) => { const tx = db.transaction('files', 'readwrite'); tx.objectStore('files').put(value, key); tx.oncomplete = done; tx.onerror = () => fail(tx.error); }); }
  async function useCustomBlob(blob) {
    if (customUrl) URL.revokeObjectURL(customUrl);
    customUrl = URL.createObjectURL(blob);
    customImage = await createImageBitmap(blob);
  }
  const customLoaded = (async () => { if (PHONE) return; const blob = await idbGet('custom-background'); if (blob) { try { await useCustomBlob(blob); } catch (_) {} } })();

  /** A file chosen by the person, made 1280x720 (cover) and JPEG on the device, kept in this browser only. */
  async function storeCustom(file) {
    const bitmap = await createImageBitmap(file);
    const canvas = Object.assign(document.createElement('canvas'), { width: 1280, height: 720 });
    const g = canvas.getContext('2d');
    const scale = Math.max(1280 / bitmap.width, 720 / bitmap.height);
    g.drawImage(bitmap, (1280 - bitmap.width * scale) / 2, (720 - bitmap.height * scale) / 2, bitmap.width * scale, bitmap.height * scale);
    const blob = await new Promise(done => canvas.toBlob(done, 'image/jpeg', 0.85));
    if (!blob) throw new Error('image');
    await idbPut('custom-background', blob).catch(() => {});
    await useCustomBlob(blob);
  }

  const loadStock = id => new Promise((done, fail) => { const img = new Image(); img.onload = () => done(img); img.onerror = fail; img.src = 'brand/backgrounds/' + id + '.jpg'; });

  /** Makes "stream" match the background choice. Returns a cleanup to run once the new stream is in use (stops an effect no longer needed). */
  async function applyBackground() {
    const old = effect;
    const done = keep => () => { if (old && old !== keep) old.stop(); };
    if (!camera || !camera.getVideoTracks().length) { effect = null; stream = camera; return done(null); }
    const want = choice();
    if (want.kind === 'none' || !effectsReady()) { effect = null; stream = camera; return done(null); }
    let image = null;
    try {
      if (want.kind === 'stock') image = await loadStock(want.id);
      if (want.kind === 'custom') { await customLoaded; image = customImage; }
    } catch (_) { image = null; }
    if (want.kind !== 'blur' && !image) { background = { kind: 'none' }; saveChoice(); effect = null; stream = camera; return done(null); }
    const mode = want.kind === 'blur' ? 'blur' : 'image';
    try {
      if (!effect) effect = await window.NellioEffects.create(camera, { mode, image, phone: PHONE, onSlow: () => chooseBackground('none', t('Your device could not keep up with the background effect, so it was turned off.')) });
      else effect.setMode(mode, image);
      stream = effect.stream;
      return done(effect);
    } catch (error) {
      console.debug('[effects]', error && error.message);
      effectNote = t('The background effect could not be started.');
      background = { kind: 'none' }; saveChoice();
      effect = null; stream = camera;
      return done(null);
    }
  }

  const applyEnabled = () => { if (stream) { stream.getAudioTracks().forEach(track => { track.enabled = micOn; }); stream.getVideoTracks().forEach(track => { track.enabled = camOn; }); } };
  function showSelf() {
    const preview = document.getElementById('preview') || root.querySelector('[data-tile="me"] video');
    if (!preview) return;
    // Always given again (also when it looks the same) and played: on Android the preview stayed black after the effect was turned off.
    preview.srcObject = null;
    preview.srcObject = stream;
    preview.play().catch(() => {});
    const shown = stream;
    setTimeout(() => { if (stream === shown && preview.isConnected && !preview.videoWidth) { preview.srcObject = null; preview.srcObject = stream; preview.play().catch(() => {}); } }, 1500);
  }

  async function chooseBackground(key, note = '') {
    if (bgBusy) return;
    bgBusy = true;
    background = key === 'none' || key === 'blur' || key === 'custom' ? { kind: key } : { kind: 'stock', id: key.replace(/^stock:/, '') };
    saveChoice();
    effectNote = note || (background.kind !== 'none' && !effect ? t('Loading the background effect…') : '');
    paintPicker();
    try {
      const cleanup = await applyBackground();
      applyEnabled();
      if (room) await room.replaceStream(stream, { stop: false });
      showSelf();
      cleanup();
      if (effectNote === t('Loading the background effect…')) effectNote = '';
    } finally { bgBusy = false; paintPicker(); }
  }

  function backgroundPicker() {
    if (!camera || !camera.getVideoTracks().length || !effectsReady()) return '';
    const now = choice();
    const key = now.kind === 'stock' ? 'stock:' + now.id : now.kind;
    const option = (value, label, inner) => '<button type="button" class="meeting-bg-option' + (value === key ? ' is-selected' : '') + '" data-bg="' + esc(value) + '" aria-pressed="' + (value === key) + '" title="' + esc(label) + '" aria-label="' + esc(label) + '"' + (bgBusy ? ' disabled' : '') + '>' + inner + '</button>';
    const options = [
      option('none', t('No background effect'), '<span class="meeting-bg-none" aria-hidden="true"></span>'),
      option('blur', t('Blur'), '<span class="meeting-bg-blur" aria-hidden="true"></span>'),
    ];
    if (!PHONE) {
      if (customUrl) options.push(option('custom', t('Your image'), '<img src="' + esc(customUrl) + '" alt="">'));
      for (const item of STOCK()) options.push(option('stock:' + item.id, item.label, '<img src="brand/backgrounds/' + item.id + '-thumb.jpg" alt="" loading="lazy">'));
      options.push('<button type="button" class="meeting-bg-option is-upload" data-bg="upload" title="' + esc(t('Upload an image')) + '" aria-label="' + esc(t('Upload an image')) + '"' + (bgBusy ? ' disabled' : '') + '><span aria-hidden="true">+</span></button><input type="file" accept="image/jpeg,image/png,image/webp" hidden data-bg-file>');
    }
    return '<div class="meeting-bg"><span class="meeting-bg-title">' + t('Background') + '</span><div class="meeting-bg-options">' + options.join('') + '</div>'
      + (effectNote ? '<p class="meeting-bg-note" role="status">' + esc(effectNote) + '</p>' : '')
      + (PHONE ? '<p class="meeting-bg-note">' + t('On phones, only the blur is available.') + '</p>' : '') + '</div>';
  }

  function paintPicker() {
    for (const slot of root.querySelectorAll('[data-bg-slot]')) {
      slot.innerHTML = backgroundPicker();
      if (slot.dataset.bound) continue;
      slot.dataset.bound = '1';
      slot.addEventListener('click', event => {
        const button = event.target.closest('[data-bg]');
        if (!button || button.disabled) return;
        if (button.dataset.bg === 'upload') { slot.querySelector('[data-bg-file]')?.click(); return; }
        chooseBackground(button.dataset.bg);
      });
      slot.addEventListener('change', async event => {
        const input = event.target.closest('[data-bg-file]');
        if (!input || !input.files || !input.files[0]) return;
        try { await storeCustom(input.files[0]); await chooseBackground('custom'); }
        catch (_) { effectNote = t('This image could not be used. Try a JPG or PNG file.'); paintPicker(); }
      });
    }
  }

  function stopCamera() {
    if (effect) { effect.stop(); effect = null; }
    if (camera) for (const track of camera.getTracks()) track.stop();
    camera = null; stream = null;
  }

  async function deviceOptions() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return { cameras: [], mics: [] };
    const all = await navigator.mediaDevices.enumerateDevices().catch(() => []);
    return { cameras: all.filter(d => d.kind === 'videoinput' && d.label), mics: all.filter(d => d.kind === 'audioinput' && d.label) };
  }

  async function renderLobby() {
    let name = '';
    try { name = localStorage.getItem('nellio-meeting-name') || ''; } catch (_) {}
    const current = kind => camera && camera.getTracks().find(track => track.kind === kind);
    const { cameras, mics } = camera ? await deviceOptions() : { cameras: [], mics: [] };
    const select = (id, label, list, kind) => list.length > 1 ? `<label class="meeting-field"><span>${label}</span><select class="text-input" id="${id}">${list.map(d => `<option value="${esc(d.deviceId)}"${current(kind) && current(kind).getSettings().deviceId === d.deviceId ? ' selected' : ''}>${esc(d.label)}</option>`).join('')}</select></label>` : '';
    stopMeter();
    const hasMic = !!current('audio');
    root.innerHTML = shell(`<section class="candidate-form-card meeting-card">${heading()}
      <div class="meeting-preview">${stream && current('video') ? '<video id="preview" autoplay playsinline muted></video>' : `<div class="meeting-preview-empty">${stream ? t('Camera off') : t('Your camera is not on yet.')}</div>`}</div>
      <div data-bg-slot></div>
      ${hasMic ? `<div class="meeting-meter"><span>${t('Microphone')}</span><div class="meeting-meter-track" role="meter" aria-label="${t('Microphone level')}" aria-valuemin="0" aria-valuemax="100"><div class="meeting-meter-fill" id="meeting-meter"></div></div><small>${t('Speak to see the bar move.')}</small></div>` : ''}
      ${deviceError ? `<div class="ai-note is-warn" role="alert">${esc(deviceError)}</div>` : ''}
      <div class="meeting-fields">
        <label class="meeting-field"><span>${t('Your name')}</span><input class="text-input" id="meeting-name" maxlength="40" autocomplete="name" value="${esc(name)}"></label>
        ${select('meeting-camera', t('Camera'), cameras, 'video')}${select('meeting-mic', t('Microphone'), mics, 'audio')}
      </div>
      ${transcriptionNote()}
      <p class="meeting-hint">${!checked ? t('Before joining, check your camera and microphone. The browser will ask for permission to use them.') : stream ? t('Your camera and microphone will be on when you join. You can turn them off in the room.') : ''}</p>
      <div class="meeting-actions">${!checked ? `<button class="btn btn-primary" type="button" id="meeting-check">${t('Check camera and microphone')}</button>` : `${deviceError ? `<button class="btn" type="button" id="meeting-check">${t('Check again')}</button>` : ''}<button class="btn btn-primary" type="button" id="meeting-join">${t('Join the meeting')}</button>`}</div>
    </section>`);
    const preview = document.getElementById('preview');
    if (preview) { preview.srcObject = stream; preview.play().catch(() => {}); }
    if (hasMic) startMeter();
    paintPicker();
    const reselect = async () => { await startDevices(document.getElementById('meeting-camera')?.value, document.getElementById('meeting-mic')?.value); rememberName(); renderLobby(); };
    document.getElementById('meeting-camera')?.addEventListener('change', reselect);
    document.getElementById('meeting-mic')?.addEventListener('change', reselect);
    document.getElementById('meeting-check')?.addEventListener('click', async event => { const button = event.currentTarget; button.disabled = true; button.textContent = t('Checking…'); rememberName(); await startDevices(); renderLobby(); });
    document.getElementById('meeting-join')?.addEventListener('click', join);
  }

  // A live microphone level in the lobby, so the person sees the microphone works before joining.
  function startMeter() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const audio = new AudioCtx();
      const source = audio.createMediaStreamSource(new MediaStream(camera.getAudioTracks()));
      const analyser = audio.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      const data = new Uint8Array(analyser.fftSize);
      let frame = 0;
      const draw = () => {
        analyser.getByteTimeDomainData(data);
        let peak = 0;
        for (const value of data) peak = Math.max(peak, Math.abs(value - 128));
        const level = Math.min(100, Math.round(peak / 128 * 220));
        const bar = document.getElementById('meeting-meter');
        if (!bar) { stopMeter(); return; }
        bar.style.width = level + '%';
        bar.parentElement.setAttribute('aria-valuenow', String(level));
        frame = requestAnimationFrame(draw);
      };
      draw();
      meterStop = () => { cancelAnimationFrame(frame); source.disconnect(); audio.close().catch(() => {}); };
    } catch (_) { /* no level bar; the check still worked */ }
  }
  function stopMeter() { if (meterStop) { const stop = meterStop; meterStop = null; stop(); } }

  function rememberName() {
    const input = document.getElementById('meeting-name');
    if (input) try { localStorage.setItem('nellio-meeting-name', input.value.trim()); } catch (_) {}
  }

  // ---- The room ---------------------------------------------------------------------------------------------------------
  async function join() {
    if (busy || !checked) return;
    stopMeter();
    const input = document.getElementById('meeting-name');
    const name = (input && input.value.trim()) || '';
    if (!name) { input && input.focus(); input && input.classList.add('is-invalid'); return; }
    rememberName();
    busy = true;
    const button = document.getElementById('meeting-join');
    if (button) { button.disabled = true; button.textContent = t('Joining…'); }
    try {
      const { room: entered } = await call({ action: 'join', secret, enter: true });
      view = entered;
      if (view.status !== 'open' || !view.channel) { busy = false; renderState(); return; }
      supabase = supabase || window.supabase.createClient(config.url, config.publishableKey, { auth: { persistSession: false, autoRefreshToken: false }, realtime: { params: { eventsPerSecond: 20 } } });
      const iceServers = [{ urls: 'stun:stun.cloudflare.com:3478' }, { urls: 'stun:stun.l.google.com:19302' }].concat(view.iceServers || []);
      room = window.NellioRoom.createRoom({ supabase, channelName: view.channel, name, role: view.role, iceServers, videoMaxBitrate: PHONE ? 600000 : 0, on: onRoomEvent });
      await room.join(stream);
      peers = room.peers();
      myName = name;
      renderRoom(name);
      checkRecording();
      if ('wakeLock' in navigator) navigator.wakeLock.request('screen').then(lock => { wakeLock = lock; }).catch(() => {});
    } catch (error) {
      room = null;
      renderMessage(t('Could not join the meeting.'), esc(t(error.message || 'Something went wrong. Please try again.')), `<div class="meeting-actions"><button class="btn btn-primary" type="button" id="meeting-retry">${t('Try again')}</button></div>`);
      document.getElementById('meeting-retry').addEventListener('click', () => { renderLobby(); });
    } finally { busy = false; }
  }

  function onRoomEvent(event, detail) {
    if (event === 'log') { logLines.push(new Date().toISOString().slice(11, 19) + '  ' + detail.text); if (logLines.length > 300) logLines.shift(); console.debug('[meeting]', detail.text); return; }
    if (event === 'peers') { peers = detail; paintPeople(); checkRecording(); return; }
    if (event === 'notice' && detail && detail.kind === 'transcription-ended') { transcriptionEnded(); return; }
    if (event === 'full') { room = null; renderMessage(t('This meeting is full.'), t('Up to {count} people can be in the room at the same time.', { count: view.maxPeople || 4 })); return; }
  }

  function renderRoom(name) {
    root.innerHTML = shell(`<section class="meeting-room">
      <div class="ai-note is-warn meeting-closing" id="meeting-closing" role="status" hidden></div>
      <div class="meeting-room-head"><div><strong>${esc(view.jobTitle || t('Interview'))}</strong><span>${esc(view.companyName || '')}</span></div><span class="meeting-head-side"><span class="meeting-rec" id="meeting-rec" hidden>${t('Transcribing')}</span><span class="meeting-status" id="meeting-status"></span></span></div>
      <div class="meeting-grid" id="meeting-grid"><div class="meeting-tile is-me" data-tile="me">${tileInner(name, t('{name} (you)', { name }))}</div></div>
      <div class="meeting-controls">
        <button class="btn" type="button" id="meeting-mic-toggle" aria-pressed="false"${stream && stream.getAudioTracks().length ? '' : ' disabled'}>${t('Mute')}</button>
        <button class="btn" type="button" id="meeting-cam-toggle" aria-pressed="false"${stream && stream.getVideoTracks().length ? '' : ' disabled'}>${t('Turn camera off')}</button>
        ${camera && camera.getVideoTracks().length && effectsReady() ? `<button class="btn" type="button" id="meeting-bg-toggle" aria-expanded="false" aria-controls="meeting-bg-panel">${t('Background')}</button>` : ''}
        ${view.role === 'team' && view.transcription && !view.transcriptionEnded ? `<button class="btn" type="button" id="meeting-end-transcription">${t('End transcription')}</button>` : ''}
        <button class="btn btn-danger" type="button" id="meeting-leave">${t('Leave')}</button>
      </div>
      <div class="meeting-bg-panel" id="meeting-bg-panel" data-bg-slot hidden></div>
      <div class="meeting-support"><button class="meeting-copy" type="button" id="meeting-copy">${t('Copy connection details')}</button></div>
    </section>`, true);
    const me = root.querySelector('[data-tile="me"] video');
    me.srcObject = stream || new MediaStream(); me.play().catch(() => {});
    if (!stream || !stream.getVideoTracks().length) root.querySelector('[data-tile="me"]').classList.add('is-off');
    if (!stream || !stream.getAudioTracks().length) root.querySelector('[data-tile="me"]').classList.add('is-muted');
    document.getElementById('meeting-mic-toggle').addEventListener('click', event => { micOn = !micOn; room && room.setMic(micOn); event.currentTarget.textContent = micOn ? t('Mute') : t('Unmute'); event.currentTarget.setAttribute('aria-pressed', String(!micOn)); root.querySelector('[data-tile="me"]').classList.toggle('is-muted', !micOn); });
    document.getElementById('meeting-cam-toggle').addEventListener('click', event => { camOn = !camOn; room && room.setCam(camOn); event.currentTarget.textContent = camOn ? t('Turn camera off') : t('Turn camera on'); event.currentTarget.setAttribute('aria-pressed', String(!camOn)); root.querySelector('[data-tile="me"]').classList.toggle('is-off', !camOn); });
    document.getElementById('meeting-leave').addEventListener('click', leave);
    document.getElementById('meeting-end-transcription')?.addEventListener('click', async event => {
      const button = event.currentTarget;
      if (button.dataset.confirm !== '1') { button.dataset.confirm = '1'; button.textContent = t('End it? Click again'); setTimeout(() => { if (button.isConnected && button.dataset.confirm === '1') { button.dataset.confirm = ''; button.textContent = t('End transcription'); } }, 5000); return; }
      button.disabled = true;
      try { await stopRecording(true); await call({ action: 'end', secret }); if (room) room.notice({ kind: 'transcription-ended' }); transcriptionEnded(); }
      catch (error) { button.disabled = false; button.dataset.confirm = ''; button.textContent = t('End transcription'); }
    });
    document.getElementById('meeting-bg-toggle')?.addEventListener('click', event => { const panel = document.getElementById('meeting-bg-panel'); panel.hidden = !panel.hidden; event.currentTarget.setAttribute('aria-expanded', String(!panel.hidden)); });
    paintPicker();
    watchClosing();
    document.getElementById('meeting-copy').addEventListener('click', async event => {
      const button = event.currentTarget;
      const report = { when: new Date().toISOString(), userAgent: navigator.userAgent, phone: PHONE, peers: room ? room.peers().map(({ stream: _s, ...p }) => p) : [], stats: room ? await room.stats().catch(() => []) : [], background: choice().kind, effect: effect ? effect.stats() : (window.NellioEffects && window.NellioEffects.lastStats) || null, log: logLines.slice(-120) };
      try { await navigator.clipboard.writeText(JSON.stringify(report, null, 2)); button.textContent = t('Copied'); }
      catch (_) { button.textContent = t('Could not copy'); }
      setTimeout(() => { button.textContent = t('Copy connection details'); }, 2500);
    });
    paintPeople();
  }

  function paintPeople() {
    const grid = document.getElementById('meeting-grid');
    if (!grid) return;
    const ids = new Set(peers.map(p => p.id));
    grid.querySelectorAll('[data-tile]').forEach(el => { if (el.dataset.tile !== 'me' && !ids.has(el.dataset.tile)) el.remove(); });
    for (const person of peers) {
      let tile = grid.querySelector(`[data-tile="${CSS.escape(person.id)}"]`);
      if (!tile) {
        tile = document.createElement('div');
        tile.className = 'meeting-tile'; tile.dataset.tile = person.id;
        tile.innerHTML = tileInner(person.name, '');
        tile.querySelector('video').addEventListener('resize', paintPeople);
        grid.appendChild(tile);
      }
      const video = tile.querySelector('video');
      if (video.srcObject !== person.stream) { video.srcObject = person.stream; video.play().catch(() => {}); }
      tile.querySelector('.meeting-name').textContent = person.name;
      tile.querySelector('.meeting-initials').textContent = initials(person.name);
      const picture = person.stream.getVideoTracks().some(track => track.readyState === 'live' && !track.muted);
      tile.classList.toggle('is-off', !person.cam || !picture);
      tile.classList.toggle('is-muted', !person.mic);
      const trouble = person.state === 'disconnected' || person.state === 'failed';
      tile.querySelector('.meeting-badge').textContent = trouble ? t('Reconnecting…') : (person.state === 'connected' ? '' : t('Connecting…'));
    }
    grid.dataset.count = String(peers.length + 1);
    const status = document.getElementById('meeting-status');
    if (status) status.textContent = peers.length ? tr.tn('{count} other person in the room', '{count} other people in the room', peers.length) : t('Waiting for the others to join…');
  }

  // 10 minutes before the room closes, a warning with the minutes left; at the closing time the meeting ends for everyone in it.
  function watchClosing() {
    clearInterval(closingTimer);
    if (!view || !view.closesAt) return;
    const closesAt = Date.parse(view.closesAt);
    const tick = () => {
      const left = closesAt - Date.now();
      if (left <= 0) { clearInterval(closingTimer); endMeeting(); return; }
      const box = document.getElementById('meeting-closing');
      if (!box) { clearInterval(closingTimer); return; }
      if (left <= 10 * 60000) {
        const minutes = Math.max(1, Math.ceil(left / 60000));
        box.textContent = tr.tn('This room closes in {count} minute, at {time}.', 'This room closes in {count} minutes, at {time}.', minutes, { time: localTime(view.closesAt, { hour: '2-digit', minute: '2-digit' }) });
        box.hidden = false;
      }
    };
    tick();
    closingTimer = setInterval(tick, 5000);
  }

  function endMeeting() {
    stopRecording(true);
    if (room) room.leave();
    stopCamera();
    room = null; peers = []; checked = false;
    if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
    view = { ...view, status: 'closed' };
    renderMessage(t('This meeting room is closed.'), t('The room closes 2 hours after the interview starts. Contact the hiring team if you need a new time.'));
  }

  async function leave() {
    clearInterval(closingTimer);
    await stopRecording(true);
    if (room) room.leave();
    stopCamera(); // the camera itself, and the background effect that was sending a copy of it
    room = null; peers = [];
    checked = false;
    if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
    renderMessage(t('You left the meeting.'), t('You can join again while the room is open.'), `<div class="meeting-actions"><button class="btn btn-primary" type="button" id="meeting-again">${t('Join again')}</button></div>`);
    document.getElementById('meeting-again').addEventListener('click', load);
  }

  // ---- Transcription (Phase 3): each browser records ONLY its own microphone, in pieces of about a minute -------------------------------
  // It runs while the transcription is on and not ended and the room has the candidate AND someone of the team (owner decision); when one of
  // them leaves it goes on for 5 more minutes (a dropped connection comes back), then stops. A piece where nobody spoke is not sent (it would
  // cost tokens for nothing): the browser only says the meeting goes on. The audio is deleted on the server as soon as it is transcribed.
  const SEGMENT_MS = 60000;
  const GRACE_MS = 5 * 60000;
  let myName = '';
  let rec = null; // { recorder, startedAt, voiced, mimeType, timer }
  let recGraceTimer = null;
  let recMeter = null; // { audio, analyser, timer, track }
  const recMime = () => ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/webm'].find(type => window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(type)) || '';
  const micTrack = () => (camera && camera.getAudioTracks().find(track => track.readyState === 'live')) || null;
  function wantRecording() {
    if (!room || !view || !view.transcription || view.transcriptionEnded || !micTrack() || !recMime()) return false;
    const roles = [view.role].concat(peers.map(p => p.role));
    return roles.includes('team') && roles.includes('candidate');
  }
  function setRecBadge(on) { const badge = document.getElementById('meeting-rec'); if (badge) badge.hidden = !on; }
  function checkRecording() {
    if (wantRecording()) {
      clearTimeout(recGraceTimer); recGraceTimer = null;
      setRecBadge(true);
      if (!rec) startSegment();
    } else if (rec && !recGraceTimer) {
      recGraceTimer = setTimeout(() => { recGraceTimer = null; if (!wantRecording()) stopRecording(true); }, GRACE_MS);
    } else if (!rec) setRecBadge(false);
  }
  // Is anyone speaking? A light level check of the microphone, four times a second.
  function watchLevel(track) {
    if (recMeter && recMeter.track === track) return;
    stopLevel();
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const audio = new AudioCtx();
      const source = audio.createMediaStreamSource(new MediaStream([track]));
      const analyser = audio.createAnalyser();
      analyser.fftSize = 1024;
      source.connect(analyser);
      const data = new Float32Array(analyser.fftSize);
      const timer = setInterval(() => {
        analyser.getFloatTimeDomainData(data);
        let sum = 0; for (const v of data) sum += v * v;
        if (rec && track.enabled && Math.sqrt(sum / data.length) > 0.012) rec.voiced++;
      }, 250);
      recMeter = { audio, timer, track };
    } catch (_) { recMeter = null; }
  }
  function stopLevel() { if (recMeter) { clearInterval(recMeter.timer); recMeter.audio.close().catch(() => {}); recMeter = null; } }
  function startSegment() {
    const track = micTrack();
    const mimeType = recMime();
    if (!track || !mimeType) { rec = null; return; }
    let recorder;
    try { recorder = new MediaRecorder(new MediaStream([track]), { mimeType, audioBitsPerSecond: 24000 }); }
    catch (_) { rec = null; return; }
    const piece = { recorder, startedAt: Date.now(), voiced: 0, mimeType, chunks: [], done: null };
    piece.done = new Promise(resolve => { recorder.onstop = resolve; });
    recorder.ondataavailable = event => { if (event.data && event.data.size) piece.chunks.push(event.data); };
    recorder.start();
    watchLevel(track);
    piece.timer = setTimeout(() => { rotate(); }, SEGMENT_MS);
    rec = piece;
  }
  // Closes the current piece and sends it; starts the next one unless asked to stop.
  async function finishSegment(next) {
    const piece = rec;
    if (!piece) return;
    rec = null;
    clearTimeout(piece.timer);
    try { if (piece.recorder.state !== 'inactive') piece.recorder.stop(); } catch (_) {}
    if (next) startSegment();
    await Promise.race([piece.done, new Promise(done => setTimeout(done, 3000))]);
    const durationMs = Date.now() - piece.startedAt;
    const voiced = piece.voiced >= 4; // about a second of speech in the piece
    if (voiced && piece.chunks.length && durationMs >= 1000) await sendPiece(new Blob(piece.chunks, { type: piece.mimeType.split(';')[0] }), piece.startedAt, durationMs);
    else call({ action: 'alive', secret }).catch(error => { if (error.status === 409) transcriptionEnded(); });
  }
  const rotate = () => finishSegment(wantRecording() || !!recGraceTimer);
  async function sendPiece(blob, startedAt, durationMs) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const result = await fetch(FUNCTION_URL, { method: 'POST', headers: await headers({ 'Content-Type': blob.type || 'audio/webm', 'x-meeting-secret': secret, 'x-speaker-key': (room && room.id) || 'unknown-speaker', 'x-speaker-name': encodeURIComponent(myName || '?'), 'x-started-at': new Date(startedAt).toISOString(), 'x-duration-ms': String(durationMs) }), body: blob });
        if (result.ok) return;
        if (result.status === 409) { transcriptionEnded(); return; }
        if (result.status < 500 && result.status !== 429) return; // a refused piece will not get better
      } catch (_) { /* network: try again */ }
      await new Promise(done => setTimeout(done, 2000 * (attempt + 1)));
    }
  }
  async function stopRecording(send) {
    clearTimeout(recGraceTimer); recGraceTimer = null;
    setRecBadge(false);
    if (!rec) { stopLevel(); return; }
    if (send) await finishSegment(false);
    else { try { rec.recorder.stop(); } catch (_) {} clearTimeout(rec.timer); rec = null; }
    stopLevel();
  }
  function transcriptionEnded() {
    if (view) view.transcriptionEnded = true;
    stopRecording(true);
    const button = document.getElementById('meeting-end-transcription');
    if (button) button.remove();
  }

  // A phone that locked its screen may not give the camera back: bring it back when the page is visible again.
  document.addEventListener('visibilitychange', async () => {
    if (document.hidden || !room || !camera) return;
    await new Promise(done => setTimeout(done, 1200));
    const dead = camera.getTracks().some(track => track.readyState === 'ended');
    if (!dead || !room) return;
    try {
      const fresh = await navigator.mediaDevices.getUserMedia({ video: VIDEO, audio: AUDIO });
      const oldCamera = camera;
      camera = fresh;
      if (effect) { effect.stop(); effect = null; }
      const cleanup = await applyBackground();
      applyEnabled();
      await room.replaceStream(stream, { stop: false });
      cleanup();
      for (const track of oldCamera.getTracks()) track.stop();
      showSelf();
    } catch (_) { /* the person can leave and join again */ }
  });
  window.addEventListener('pagehide', () => { stopRecording(false); if (room) room.leave(); });

  async function load() {
    clearTimeout(pollTimer);
    if (!/^[A-Za-z0-9_-]{43}$/.test(secret)) { renderInvalid(); return; }
    if (!view) root.innerHTML = shell(`<section class="candidate-form-card meeting-card"><p class="form-intro">${t('Loading the meeting room…')}</p></section>`);
    try {
      const { room: info } = await call({ action: 'join', secret });
      view = info;
      tr = I18N ? I18N.forLanguage(view.language) : tr;
      document.documentElement.lang = tr.language;
      document.title = t('Interview') + ' · Nellio';
      renderState();
    } catch (error) {
      if (error.status === 404) renderInvalid(t(error.message));
      else renderMessage(t('Could not open the meeting room.'), esc(t(error.message)), `<div class="meeting-actions"><button class="btn btn-primary" type="button" id="meeting-retry">${t('Try again')}</button></div>`), document.getElementById('meeting-retry').addEventListener('click', load);
    }
  }

  if (!window.isSecureContext || !navigator.mediaDevices) renderInvalid(t('This page needs a secure (https) connection.'));
  else load();
})();
