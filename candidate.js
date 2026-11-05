/* Shared candidate journey renderer used by apply.html and the builder preview. */
(function () {
  const C = window.PathwayCore;
  // Every text here follows the JOB's language (i18n.js forLanguage), never the recruiter's own choice: the candidate page, and the
  // preview of it in the editor, look the same. Before a job is loaded (a broken link), the browser language. Stored values (country
  // names, pronouns, diversity answers) stay in English; only what is shown is translated.
  const I18N = window.PathwayI18n;
  let tr = I18N ? I18N.forLanguage(I18N.language) : { language: 'en', t: text => String(text) };
  const t = (text, vars) => tr.t(text, vars);
  const INFO_MESSAGE = 'The hiring team would like to understand a little more about you. Please complete the required details and answer each question.';
  const RESUME_TYPES = {
    'application/pdf': '.pdf',
    'application/msword': '.doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx'
  };
  const INFO_LABELS = Object.fromEntries(C.OPTIONAL_FIELDS.map(field => [field.key, field.label]));
  const G = window.PathwayGeo;
  const STATUS_LABELS = { new: 'New', failed: 'Failed', promising: 'Promising', approved: 'Approved' };

  // Cloudflare Turnstile CAPTCHA. The site key is public and lives in turnstile-config.js; without one the check is skipped.
  // The token is valid for only five minutes and works once, so it is requested at the moment of submission, never earlier.
  const TURNSTILE_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
  let turnstileLoader = null;
  function loadTurnstile() {
    if (window.turnstile) return Promise.resolve(window.turnstile);
    if (!turnstileLoader) {
      turnstileLoader = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = TURNSTILE_SRC; script.async = true; script.defer = true;
        script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error(t('The security check could not load.'))));
        script.onerror = () => { turnstileLoader = null; reject(new Error(t('The security check could not load. Check your connection or turn off content blockers, then try again.'))); };
        document.head.appendChild(script);
      });
    }
    return turnstileLoader;
  }
  async function requestCaptchaToken(container) {
    const siteKey = window.PATHWAY_TURNSTILE && window.PATHWAY_TURNSTILE.siteKey;
    if (!siteKey || !container) return '';
    const turnstile = await loadTurnstile();
    return await new Promise((resolve, reject) => {
      let widgetId;
      const finish = (settle, value) => { try { turnstile.remove(widgetId); } catch (_) { /* the widget is already gone */ } settle(value); };
      const failure = () => new Error(t('We could not confirm that you are not a robot. Please try again.'));
      widgetId = turnstile.render(container, {
        sitekey: siteKey,
        language: tr.language === 'pt-BR' ? 'pt-br' : tr.language, // the security check speaks the page language too
        execution: 'execute',
        appearance: 'interaction-only',
        callback: token => finish(resolve, token),
        'error-callback': () => finish(reject, failure()),
        'timeout-callback': () => finish(reject, failure()),
        'unsupported-callback': () => finish(reject, failure())
      });
      turnstile.execute(container);
    });
  }

  // The resume field: a drop area instead of the browser's own file button (whose words follow the browser language and look dated).
  // The real <input type="file"> stays inside, invisible and covering the area, so clicking, dragging a file onto it, the keyboard and form validation all keep working.
  const RESUME_MAX_BYTES = 10 * 1024 * 1024;
  const UPLOAD_ICON = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 16V4"/><path d="M7 9l5-5 5 5"/><path d="M4 16v2.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V16"/></svg>';
  const FILE_ICON = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H7.5A1.5 1.5 0 0 0 6 4.5v15A1.5 1.5 0 0 0 7.5 21h9a1.5 1.5 0 0 0 1.5-1.5V7z"/><path d="M14 3v4h4"/><path d="M9 14l2 2 4-4"/></svg>';
  function resumeUploadHtml(meta) {
    return `<div class="candidate-field candidate-upload"><label for="candidate-resume">${C.esc(t(meta.label))}</label><div class="upload-drop"><input id="candidate-resume" name="resume" type="file" accept="${C.esc(meta.accept)}" required class="upload-native" aria-describedby="candidate-resume-hint"><div class="upload-box" aria-hidden="true"><span class="upload-icon">${UPLOAD_ICON}</span><span class="upload-text"><strong class="upload-title">${uploadTitleHtml()}</strong><span class="upload-sub" id="candidate-resume-hint">${t('PDF, DOC or DOCX · up to 10 MB')}</span></span></div></div></div>`;
  }
  function uploadTitleHtml() {
    return `${t('Choose a file')} <span class="upload-drag">${t('or drag it here')}</span>`;
  }
  function formatFileSize(bytes) {
    return bytes >= 1048576 ? (bytes / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(bytes / 1024)) + ' KB';
  }
  function bindResumeUpload(form, getFile) {
    const input = form.elements.resume;
    if (!input) return;
    const drop = input.closest('.upload-drop'), box = drop.querySelector('.upload-box');
    const icon = box.querySelector('.upload-icon'), title = box.querySelector('.upload-title'), sub = box.querySelector('.upload-sub');
    const show = file => {
      box.classList.toggle('has-file', Boolean(file));
      if (file) {
        icon.innerHTML = FILE_ICON; title.textContent = file.name; sub.textContent = formatFileSize(file.size) + ' · ' + t('Click to replace');
      } else {
        icon.innerHTML = UPLOAD_ICON; title.innerHTML = uploadTitleHtml(); sub.textContent = t('PDF, DOC or DOCX · up to 10 MB');
      }
    };
    const check = file => {
      const extension = (file.name.split('.').pop() || '').toLowerCase();
      if (!['pdf', 'doc', 'docx'].includes(extension)) return t('Upload your resume as a PDF, DOC or DOCX file.');
      if (file.size > RESUME_MAX_BYTES) return t('Your resume must be 10 MB or smaller.');
      return '';
    };
    input.addEventListener('change', () => {
      const file = input.files && input.files[0];
      const problem = file ? check(file) : '';
      input.setCustomValidity(problem);
      if (problem) { input.value = ''; show(getFile()); input.reportValidity(); return; }
      show(file || getFile());
    });
    ['dragenter', 'dragover'].forEach(name => drop.addEventListener(name, () => box.classList.add('is-dragging')));
    ['dragleave', 'drop'].forEach(name => drop.addEventListener(name, () => box.classList.remove('is-dragging')));
    show(getFile());
  }

  function candidateFieldHtml(key, optional = false) {
    const meta = C.FIELD_META[key] || C.OPTIONAL_FIELDS.find(field => field.key === key);
    if (!meta) return '';
    if (key === 'resume') return resumeUploadHtml(meta);
    if (meta.type === 'diversity') return ''; // the diversity questions have their own page
    const required = 'required'; // every detail the employer asks for is required (lists offer "Prefer not to say" where a person may not want to answer)
    const type = meta.type === 'file' ? 'file' : ['country', 'city', 'pronouns'].includes(meta.type) ? 'text' : meta.type;
    const placeholder = key === 'name' ? t('e.g. Alex Morgan') : key === 'email' ? t('you@example.com') : '';
    // Searchable country / city lists and the pronouns list (see geo.js); without it they fall back to plain text.
    if (G && (meta.type === 'country' || meta.type === 'city')) {
      return `<div class="candidate-field"><label for="candidate-${C.esc(key)}">${C.esc(t(meta.label))}</label><input id="candidate-${C.esc(key)}" name="${C.esc(key)}" type="text" data-geo="${meta.type}" maxlength="150" placeholder="${t('Type or select')}" required></div>`;
    }
    if (G && meta.type === 'phone') {
      return `<div class="candidate-field candidate-phone"><label for="candidate-phone">${C.esc(t(meta.label))}</label><div class="phone-row"><div class="phone-country-wrap" data-geo="phone-country"></div><input id="candidate-phone" name="phone" type="tel" inputmode="tel" autocomplete="tel-national" data-geo="phone-number" maxlength="40" required></div></div>`;
    }
    if (G && meta.type === 'pronouns') {
      // The value stays the English option (what the server accepts); only the text shown is translated.
      return `<div class="candidate-field"><label for="candidate-pronouns">${C.esc(t(meta.label))}</label><select id="candidate-pronouns" name="pronouns" data-geo="pronouns" required><option value="">${t('Select…')}</option>${G.PRONOUNS.concat([G.PRONOUN_OTHER]).map(option => `<option value="${C.esc(option)}">${C.esc(t(option))}</option>`).join('')}</select><input type="text" name="pronounsOther" data-geo="pronouns-other" class="candidate-pronouns-other" maxlength="${G.PRONOUN_OTHER_MAX}" placeholder="${t('How should we refer to you?')}" aria-label="${t('Your pronouns')}" hidden></div>`;
    }
    return `<div class="candidate-field"><label for="candidate-${C.esc(key)}">${C.esc(t(meta.label))}</label><input id="candidate-${C.esc(key)}" name="${C.esc(key)}" type="${C.esc(type)}" ${required} ${meta.autocomplete ? `autocomplete="${C.esc(meta.autocomplete)}"` : ''} ${meta.accept ? `accept="${C.esc(meta.accept)}"` : ''} ${placeholder ? `placeholder="${C.esc(placeholder)}"` : ''} ${key === 'resume' ? 'class="file-input"' : ''}></div>`;
  }

  function safeCompanyLogoUrl(value) {
    try {
      const candidate = new URL(value);
      const supabase = new URL(window.PATHWAY_SUPABASE_CONFIG?.url || '');
      return candidate.protocol === 'https:' && candidate.origin === supabase.origin && candidate.pathname.startsWith('/storage/v1/object/public/company-logos/') ? candidate.href : '';
    } catch (_) { return ''; }
  }

  function companyLogoUrl(profile) {
    const directUrl = safeCompanyLogoUrl(profile?.logoUrl || '');
    if (directUrl) return directUrl;
    const logoPath = String(profile?.logoPath || '');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/logo(?:-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?\.(?:png|jpg|webp)$/i.test(logoPath)) return '';
    try {
      const supabase = new URL(window.PATHWAY_SUPABASE_CONFIG?.url || '');
      return safeCompanyLogoUrl(`${supabase.origin}/storage/v1/object/public/company-logos/${logoPath.split('/').map(encodeURIComponent).join('/')}`);
    } catch (_) { return ''; }
  }

  // options.language: the job's language for the editor preview ('en', 'pt', 'es' or empty); the public page reads flow.jobLanguage.
  function mountCandidate(root, sourceFlow, options = {}) {
    const jobLanguage = options.language !== undefined ? options.language : sourceFlow && sourceFlow.jobLanguage;
    if (I18N) tr = I18N.forLanguage(jobLanguage);
    if (!options.preview) document.documentElement.lang = tr.language;
    let flow;
    try { flow = C.normalizeFlow(sourceFlow); }
    catch (error) { renderInvalid(root, error.message); return { destroy() {} }; }

    const live = Boolean(!options.preview && options.publishedFlowId && window.PathwayBackend && window.PathwayBackend.submitApplication);
    const state = { screen: 'landing', current: null, history: [], answers: {}, info: {}, diversity: null, resumeFile: null, questionCount: 0, submitting: false, submissionKey: crypto.randomUUID() };
    const start = C.startAfterInfo(flow);
    state.current = start;
    // Anonymous counters for the hiring team: one "view" when the page opens, one "start" at the first keystroke, and one
    // "step" the first time each part of the form is reached (the first page, then every question), so they can see where people stop.
    const reachedSteps = new Set();
    let trackStep = () => {};
    if (live && window.PathwayBackend.trackJobEvent) {
      const track = event => window.PathwayBackend.trackJobEvent(options.publishedFlowId, event);
      track('view');
      let started = false;
      root.addEventListener('input', () => { if (!started) { started = true; track('start'); } });
      // A step is counted once per visit and connection ("Q1 -> Q3"), so going back and forth never counts twice.
      trackStep = (nodeId, fromNodeId) => {
        const key = fromNodeId + '>' + nodeId;
        if (reachedSteps.has(key)) return;
        reachedSteps.add(key);
        window.PathwayBackend.trackJobEvent(options.publishedFlowId, 'step', nodeId, fromNodeId);
      };
    }

    function render() {
      if (state.screen === 'landing' || state.screen === 'diversity') renderLanding();
      else if (state.screen === 'interstitial') renderInterstitial();
      else if (state.screen === 'question') renderQuestion();
      else if (state.screen === 'submitting') renderSubmitting();
      else if (state.screen === 'complete') renderComplete();
      else renderInvalid(root, t('This application could not be opened.'));
    }

    function renderLanding() {
      const optional = C.OPTIONAL_FIELDS.filter(field => field.type !== 'diversity' && flow.candidateInfoFields && flow.candidateInfoFields[field.key]);
      const askDiversity = Boolean(G && flow.candidateInfoFields && flow.candidateInfoFields.diversity);
      const brandName = flow.companyProfile?.name || flow.companyName || t('Hiring team');
      const logoUrl = companyLogoUrl(flow.companyProfile);
      const detailsCardHtml = () => `<h2>${t('Start your application')}</h2><p class="form-intro">${t('A few details to introduce yourself to {company}.', { company: C.esc(flow.companyName || t('the hiring team')) })}</p><form id="candidate-info-form" novalidate>${candidateFieldHtml('name')}${candidateFieldHtml('email')}${candidateFieldHtml('resume')}${optional.map(field => candidateFieldHtml(field.key, true)).join('')}<div class="candidate-honeypot" aria-hidden="true"><label for="candidate-website">${t('Leave this field empty')}</label><input id="candidate-website" name="website" type="text" tabindex="-1" autocomplete="off"></div><button class="btn btn-primary candidate-apply" type="submit">${askDiversity ? t('Continue') : live ? t('Apply for this role') : t('Preview application')} <span aria-hidden="true">→</span></button><p class="privacy-note">${askDiversity ? t('Next: a short page of voluntary questions, then your application questions.') : live ? t('By submitting, you allow the company to use your information and answers to review your application') : t('Preview mode · Your details are not uploaded or stored.')}</p></form>`;
      const diversityCardHtml = () => {
        const D = G.DIVERSITY;
        // The values stay the English options (what the server checks and the report adds up); only the texts shown are translated.
        const select = key => `<div class="candidate-field"${key === 'disabilityType' ? ' id="diversity-type-field" hidden' : ''}><label for="diversity-${key}">${C.esc(t(D[key].label))}</label><select id="diversity-${key}" name="${key}" required><option value="">${t('Select…')}</option>${D[key].options.map(option => `<option value="${C.esc(option)}">${C.esc(t(option))}</option>`).join('')}</select></div>`;
        return `<h2>${t('Voluntary self-identification')}</h2><p class="form-intro">${t('{company} invites you to answer these questions to help it understand and improve the diversity of the people who apply. Answering is voluntary: choose “Prefer not to say” if you would rather not. Your answers are kept apart from your application, are not used to evaluate you, and are only reported as combined numbers.', { company: C.esc(flow.companyName || t('The hiring team')) })}</p><form id="candidate-diversity-form" novalidate>${G.DIVERSITY_KEYS.map(select).join('')}<button class="btn btn-primary candidate-apply" type="submit">${t('Continue')} <span aria-hidden="true">→</span></button><button class="candidate-back" type="button" id="diversity-back">← ${t('Back to my details')}</button></form>`;
      };
      root.innerHTML = `<div class="candidate-app"><header class="candidate-header"><div class="candidate-header-brands"><a class="brand" href="./" aria-label="${t('Pathway home')}"><span class="brand-mark">↗</span>pathway</a>${logoUrl ? `<span class="candidate-header-divider" aria-hidden="true"></span><img class="candidate-header-logo" src="${C.esc(logoUrl)}" alt="${t('{company} logo', { company: C.esc(brandName) })}">` : ''}</div><span class="candidate-header-note">${live ? t('Secure application') : t('Application preview')}</span></header><main class="candidate-landing"><section class="job-copy"><div class="company-lockup"><div class="company-label">${C.esc(brandName)}</div></div><button type="button" class="btn btn-primary mobile-apply-cta" data-scroll-to-form>${t('Apply for this role')} <span aria-hidden="true">↓</span></button><div class="job-kicker">${t('Open position')}</div><h1 class="job-title">${C.esc(flow.jobTitle || t('Open position'))}</h1><div class="job-description">${C.esc(flow.jobDescription || t('We’re excited to meet you. Tell us a little about yourself to get started.'))}</div><div class="job-meta"><span class="meta-chip">${live ? t('Accepting applications') : t('Preview')}</span><span class="meta-chip">${C.esc(flow.companyName || t('Hiring team'))}</span></div>${flow.companyProfile?.description ? `<section class="company-details"><h2>${t('About {company}', { company: C.esc(brandName) })}</h2><p>${C.esc(flow.companyProfile.description)}</p></section>` : ''}<div class="job-about"><h2>${t('How to apply')}</h2><p>${t('Start with a few details, upload your resume, and answer a small number of questions tailored to this role.')} ${live ? t('Your application will be saved securely when you submit it.') : t('Nothing entered in this preview is saved.')}</p></div></section><section class="candidate-form-card" id="candidate-form-card">${state.screen === 'diversity' ? diversityCardHtml() : detailsCardHtml()}</section></main><footer class="candidate-footer">${t('Powered by Pathway · A clearer way to hire')}</footer></div>`;
      const form = root.querySelector('#candidate-info-form') || root.querySelector('#candidate-diversity-form');
      const applyCta = root.querySelector('[data-scroll-to-form]');
      if (applyCta) applyCta.addEventListener('click', () => {
        const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        root.querySelector('#candidate-form-card').scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
      });
      if (state.screen === 'diversity') { bindDiversityForm(); return; }
      // Going back to this page: the stored country is the English name, the field shows it in the page language.
      Object.entries(state.info).forEach(([key, value]) => { const input = form.elements[key]; if (input && input.type !== 'file' && input.type !== 'checkbox' && key !== 'pronouns' && key !== 'phone') input.value = key === 'country' && G ? G.countryLabel(value, tr.language) : value; });
      if (G) { G.enhanceForm(form, tr); G.fillPronouns(form, state.info.pronouns); G.fillPhone(form, state.info.phone); }
      const resumeInput = form.elements.resume;
      if (state.resumeFile) resumeInput.required = false;
      bindResumeUpload(form, () => state.resumeFile);
      form.addEventListener('submit', event => {
        event.preventDefault();
        if (!form.reportValidity()) return;
        const data = new FormData(form);
        state.info = {};
        [...data.entries()].forEach(([key, value]) => {
          if (key === 'name' || key === 'email') state.info[key] = String(value).trim();
          else if (key !== 'resume' && key !== 'privacyAcknowledged' && key !== 'website') state.info[key] = String(value).trim();
        });
        if (G && form.elements.pronouns) { state.info.pronouns = G.joinPronouns(String(data.get('pronouns') || ''), data.get('pronounsOther')); }
        delete state.info.pronounsOther;
        if (G && form.elements.phone) state.info.phone = G.readPhone(form);
        if (G && form.elements.country) state.info.country = G.countryValue(state.info.country, tr.language); // stored in English
        const picked = data.get('resume');
        if (picked && picked.size) state.resumeFile = picked;
        if (live) state.info.privacyAcknowledged = true; // Consent is recorded when the candidate submits under the notice.
        state.info.website = String(data.get('website') || '');
        if (!state.resumeFile) { resumeInput.required = true; resumeInput.reportValidity(); return; }
        trackStep('details', 'start');
        if (askDiversity) { state.screen = 'diversity'; render(); return; }
        afterDetails();
      });
    }

    // After the first page (and the diversity page, when the employer asks for it) the person goes on to the questions.
    function afterDetails() {
      if (state.current && state.current.type === 'end') { complete(state.current.subtype || 'submitted'); return; }
      state.screen = 'interstitial';
      render();
    }

    function bindDiversityForm() {
      const form = root.querySelector('#candidate-diversity-form');
      const typeField = form.querySelector('#diversity-type-field');
      const syncType = () => { const yes = form.elements.disability.value === 'Yes'; typeField.hidden = !yes; form.elements.disabilityType.required = yes; if (!yes) form.elements.disabilityType.value = ''; };
      Object.entries(state.diversity || {}).forEach(([key, value]) => { if (form.elements[key]) form.elements[key].value = value; });
      form.elements.disability.addEventListener('change', syncType); syncType();
      root.querySelector('#diversity-back').addEventListener('click', () => { state.screen = 'landing'; render(); });
      form.addEventListener('submit', event => {
        event.preventDefault();
        if (!form.reportValidity()) return;
        state.diversity = Object.fromEntries(G.DIVERSITY_KEYS.map(key => [key, String(form.elements[key].value || '')]));
        afterDetails();
      });
    }

    function renderInterstitial() {
      root.innerHTML = `<main class="interstitial-screen"><section class="interstitial-content"><div class="interstitial-mark" aria-hidden="true">✳</div><div class="eyebrow" style="margin-bottom:13px">${t('One more thing')}</div><h1>${t('A little more about you.')}</h1><p>${C.esc(t(INFO_MESSAGE))}</p><div class="prototype-note">${live ? t('Your information and resume are saved only when you submit the completed application.') : t('Preview only · Nothing you enter is sent or stored.')}</div><button id="continue-questions" class="btn btn-primary">${t('Continue to questions')} <span aria-hidden="true">→</span></button><div class="question-footnote">${C.esc(flow.companyName || t('The hiring team'))} · ${C.esc(flow.jobTitle || t('Application'))}</div></section></main>`;
      root.querySelector('#continue-questions').addEventListener('click', () => {
        if (!state.current) { complete('submitted'); return; }
        if (state.current.type === 'end') { complete(state.current.subtype || 'submitted', state.current.label); return; }
        state.screen = 'question';
        render();
      });
    }

    function renderQuestion() {
      const node = state.current;
      if (!node || node.type === 'end') { complete(node && node.subtype || 'submitted'); return; }
      let input = '';
      const previousAnswer = state.answers[node.id];
      if (node.type === 'shortText') {
        input = node.numericOnly === true
          ? `<input class="answer-text" type="text" inputmode="numeric" pattern="[0-9]*" data-numeric-only="true" name="answer" placeholder="${t('Enter digits only…')}" autocomplete="off" required maxlength="4000" value="${C.esc(typeof previousAnswer === 'string' ? previousAnswer.replace(/[^0-9]/g, '') : '')}">`
          : `<textarea class="answer-text" name="answer" placeholder="${t('Write your answer here…')}" required maxlength="4000">${C.esc(previousAnswer || '')}</textarea>`;
      } else if (node.type === 'singleChoice') {
        input = `<div class="answer-area">${(node.options || []).map(value => `<label class="answer-option"><input type="radio" name="answer" value="${C.esc(value)}" required ${previousAnswer === value ? 'checked' : ''}><span>${C.esc(value)}</span></label>`).join('')}</div>`;
      } else if (node.type === 'multiChoice') {
        input = `<div class="answer-area">${(node.options || []).map(value => `<label class="answer-option"><input type="checkbox" name="answer" value="${C.esc(value)}" ${(Array.isArray(previousAnswer) && previousAnswer.includes(value)) ? 'checked' : ''}><span>${C.esc(value)}</span></label>`).join('')}</div>`;
      } else {
        renderInvalid(root, t('This application contains a question type that cannot be displayed.')); return;
      }
      trackStep(node.id, state.history.length ? state.history[state.history.length - 1].node.id : 'details');
      const progress = Math.min(92, Math.max(10, state.questionCount * 17 + 18));
      root.innerHTML = `<main class="question-screen"><header class="question-top"><a class="brand" href="./" aria-label="${t('Pathway home')}"><span class="brand-mark">↗</span>pathway</a><span class="candidate-header-note">${C.esc(flow.companyName || t('Your application'))}</span></header><section class="question-main"><div class="question-progress"><span>${t('Question {number}', { number: state.questionCount + 1 })}</span><div class="progress-track"><div class="progress-fill" style="width:${progress}%"></div></div></div><form id="question-form"><h1 class="question-heading">${C.esc(node.label || t('A question for you'))}</h1>${input}<div class="question-actions"><button type="button" class="btn btn-quiet btn-sm" id="question-back">← ${t('Back')}</button><button type="submit" class="btn btn-primary">${t('Continue')} <span aria-hidden="true">→</span></button></div></form><p class="question-footnote">${live ? t('Your answers are saved securely when you submit the completed application.') : t('Preview mode · Your answers are not saved.')}</p></section></main>`;
      const form = root.querySelector('#question-form');
      const digitInput = form.querySelector('[data-numeric-only="true"]');
      digitInput?.addEventListener('beforeinput', event => {
        if (event.inputType.startsWith('delete')) return;
        if (event.data != null && /[^0-9]/.test(event.data)) event.preventDefault();
      });
      digitInput?.addEventListener('input', () => {
        const caret = digitInput.selectionStart ?? digitInput.value.length;
        const digitsBeforeCaret = digitInput.value.slice(0, caret).replace(/[^0-9]/g, '').length;
        const digits = digitInput.value.replace(/[^0-9]/g, '');
        if (digitInput.value !== digits) {
          digitInput.value = digits;
          digitInput.setSelectionRange(digitsBeforeCaret, digitsBeforeCaret);
        }
      });
      form.addEventListener('submit', event => {
        event.preventDefault();
        if (node.type === 'multiChoice' && !form.querySelector('input:checked')) {
          const first = form.querySelector('input[type="checkbox"]');
          if (first) { first.setCustomValidity(t('Choose at least one option.')); first.reportValidity(); first.setCustomValidity(''); }
          return;
        }
        if (node.type !== 'multiChoice' && !form.reportValidity()) return;
        const answer = node.type === 'multiChoice'
          ? [...form.querySelectorAll('input:checked')].map(inputEl => inputEl.value)
          : new FormData(form).get('answer');
        if (node.type === 'shortText' && node.numericOnly === true && !C.isDigitsOnlyAnswer(answer)) {
          const numericInput = form.querySelector('[name="answer"]');
          if (numericInput) { numericInput.setCustomValidity(t('Use digits only (0–9).')); numericInput.reportValidity(); numericInput.setCustomValidity(''); }
          return;
        }
        state.answers[node.id] = answer;
        const next = C.nextNode(flow, node, answer);
        if (!next) { renderInvalid(root, t('This question does not have a next step.')); return; }
        state.history.push({ node, answer });
        state.current = next;
        state.questionCount += 1;
        if (next.type === 'end') complete(next.subtype || 'submitted', next.label);
        else { state.screen = 'question'; render(); }
      });
      root.querySelector('#question-back').addEventListener('click', () => {
        if (!state.history.length) { state.screen = 'landing'; state.current = start; state.questionCount = 0; render(); return; }
        const previous = state.history.pop();
        state.current = previous.node;
        state.questionCount = Math.max(0, state.questionCount - 1);
        render();
      });
    }

    function renderSubmitting() {
      root.innerHTML = `<main class="completion-screen"><section class="completion-content"><div class="completion-mark submitting-mark" aria-hidden="true">↻</div><div class="eyebrow" style="margin-bottom:13px">${t('Sending securely')}</div><h1>${t('Submitting your application…')}</h1><p>${t('Your answers and resume are being saved to the private hiring workspace. Please keep this page open for a moment.')}</p><div class="captcha-box" id="captcha-box"></div><div class="prototype-note">${t('Your information is sent only to {company} for review.', { company: C.esc(flow.companyName || t('the hiring team')) })}</div></section></main>`;
    }

    function collectAnswers() {
      return state.history.map(item => ({ nodeId: item.node.id, answer: item.answer }));
    }

    async function submitApplication(subtype) {
      if (!live) { renderComplete(); return; }
      if (state.submitting) return;
      state.submitting = true;
      state.screen = 'submitting';
      render();
      try {
        const turnstileToken = await requestCaptchaToken(root.querySelector('#captcha-box'));
        const result = await window.PathwayBackend.submitApplication({
          publishedFlowId: options.publishedFlowId,
          turnstileToken,
          submissionKey: state.submissionKey,
          name: state.info.name,
          email: state.info.email,
          candidateInfo: Object.fromEntries(Object.entries(state.info).filter(([key]) => !['name', 'email', 'privacyAcknowledged'].includes(key))),
          privacyAcknowledged: Boolean(state.info.privacyAcknowledged),
          answers: collectAnswers(),
          resume: state.resumeFile,
          diversity: state.diversity,
          website: state.info.website || ''
        });
        state.submitting = false;
        state.screen = 'complete';
        renderComplete();
      } catch (error) {
        state.submitting = false;
        state.screen = 'complete';
        // Messages from the server are English sentences; the known ones are in the dictionaries, others stay in English.
        renderSubmissionError(t(error.message || 'Please try again. Your application has not been sent.'));
      }
    }

    function renderSubmissionError(message) {
      root.innerHTML = `<main class="completion-screen"><section class="completion-content"><div class="completion-mark submission-error-mark" aria-hidden="true">!</div><div class="eyebrow" style="margin-bottom:13px">${t('Not submitted')}</div><h1>${t('We couldn’t send your application.')}</h1><p>${C.esc(message)}</p><button class="btn btn-primary" id="retry-submit">${t('Try again')}</button><div class="prototype-note">${t('Your application is not complete until you see a confirmation here.')}</div></section></main>`;
      root.querySelector('#retry-submit').addEventListener('click', () => submitApplication(state.current && state.current.subtype || 'submitted'));
    }

    function returnToStart() {
      state.screen = 'landing';
      state.current = start;
      state.history = [];
      state.answers = {};
      state.info = {};
      state.resumeFile = null;
      state.questionCount = 0;
      state.submitting = false;
      state.submissionKey = crypto.randomUUID();
      render();
    }

    async function copyJobLink(url) {
      const clipboard = window.navigator && window.navigator.clipboard;
      if (clipboard && typeof clipboard.writeText === 'function') {
        try {
          await clipboard.writeText(url);
          return;
        } catch (_) {
          // Fall back to a temporary input when clipboard permissions are unavailable.
        }
      }
      const input = document.createElement('textarea');
      input.value = url;
      input.setAttribute('readonly', '');
      input.style.position = 'fixed';
      input.style.opacity = '0';
      document.body.appendChild(input);
      let copied = false;
      try {
        input.select();
        copied = document.execCommand('copy');
      } finally {
        input.remove();
      }
      if (!copied) throw new Error(t('Clipboard access was denied.'));
    }

    function renderComplete() {
      const isPreview = options.preview || !live;
      const vacancyUrl = window.location.href;
      const company = C.esc(flow.companyName || t('the hiring team'));
      const title = isPreview ? t('Preview complete') : t('Application submitted.');
      const intro = isPreview
        ? t('You have reached the end of this application preview for {company}.', { company })
        : t('Your application has been received by {company}. Thank you for your interest.', { company });
      const previewNote = isPreview
        ? `<div class="prototype-note">${t('Preview only · Your details and answers were not stored or sent to the company.')}</div>`
        : '';
      root.innerHTML = `<main class="completion-screen"><section class="completion-content"><div class="completion-mark" aria-hidden="true">✓</div><div class="eyebrow" style="margin-bottom:13px">${isPreview ? t('Preview complete') : t('Thank you')}</div><h1>${title}</h1><p>${intro}</p>${isPreview ? `<a class="btn btn-primary" href="#" id="finish-link">${t('Return to preview')}</a>` : `<div class="completion-actions"><button class="btn btn-primary" id="finish-link" type="button">${t('Done')}</button><button class="btn" id="share-job" type="button">${t('Share this job')}</button></div>`}${previewNote}</section></main>`;
      const finishButton = root.querySelector('#finish-link');
      finishButton.addEventListener('click', event => {
        if (isPreview) { event.preventDefault(); options.onFinish && options.onFinish(); }
        else returnToStart();
      });
      const shareButton = root.querySelector('#share-job');
      if (shareButton) {
        let feedbackTimer;
        shareButton.addEventListener('click', async () => {
          try {
            await copyJobLink(vacancyUrl);
            shareButton.textContent = t('Link copied!');
          } catch (_) {
            shareButton.textContent = t('Copy failed');
          }
          window.clearTimeout(feedbackTimer);
          feedbackTimer = window.setTimeout(() => {
            if (shareButton.isConnected) shareButton.textContent = t('Share this job');
          }, 2200);
        });
      }
    }

    function complete(subtype, endingLabel) {
      state.screen = 'complete';
      if (live) { void submitApplication(subtype); return; }
      // Candidate details and answers remain entirely in memory while previewing.
      renderComplete();
    }

    render();
    return {
      destroy() { root.innerHTML = ''; },
      restart() { returnToStart(); }
    };
  }

  function renderInvalid(root, reason) {
    // The reason may be a message from the server (English); the known ones are translated.
    root.innerHTML = `<main class="invalid-screen"><section class="invalid-content"><div class="invalid-mark" aria-hidden="true">!</div><div class="eyebrow" style="margin-bottom:13px">${t('Link unavailable')}</div><h1>${t('This link is invalid or incomplete.')}</h1><p>${C.esc(t(reason || 'Ask the hiring team for a fresh application link.'))}</p><a class="btn btn-primary" href="index.html">${t('Back to Pathway')}</a><div class="prototype-note">${t('Published job pages load a read-only snapshot by its unique link. The private draft and hiring workspace remain inaccessible to public visitors.')}</div></section></main>`;
  }

  window.PathwayCandidate = { mountCandidate, renderInvalid, INFO_MESSAGE };
})();
