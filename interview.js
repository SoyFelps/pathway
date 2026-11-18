/* The answer page of a human interview (interview.html). The candidate opens it from the e-mail: no sign-in, the secret of the link
   (the part after the #) is the key. Opening the page only SHOWS the interview; the answer is saved only when a button is pressed,
   so an e-mail scanner that opens the link never answers for the candidate. Every text follows the language of the JOB, like the
   application page (i18n.js forLanguage), never the browser's own choice, except while nothing is loaded yet. */
(function () {
  const I18N = window.PathwayI18n;
  const config = window.PATHWAY_SUPABASE_CONFIG || {};
  const FUNCTION_URL = `${String(config.url || '').replace(/\/$/, '')}/functions/v1/interviews`;
  const root = document.getElementById('interview-app');
  let tr = I18N ? I18N.forLanguage(I18N.language) : { language: 'en', t: text => String(text) };
  const t = (text, vars) => tr.t(text, vars);
  const esc = value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const token = String(window.location.hash || '').replace(/^#/, '').trim();
  let view = null;
  let panel = ''; // '', 'decline' or 'reschedule'
  let busy = false;
  let message = '';

  async function call(body) {
    let result;
    try { result = await fetch(FUNCTION_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: config.publishableKey || '' }, body: JSON.stringify(body) }); }
    catch (_) { throw new Error('Could not reach the interview service. Check your connection and try again.'); }
    let payload = {};
    try { payload = await result.json(); } catch (_) { /* stable fallback below */ }
    if (!result.ok) throw new Error(payload.error || 'Something went wrong. Please try again.');
    return payload;
  }

  function shell(inner) {
    const brand = view ? esc(view.companyName || t('Hiring team')) : '';
    return `<div class="candidate-app"><header class="candidate-header"><div class="candidate-header-brands"><a class="brand" href="./" aria-label="${t('Nellio home')}"><img class="brand-logo" src="brand/nellio-logo.svg" alt="Nellio"></a></div><span class="candidate-header-note">${brand || t('Interview invitation')}</span></header>${inner}<footer class="candidate-footer">${t('Powered by Nellio · A clearer way to hire')}</footer></div>`;
  }

  function renderLoading() {
    root.innerHTML = `<main class="interview-main"><section class="candidate-form-card interview-card"><p class="form-intro">${t('Loading your interview…')}</p></section></main>`;
  }

  function renderInvalid(reason) {
    root.innerHTML = `<main class="invalid-screen"><section class="invalid-content"><div class="invalid-mark" aria-hidden="true">!</div><div class="eyebrow" style="margin-bottom:13px">${t('Link unavailable')}</div><h1>${t('This link is invalid or incomplete.')}</h1><p>${esc(t(reason || 'This invitation was not found.'))}</p><a class="btn btn-primary" href="./">${t('Back to Nellio')}</a></section></main>`;
  }

  const BANNERS = {
    invited: 'Please let the hiring team know if you can attend.',
    confirmed: 'You confirmed that you can attend. The hiring team has been told.',
    declined: 'You said you cannot attend. The hiring team has been told.',
    reschedule_requested: 'Your request for another time was sent. The hiring team will contact you with a new invitation.',
    cancelled: 'This interview was cancelled. The hiring team may contact you about a new time.'
  };

  function detailsHtml() {
    const rows = [[t('When'), esc(view.when)], [t('Format'), view.kind === 'online' ? t('Online') : t('In person')]];
    if (view.kind === 'online' && view.meetingLink) rows.push([t('Meeting link'), `<a href="${esc(view.meetingLink)}" target="_blank" rel="noopener noreferrer">${t('Join the meeting')}</a>`]);
    if (view.kind === 'in_person' && view.address) rows.push([t('Address'), `${esc(view.address)} · <a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(view.address)}" target="_blank" rel="noopener noreferrer">${t('Open in maps')}</a>`]);
    if (view.notes) rows.push([t('Notes'), esc(view.notes).replace(/\n/g, '<br>')]);
    return `<dl class="interview-details">${rows.map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`).join('')}</dl>`;
  }

  function calendarHtml() {
    if (!view.calendar) return '';
    return `<section class="interview-calendar" aria-label="${t('Add to my calendar')}"><h2>${t('Add to my calendar')}</h2><div class="interview-calendar-links"><a class="btn" href="${esc(view.calendar.google)}" target="_blank" rel="noopener noreferrer">Google</a><a class="btn" href="${esc(view.calendar.outlook)}" target="_blank" rel="noopener noreferrer">Outlook</a><button class="btn" type="button" id="download-ics">${t('Apple or other (.ics file)')}</button></div></section>`;
  }

  /** Today in the time zone of the interview, as YYYY-MM-DD, for the lower limit of the day fields. */
  function todayInZone() {
    try { return new Intl.DateTimeFormat('en-CA', { timeZone: view.timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
    catch (_) { return new Date().toISOString().slice(0, 10); }
  }

  function longDate(isoDay) {
    try { return new Intl.DateTimeFormat(tr.language, { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(isoDay + 'T00:00:00Z')); }
    catch (_) { return isoDay; }
  }

  function slotHtml(index) {
    return `<div class="interview-slot" data-slot="${index}"${index > 0 ? ' hidden' : ''}><div class="candidate-field"><label for="slot-day-${index}">${t('Day')} ${index + 1}</label><input id="slot-day-${index}" type="date" min="${esc(todayInZone())}" max="${esc(view.suggestUntilDate)}"></div><div class="candidate-field"><label for="slot-time-${index}">${t('Time')} ${index + 1}</label><input id="slot-time-${index}" type="time"></div></div>`;
  }

  function panelHtml() {
    if (panel === 'decline') {
      return `<form class="interview-panel" id="decline-form" novalidate><h2>${t('I cannot attend')}</h2><div class="candidate-field"><label for="answer-note">${t('Message to the hiring team (optional)')}</label><textarea id="answer-note" rows="3" maxlength="1000"></textarea></div><p class="interview-error" id="panel-error" role="alert" hidden></p><button class="btn btn-primary candidate-apply" type="submit">${t('Send')}</button><button class="candidate-back" type="button" id="panel-back">← ${t('Back')}</button></form>`;
    }
    if (panel === 'reschedule') {
      return `<form class="interview-panel" id="reschedule-form" novalidate><h2>${t('Suggest other times')}</h2><p class="form-intro">${t('Suggest up to 3 times, from today until {date}. Times are in the time zone of the interview: {zone}.', { date: esc(longDate(view.suggestUntilDate)), zone: esc(view.timeZone) })}</p>${[0, 1, 2].map(slotHtml).join('')}<button class="candidate-back interview-add" type="button" id="add-slot">${t('Add another time')}</button><div class="candidate-field"><label for="answer-note">${t('Message to the hiring team (optional)')}</label><textarea id="answer-note" rows="3" maxlength="1000"></textarea></div><p class="interview-error" id="panel-error" role="alert" hidden></p><button class="btn btn-primary candidate-apply" type="submit">${t('Send request')}</button><button class="candidate-back" type="button" id="panel-back">← ${t('Back')}</button></form>`;
    }
    return '';
  }

  function actionsHtml() {
    if (!view.canRespond || panel) return '';
    const buttons = [];
    if (view.state !== 'confirmed') buttons.push(`<button class="btn btn-primary" type="button" id="act-confirm">${t('Confirm attendance')}</button>`);
    if (view.state !== 'declined') buttons.push(`<button class="btn" type="button" id="act-decline">${t('I cannot attend')}</button>`);
    buttons.push(`<button class="btn" type="button" id="act-reschedule">${t('I need another time')}</button>`);
    return `<div class="interview-actions">${buttons.join('')}</div>`;
  }

  function sentTimesHtml() {
    if (view.state !== 'reschedule_requested' || !Array.isArray(view.proposedTimes) || !view.proposedTimes.length) return '';
    return `<p class="interview-sent">${view.proposedTimes.map(item => esc(String(item.local || '').replace('T', ' '))).join(' · ')}</p>`;
  }

  function render() {
    if (!view) return;
    tr = I18N ? I18N.forLanguage(view.language) : tr;
    document.documentElement.lang = tr.language;
    document.title = `${t('Interview')} · ${view.companyName || 'Nellio'}`;
    const known = Object.prototype.hasOwnProperty.call(BANNERS, view.state);
    const finished = !view.canRespond && view.state !== 'cancelled';
    const banner = view.state === 'cancelled' ? BANNERS.cancelled : finished ? 'This interview has already taken place.' : (known ? BANNERS[view.state] : '');
    const intro = view.candidateName ? t('Hi {name}, here are the details of your interview.', { name: esc(view.candidateName) }) : t('Here are the details of your interview.');
    root.innerHTML = shell(`<main class="interview-main"><section class="candidate-form-card interview-card"><div class="job-kicker">${t('Interview')}</div><h1 class="interview-title">${esc(view.jobTitle || t('Interview'))}</h1><p class="form-intro">${esc(view.companyName || t('Hiring team'))}</p>${view.state === 'cancelled' ? '' : `<p class="interview-intro">${intro}</p>${detailsHtml()}`}${banner ? `<div class="prototype-note interview-banner interview-banner-${esc(view.state)}" role="status">${t(banner)}</div>` : ''}${sentTimesHtml()}${message ? `<p class="interview-error" role="alert">${esc(message)}</p>` : ''}${actionsHtml()}${panelHtml()}${calendarHtml()}</section></main>`);
    bind();
  }

  // While the answer is on its way the buttons are only switched off (the form is not redrawn), so nothing the person typed is lost if it fails.
  async function answer(body) {
    if (busy) return;
    busy = true; message = '';
    root.querySelectorAll('button').forEach(button => { button.disabled = true; });
    try {
      const payload = await call({ action: 'respond', token, ...body });
      view = payload.interview; panel = '';
      busy = false;
      render();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (error) {
      busy = false; message = t(error.message);
      const slot = root.querySelector('#panel-error');
      if (panel && slot) {
        slot.textContent = message; slot.hidden = false;
        root.querySelectorAll('button').forEach(button => { button.disabled = false; });
      } else render();
    }
  }

  function bind() {
    const on = (id, handler) => { const element = root.querySelector('#' + id); if (element) element.addEventListener('click', handler); };
    on('act-confirm', () => answer({ response: 'confirm' }));
    on('act-decline', () => { panel = 'decline'; message = ''; render(); });
    on('act-reschedule', () => { panel = 'reschedule'; message = ''; render(); });
    on('panel-back', () => { panel = ''; message = ''; render(); });
    on('download-ics', downloadIcs);
    on('add-slot', event => {
      const next = root.querySelector('.interview-slot[hidden]');
      if (next) next.hidden = false;
      if (!root.querySelector('.interview-slot[hidden]')) event.currentTarget.hidden = true;
    });
    const decline = root.querySelector('#decline-form');
    if (decline) decline.addEventListener('submit', event => { event.preventDefault(); answer({ response: 'decline', note: root.querySelector('#answer-note').value }); });
    const reschedule = root.querySelector('#reschedule-form');
    if (reschedule) reschedule.addEventListener('submit', event => {
      event.preventDefault();
      const error = root.querySelector('#panel-error');
      const times = [];
      for (const slot of root.querySelectorAll('.interview-slot')) {
        const day = slot.querySelector('input[type="date"]').value;
        const time = slot.querySelector('input[type="time"]').value;
        if (!day && !time) continue;
        if (!day || !time) { error.textContent = t('Choose both the day and the time for each suggestion.'); error.hidden = false; return; }
        times.push({ local: `${day}T${time}` });
      }
      const note = root.querySelector('#answer-note').value;
      if (!times.length && !note.trim()) { error.textContent = t('Suggest at least one time or write a message.'); error.hidden = false; return; }
      answer({ response: 'reschedule', note, proposedTimes: times });
    });
  }

  async function downloadIcs() {
    try {
      const file = await call({ action: 'calendar', token });
      const url = URL.createObjectURL(new Blob([file.content], { type: 'text/calendar;charset=utf-8' }));
      const link = document.createElement('a');
      link.href = url; link.download = file.filename || 'interview.ics';
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch (error) { message = t(error.message); render(); }
  }

  async function start() {
    if (!root) return;
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) { renderInvalid('This invitation was not found.'); return; }
    renderLoading();
    try { view = (await call({ action: 'get', token })).interview; }
    catch (error) { renderInvalid(error.message); return; }
    render();
  }
  start();
})();
