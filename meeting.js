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
  let stream = null;
  let room = null;
  let supabase = null;
  let micOn = true, camOn = true;
  let wakeLock = null;
  let pollTimer = null;
  let deviceError = '';
  let busy = false;
  let peers = [];

  async function call(body) {
    let result;
    try { result = await fetch(FUNCTION_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: config.publishableKey || '' }, body: JSON.stringify(body) }); }
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
      renderMessage(t('The room is not open yet.'), t('It opens at {time}, 30 minutes before the interview. This page opens it by itself.', { time: esc(localTime(view.opensAt, { hour: '2-digit', minute: '2-digit' })) }));
      pollTimer = setTimeout(load, Math.max(5000, Math.min(60000, Date.parse(view.opensAt) - Date.now() + 1000)));
    } else if (view.status === 'closed') renderMessage(t('This meeting room is closed.'), t('The room closes one day after the interview. Contact the hiring team if you need a new time.'));
    else if (view.status === 'cancelled') renderMessage(t('This interview was cancelled.'), t('The hiring team may contact you about a new time.'));
    else if (view.status === 'unscheduled') renderMessage(t('This interview has no date yet.'), t('The room opens 30 minutes before the interview, once it is scheduled.'));
    else renderLobby();
  }

  // ---- Lobby: name, camera preview, devices ----------------------------------------------------------------------------
  function deviceMessage(error) {
    const name = error && error.name;
    if (name === 'NotAllowedError' || name === 'SecurityError') return t('The browser blocked the camera and microphone. Allow them for this site (usually in the address bar) and try again.');
    if (name === 'NotReadableError' || name === 'AbortError') return t('Your camera or microphone is being used by another app. Close it and try again.');
    if (name === 'NotFoundError' || name === 'OverconstrainedError') return t('No camera or microphone was found. You can still join to see and hear the others.');
    return t('The camera and microphone could not be started. You can still join to see and hear the others.');
  }

  async function startDevices(cameraId, micId) {
    deviceError = '';
    const video = cameraId ? { ...VIDEO, deviceId: { exact: cameraId } } : VIDEO;
    const audio = micId ? { ...AUDIO, deviceId: { exact: micId } } : AUDIO;
    try {
      const fresh = await navigator.mediaDevices.getUserMedia({ video, audio });
      if (stream) for (const track of stream.getTracks()) track.stop();
      stream = fresh;
    } catch (error) {
      // Without a camera, try the microphone alone before giving up.
      try { if (!stream) stream = await navigator.mediaDevices.getUserMedia({ audio }); deviceError = deviceMessage(error); }
      catch (_) { deviceError = deviceMessage(error); }
    }
  }

  async function deviceOptions() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return { cameras: [], mics: [] };
    const all = await navigator.mediaDevices.enumerateDevices().catch(() => []);
    return { cameras: all.filter(d => d.kind === 'videoinput' && d.label), mics: all.filter(d => d.kind === 'audioinput' && d.label) };
  }

  async function renderLobby() {
    let name = '';
    try { name = localStorage.getItem('nellio-meeting-name') || ''; } catch (_) {}
    const current = kind => stream && stream.getTracks().find(track => track.kind === kind);
    const { cameras, mics } = stream ? await deviceOptions() : { cameras: [], mics: [] };
    const select = (id, label, list, kind) => list.length > 1 ? `<label class="meeting-field"><span>${label}</span><select class="text-input" id="${id}">${list.map(d => `<option value="${esc(d.deviceId)}"${current(kind) && current(kind).getSettings().deviceId === d.deviceId ? ' selected' : ''}>${esc(d.label)}</option>`).join('')}</select></label>` : '';
    root.innerHTML = shell(`<section class="candidate-form-card meeting-card">${heading()}
      <div class="meeting-preview">${stream && current('video') ? '<video id="preview" autoplay playsinline muted></video>' : `<div class="meeting-preview-empty">${stream ? t('Camera off') : t('Your camera is not on yet.')}</div>`}</div>
      ${deviceError ? `<div class="ai-note is-warn" role="alert">${esc(deviceError)}</div>` : ''}
      <div class="meeting-fields">
        <label class="meeting-field"><span>${t('Your name')}</span><input class="text-input" id="meeting-name" maxlength="40" autocomplete="name" value="${esc(name)}"></label>
        ${select('meeting-camera', t('Camera'), cameras, 'video')}${select('meeting-mic', t('Microphone'), mics, 'audio')}
      </div>
      <p class="meeting-hint">${stream ? t('Your camera and microphone will be on when you join. You can turn them off in the room.') : t('When you continue, the browser asks to use your camera and microphone.')}</p>
      <div class="meeting-actions">${stream ? '' : `<button class="btn" type="button" id="meeting-check">${t('Check camera and microphone')}</button>`}<button class="btn btn-primary" type="button" id="meeting-join">${t('Join the meeting')}</button></div>
    </section>`);
    const preview = document.getElementById('preview');
    if (preview) { preview.srcObject = stream; preview.play().catch(() => {}); }
    const reselect = async () => { await startDevices(document.getElementById('meeting-camera')?.value, document.getElementById('meeting-mic')?.value); rememberName(); renderLobby(); };
    document.getElementById('meeting-camera')?.addEventListener('change', reselect);
    document.getElementById('meeting-mic')?.addEventListener('change', reselect);
    document.getElementById('meeting-check')?.addEventListener('click', async () => { rememberName(); await startDevices(); renderLobby(); });
    document.getElementById('meeting-join').addEventListener('click', join);
  }

  function rememberName() {
    const input = document.getElementById('meeting-name');
    if (input) try { localStorage.setItem('nellio-meeting-name', input.value.trim()); } catch (_) {}
  }

  // ---- The room ---------------------------------------------------------------------------------------------------------
  async function join() {
    if (busy) return;
    const input = document.getElementById('meeting-name');
    const name = (input && input.value.trim()) || '';
    if (!name) { input && input.focus(); input && input.classList.add('is-invalid'); return; }
    rememberName();
    busy = true;
    const button = document.getElementById('meeting-join');
    if (button) { button.disabled = true; button.textContent = t('Joining…'); }
    try {
      if (!stream) await startDevices();
      const { room: entered } = await call({ action: 'join', secret, enter: true });
      view = entered;
      if (view.status !== 'open' || !view.channel) { busy = false; renderState(); return; }
      supabase = supabase || window.supabase.createClient(config.url, config.publishableKey, { auth: { persistSession: false, autoRefreshToken: false }, realtime: { params: { eventsPerSecond: 20 } } });
      const iceServers = [{ urls: 'stun:stun.cloudflare.com:3478' }, { urls: 'stun:stun.l.google.com:19302' }].concat(view.iceServers || []);
      room = window.NellioRoom.createRoom({ supabase, channelName: view.channel, name, iceServers, videoMaxBitrate: PHONE ? 600000 : 0, on: onRoomEvent });
      await room.join(stream);
      peers = room.peers();
      renderRoom(name);
      if ('wakeLock' in navigator) navigator.wakeLock.request('screen').then(lock => { wakeLock = lock; }).catch(() => {});
    } catch (error) {
      room = null;
      renderMessage(t('Could not join the meeting.'), esc(t(error.message || 'Something went wrong. Please try again.')), `<div class="meeting-actions"><button class="btn btn-primary" type="button" id="meeting-retry">${t('Try again')}</button></div>`);
      document.getElementById('meeting-retry').addEventListener('click', () => { renderLobby(); });
    } finally { busy = false; }
  }

  function onRoomEvent(event, detail) {
    if (event === 'log') { console.debug('[meeting]', detail.text); return; }
    if (event === 'peers') { peers = detail; paintPeople(); return; }
    if (event === 'full') { room = null; renderMessage(t('This meeting is full.'), t('Up to {count} people can be in the room at the same time.', { count: view.maxPeople || 4 })); return; }
  }

  function renderRoom(name) {
    root.innerHTML = shell(`<section class="meeting-room">
      <div class="meeting-room-head"><div><strong>${esc(view.jobTitle || t('Interview'))}</strong><span>${esc(view.companyName || '')}</span></div><span class="meeting-status" id="meeting-status"></span></div>
      <div class="meeting-grid" id="meeting-grid"><div class="meeting-tile is-me" data-tile="me"><video autoplay playsinline muted></video><span class="meeting-label">${esc(t('{name} (you)', { name }))}</span></div></div>
      <div class="meeting-controls">
        <button class="btn" type="button" id="meeting-mic-toggle" aria-pressed="false"${stream && stream.getAudioTracks().length ? '' : ' disabled'}>${t('Mute')}</button>
        <button class="btn" type="button" id="meeting-cam-toggle" aria-pressed="false"${stream && stream.getVideoTracks().length ? '' : ' disabled'}>${t('Turn camera off')}</button>
        <button class="btn btn-danger" type="button" id="meeting-leave">${t('Leave')}</button>
      </div>
    </section>`, true);
    const me = root.querySelector('[data-tile="me"] video');
    me.srcObject = stream || new MediaStream(); me.play().catch(() => {});
    if (!stream || !stream.getVideoTracks().length) root.querySelector('[data-tile="me"]').classList.add('is-off');
    document.getElementById('meeting-mic-toggle').addEventListener('click', event => { micOn = !micOn; room && room.setMic(micOn); event.currentTarget.textContent = micOn ? t('Mute') : t('Unmute'); event.currentTarget.setAttribute('aria-pressed', String(!micOn)); });
    document.getElementById('meeting-cam-toggle').addEventListener('click', event => { camOn = !camOn; room && room.setCam(camOn); event.currentTarget.textContent = camOn ? t('Turn camera off') : t('Turn camera on'); event.currentTarget.setAttribute('aria-pressed', String(!camOn)); root.querySelector('[data-tile="me"]').classList.toggle('is-off', !camOn); });
    document.getElementById('meeting-leave').addEventListener('click', leave);
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
        tile.innerHTML = '<video autoplay playsinline></video><span class="meeting-label"></span><span class="meeting-badge"></span>';
        grid.appendChild(tile);
      }
      const video = tile.querySelector('video');
      if (video.srcObject !== person.stream) { video.srcObject = person.stream; video.play().catch(() => {}); }
      tile.querySelector('.meeting-label').textContent = person.name;
      const trouble = person.state === 'disconnected' || person.state === 'failed';
      tile.querySelector('.meeting-badge').textContent = trouble ? t('Reconnecting…') : (person.state === 'connected' ? '' : t('Connecting…'));
    }
    grid.dataset.count = String(peers.length + 1);
    const status = document.getElementById('meeting-status');
    if (status) status.textContent = peers.length ? tr.tn('{count} other person in the room', '{count} other people in the room', peers.length) : t('Waiting for the others to join…');
  }

  function leave() {
    if (room) room.leave();
    room = null; peers = [];
    stream = null; // room.leave() stopped the camera and microphone
    if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
    renderMessage(t('You left the meeting.'), t('You can join again while the room is open.'), `<div class="meeting-actions"><button class="btn btn-primary" type="button" id="meeting-again">${t('Join again')}</button></div>`);
    document.getElementById('meeting-again').addEventListener('click', load);
  }

  // A phone that locked its screen may not give the camera back: bring it back when the page is visible again.
  document.addEventListener('visibilitychange', async () => {
    if (document.hidden || !room || !stream) return;
    await new Promise(done => setTimeout(done, 1200));
    const dead = stream.getTracks().some(track => track.readyState === 'ended');
    if (!dead || !room) return;
    try {
      const fresh = await navigator.mediaDevices.getUserMedia({ video: VIDEO, audio: AUDIO });
      fresh.getAudioTracks().forEach(track => { track.enabled = micOn; });
      fresh.getVideoTracks().forEach(track => { track.enabled = camOn; });
      await room.replaceStream(fresh);
      stream = fresh;
      const me = root.querySelector('[data-tile="me"] video');
      if (me) { me.srcObject = stream; me.play().catch(() => {}); }
    } catch (_) { /* the person can leave and join again */ }
  });
  window.addEventListener('pagehide', () => { if (room) room.leave(); });

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
