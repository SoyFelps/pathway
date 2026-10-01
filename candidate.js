/* Shared candidate journey renderer used by apply.html and the builder preview. */
(function () {
  const C = window.PathwayCore;
  const INFO_MESSAGE = 'The hiring team would like to understand a little more about you. Please complete the required details and answer each question.';
  const RESUME_TYPES = {
    'application/pdf': '.pdf',
    'application/msword': '.doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx'
  };
  const INFO_LABELS = Object.fromEntries(C.OPTIONAL_FIELDS.map(field => [field.key, field.label]));
  const STATUS_LABELS = { new: 'New', failed: 'Failed', promising: 'Promising', approved: 'Approved' };

  function candidateFieldHtml(key, optional = false) {
    const meta = C.FIELD_META[key] || C.OPTIONAL_FIELDS.find(field => field.key === key);
    if (!meta) return '';
    const required = (!optional || key === 'resume') ? 'required' : '';
    const type = meta.type === 'file' ? 'file' : meta.type;
    const placeholder = key === 'name' ? 'e.g. Alex Morgan' : key === 'email' ? 'you@example.com' : '';
    return `<div class="candidate-field"><label for="candidate-${C.esc(key)}">${C.esc(meta.label)}${required ? ' <span aria-hidden="true">*</span>' : ''}</label><input id="candidate-${C.esc(key)}" name="${C.esc(key)}" type="${C.esc(type)}" ${required} ${meta.autocomplete ? `autocomplete="${C.esc(meta.autocomplete)}"` : ''} ${meta.accept ? `accept="${C.esc(meta.accept)}"` : ''} ${placeholder ? `placeholder="${C.esc(placeholder)}"` : ''} ${key === 'resume' ? 'class="file-input"' : ''}></div>`;
  }

  function mountCandidate(root, sourceFlow, options = {}) {
    let flow;
    try { flow = C.normalizeFlow(sourceFlow); }
    catch (error) { renderInvalid(root, error.message); return { destroy() {} }; }

    const live = Boolean(!options.preview && options.publishedFlowId && window.PathwayBackend && window.PathwayBackend.submitApplication);
    const state = { screen: 'landing', current: null, history: [], answers: {}, info: {}, resumeFile: null, questionCount: 0, submitting: false, submissionKey: crypto.randomUUID() };
    const start = C.startAfterInfo(flow);
    state.current = start;

    function render() {
      if (state.screen === 'landing') renderLanding();
      else if (state.screen === 'interstitial') renderInterstitial();
      else if (state.screen === 'question') renderQuestion();
      else if (state.screen === 'submitting') renderSubmitting();
      else if (state.screen === 'complete') renderComplete();
      else renderInvalid(root, 'This application could not be opened.');
    }

    function renderLanding() {
      const optional = C.OPTIONAL_FIELDS.filter(field => flow.candidateInfoFields && flow.candidateInfoFields[field.key]);
      const initials = (flow.companyName || 'P').trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase();
      root.innerHTML = `<div class="candidate-app"><header class="candidate-header"><a class="brand" href="#" aria-label="Pathway"><span class="brand-mark">↗</span>pathway</a><span class="candidate-header-note">${live ? 'Secure application' : 'Application preview'}</span></header><main class="candidate-landing"><section class="job-copy"><div class="company-lockup"><span class="company-avatar">${C.esc(initials || 'P')}</span><div><div class="company-label">${C.esc(flow.companyName || 'Hiring team')}</div><div class="muted" style="font-size:11px;margin-top:3px">Careers</div></div></div><div class="job-kicker">Open position</div><h1 class="job-title">${C.esc(flow.jobTitle || 'Open position')}</h1><div class="job-description">${C.esc(flow.jobDescription || 'We’re excited to meet you. Tell us a little about yourself to get started.')}</div><div class="job-meta"><span class="meta-chip">${live ? 'Accepting applications' : 'Preview'}</span><span class="meta-chip">${C.esc(flow.companyName || 'Hiring team')}</span></div><div class="job-about"><h2>How to apply</h2><p>Start with a few details, upload your resume, and answer a small number of questions tailored to this role. ${live ? 'Your application will be saved securely when you submit it.' : 'Nothing entered in this preview is saved.'}</p></div></section><section class="candidate-form-card"><h2>Start your application</h2><p class="form-intro">A few details to introduce yourself to ${C.esc(flow.companyName || 'the hiring team')}.</p><form id="candidate-info-form" novalidate>${candidateFieldHtml('name')}${candidateFieldHtml('email')}${candidateFieldHtml('resume')}${optional.map(field => candidateFieldHtml(field.key, true)).join('')}<div class="candidate-honeypot" aria-hidden="true"><label for="candidate-website">Leave this field empty</label><input id="candidate-website" name="website" type="text" tabindex="-1" autocomplete="off"></div><button class="btn btn-primary candidate-apply" type="submit">${live ? 'Apply for this role' : 'Preview application'} <span aria-hidden="true">→</span></button><p class="privacy-note">${live ? 'By submitting, you allow the company to use your information and answers to review your application' : 'Preview mode · Your details are not uploaded or stored.'}</p></form></section></main><footer class="candidate-footer">Powered by Pathway · A clearer way to hire</footer></div>`;
      const form = root.querySelector('#candidate-info-form');
      Object.entries(state.info).forEach(([key, value]) => { const input = form.elements[key]; if (input && input.type !== 'file' && input.type !== 'checkbox') input.value = value; });
      const resumeInput = form.elements.resume;
      if (state.resumeFile) {
        resumeInput.required = false;
        const resumeLabel = document.createElement('p'); resumeLabel.className = 'resume-selected-note';
        resumeLabel.textContent = `Selected resume: ${state.resumeFile.name} · Choose another file to replace it.`;
        resumeInput.insertAdjacentElement('afterend', resumeLabel);
      }
      form.addEventListener('submit', event => {
        event.preventDefault();
        if (!form.reportValidity()) return;
        const data = new FormData(form);
        state.info = {};
        [...data.entries()].forEach(([key, value]) => {
          if (key === 'name' || key === 'email') state.info[key] = String(value).trim();
          else if (key !== 'resume' && key !== 'privacyAcknowledged' && key !== 'website') state.info[key] = String(value).trim();
        });
        const picked = data.get('resume');
        if (picked && picked.size) state.resumeFile = picked;
        if (live) state.info.privacyAcknowledged = true; // Consent is recorded when the candidate submits under the notice.
        state.info.website = String(data.get('website') || '');
        if (!state.resumeFile) { resumeInput.required = true; resumeInput.reportValidity(); return; }
        if (state.current && state.current.type === 'end') { complete(state.current.subtype || 'submitted'); return; }
        state.screen = 'interstitial';
        render();
      });
    }

    function renderInterstitial() {
      root.innerHTML = `<main class="interstitial-screen"><section class="interstitial-content"><div class="interstitial-mark" aria-hidden="true">✳</div><div class="eyebrow" style="margin-bottom:13px">One more thing</div><h1>A little more about you.</h1><p>${C.esc(INFO_MESSAGE)}</p><div class="prototype-note">${live ? 'Your information and resume are saved only when you submit the completed application.' : 'Preview only · Nothing you enter is sent or stored.'}</div><button id="continue-questions" class="btn btn-primary">Continue to questions <span aria-hidden="true">→</span></button><div class="question-footnote">${C.esc(flow.companyName || 'The hiring team')} · ${C.esc(flow.jobTitle || 'Application')}</div></section></main>`;
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
        input = `<textarea class="answer-text" name="answer" placeholder="Write your answer here…" required maxlength="4000">${C.esc(previousAnswer || '')}</textarea>`;
      } else if (node.type === 'singleChoice') {
        input = `<div class="answer-area">${(node.options || []).map(value => `<label class="answer-option"><input type="radio" name="answer" value="${C.esc(value)}" required ${previousAnswer === value ? 'checked' : ''}><span>${C.esc(value)}</span></label>`).join('')}</div>`;
      } else if (node.type === 'multiChoice') {
        input = `<div class="answer-area">${(node.options || []).map(value => `<label class="answer-option"><input type="checkbox" name="answer" value="${C.esc(value)}" ${(Array.isArray(previousAnswer) && previousAnswer.includes(value)) ? 'checked' : ''}><span>${C.esc(value)}</span></label>`).join('')}</div>`;
      } else {
        renderInvalid(root, 'This application contains a question type that cannot be displayed.'); return;
      }
      const progress = Math.min(92, Math.max(10, state.questionCount * 17 + 18));
      root.innerHTML = `<main class="question-screen"><header class="question-top"><a class="brand" href="#" aria-label="Pathway"><span class="brand-mark">↗</span>pathway</a><span class="candidate-header-note">${C.esc(flow.companyName || 'Your application')}</span></header><section class="question-main"><div class="question-progress"><span>Question ${state.questionCount + 1}</span><div class="progress-track"><div class="progress-fill" style="width:${progress}%"></div></div></div><form id="question-form"><h1 class="question-heading">${C.esc(node.label || 'A question for you')}</h1>${input}<div class="question-actions"><button type="button" class="btn btn-quiet btn-sm" id="question-back">← Back</button><button type="submit" class="btn btn-primary">Continue <span aria-hidden="true">→</span></button></div></form><p class="question-footnote">${live ? 'Your answers are saved securely when you submit the completed application.' : 'Preview mode · Your answers are not saved.'}</p></section></main>`;
      const form = root.querySelector('#question-form');
      form.addEventListener('submit', event => {
        event.preventDefault();
        if (node.type === 'multiChoice' && !form.querySelector('input:checked')) {
          const first = form.querySelector('input[type="checkbox"]');
          if (first) { first.setCustomValidity('Choose at least one option.'); first.reportValidity(); first.setCustomValidity(''); }
          return;
        }
        if (node.type !== 'multiChoice' && !form.reportValidity()) return;
        const answer = node.type === 'multiChoice'
          ? [...form.querySelectorAll('input:checked')].map(inputEl => inputEl.value)
          : new FormData(form).get('answer');
        state.answers[node.id] = answer;
        const next = C.nextNode(flow, node, answer);
        if (!next) { renderInvalid(root, 'This question does not have a next step.'); return; }
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
      root.innerHTML = `<main class="completion-screen"><section class="completion-content"><div class="completion-mark submitting-mark" aria-hidden="true">↻</div><div class="eyebrow" style="margin-bottom:13px">Sending securely</div><h1>Submitting your application…</h1><p>Your answers and resume are being saved to the private hiring workspace. Please keep this page open for a moment.</p><div class="prototype-note">Your information is sent only to ${C.esc(flow.companyName || 'the hiring team')} for review.</div></section></main>`;
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
        const result = await window.PathwayBackend.submitApplication({
          publishedFlowId: options.publishedFlowId,
          submissionKey: state.submissionKey,
          name: state.info.name,
          email: state.info.email,
          candidateInfo: Object.fromEntries(Object.entries(state.info).filter(([key]) => !['name', 'email', 'privacyAcknowledged'].includes(key))),
          privacyAcknowledged: Boolean(state.info.privacyAcknowledged),
          answers: collectAnswers(),
          resume: state.resumeFile,
          website: state.info.website || ''
        });
        state.submitting = false;
        state.screen = 'complete';
        renderComplete();
      } catch (error) {
        state.submitting = false;
        state.screen = 'complete';
        renderSubmissionError(error.message || 'Please try again. Your application has not been sent.');
      }
    }

    function renderSubmissionError(message) {
      root.innerHTML = `<main class="completion-screen"><section class="completion-content"><div class="completion-mark submission-error-mark" aria-hidden="true">!</div><div class="eyebrow" style="margin-bottom:13px">Not submitted</div><h1>We couldn’t send your application.</h1><p>${C.esc(message)}</p><button class="btn btn-primary" id="retry-submit">Try again</button><div class="prototype-note">Your application is not complete until you see a confirmation here.</div></section></main>`;
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
      if (!copied) throw new Error('Clipboard access was denied.');
    }

    function renderComplete() {
      const isPreview = options.preview || !live;
      const vacancyUrl = window.location.href;
      const title = isPreview ? 'Preview complete' : 'Application submitted.';
      const intro = isPreview
        ? 'You have reached the end of this application preview for ' + C.esc(flow.companyName || 'the hiring team') + '.'
        : `Your application has been received by ${C.esc(flow.companyName || 'the hiring team')}. Thank you for your interest.`;
      const previewNote = isPreview
        ? '<div class="prototype-note">Preview only · Your details and answers were not stored or sent to the company.</div>'
        : '';
      root.innerHTML = `<main class="completion-screen"><section class="completion-content"><div class="completion-mark" aria-hidden="true">✓</div><div class="eyebrow" style="margin-bottom:13px">${C.esc(isPreview ? 'Preview complete' : 'Thank you')}</div><h1>${title}</h1><p>${intro}</p>${isPreview ? `<a class="btn btn-primary" href="#" id="finish-link">Return to preview</a>` : `<div class="completion-actions"><button class="btn btn-primary" id="finish-link" type="button">Done</button><button class="btn" id="share-job" type="button">Share this job</button></div>`}${previewNote}</section></main>`;
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
            shareButton.textContent = 'Link copied!';
          } catch (_) {
            shareButton.textContent = 'Copy failed';
          }
          window.clearTimeout(feedbackTimer);
          feedbackTimer = window.setTimeout(() => {
            if (shareButton.isConnected) shareButton.textContent = 'Share this job';
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
    root.innerHTML = `<main class="invalid-screen"><section class="invalid-content"><div class="invalid-mark" aria-hidden="true">!</div><div class="eyebrow" style="margin-bottom:13px">Link unavailable</div><h1>This link is invalid or incomplete.</h1><p>${C.esc(reason || 'Ask the hiring team for a fresh application link.')}</p><a class="btn btn-primary" href="index.html">Back to Pathway</a><div class="prototype-note">Published job pages load a read-only snapshot by its unique link. The private draft and hiring workspace remain inaccessible to public visitors.</div></section></main>`;
  }

  window.PathwayCandidate = { mountCandidate, renderInvalid, INFO_MESSAGE };
})();
