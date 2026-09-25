/* Shared candidate journey renderer used by apply.html and the builder preview. */
(function () {
  const C = window.PathwayCore;
  const INFO_MESSAGE = 'The company wants to know a little bit more about you. Please answer the following questions to submit your application.';

  function candidateFieldHtml(key, optional = false) {
    const meta = C.FIELD_META[key] || C.OPTIONAL_FIELDS.find(field => field.key === key);
    if (!meta) return '';
    const required = !optional || key === 'resume' ? 'required' : '';
    const type = meta.type === 'file' ? 'file' : meta.type;
    const placeholder = key === 'name' ? 'e.g. Alex Morgan' : key === 'email' ? 'you@example.com' : '';
    return `<div class="candidate-field"><label for="candidate-${C.esc(key)}">${C.esc(meta.label)}${required ? ' <span aria-hidden="true">*</span>' : ''}</label><input id="candidate-${C.esc(key)}" name="${C.esc(key)}" type="${C.esc(type)}" ${required} ${meta.autocomplete ? `autocomplete="${C.esc(meta.autocomplete)}"` : ''} ${meta.accept ? `accept="${C.esc(meta.accept)}"` : ''} ${placeholder ? `placeholder="${C.esc(placeholder)}"` : ''} ${key === 'resume' ? 'class="file-input"' : ''}></div>`;
  }

  function mountCandidate(root, sourceFlow, options = {}) {
    let flow;
    try { flow = C.normalizeFlow(sourceFlow); }
    catch (error) { renderInvalid(root, error.message); return { destroy() {} }; }

    const state = { screen: 'landing', current: null, history: [], answers: {}, info: {}, questionCount: 0 };
    const start = C.startAfterInfo(flow);
    state.current = start;

    function render() {
      if (state.screen === 'landing') renderLanding();
      else if (state.screen === 'interstitial') renderInterstitial();
      else if (state.screen === 'question') renderQuestion();
      else if (state.screen === 'complete') renderComplete();
      else renderInvalid(root, 'This application could not be opened.');
    }

    function renderLanding() {
      const optional = C.OPTIONAL_FIELDS.filter(field => flow.candidateInfoFields && flow.candidateInfoFields[field.key]);
      const initials = (flow.companyName || 'P').trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase();
      root.innerHTML = `<div class="candidate-app"><header class="candidate-header"><a class="brand" href="#" aria-label="Pathway"><span class="brand-mark">↗</span>pathway</a><span class="candidate-header-note">A thoughtful application starts here</span></header><main class="candidate-landing"><section class="job-copy"><div class="company-lockup"><span class="company-avatar">${C.esc(initials || 'P')}</span><div><div class="company-label">${C.esc(flow.companyName || 'Hiring team')}</div><div class="muted" style="font-size:11px;margin-top:3px">Careers</div></div></div><div class="job-kicker">Open position</div><h1 class="job-title">${C.esc(flow.jobTitle || 'Open position')}</h1><div class="job-description">${C.esc(flow.jobDescription || 'We’re excited to meet you. Tell us a little about yourself to get started.')}</div><div class="job-meta"><span class="meta-chip">Application · 3 min</span><span class="meta-chip">Direct application</span></div><div class="job-about"><h2>How to apply</h2><p>Start with a few details about yourself. We’ll then ask a small number of questions tailored to this role. Your progress stays in this browser while you complete the application.</p></div></section><section class="candidate-form-card"><h2>Start your application</h2><p class="form-intro">A few details to introduce yourself to ${C.esc(flow.companyName || 'the hiring team')}.</p><form id="candidate-info-form" novalidate>${candidateFieldHtml('name')}${candidateFieldHtml('email')}${candidateFieldHtml('resume')}${optional.map(field => candidateFieldHtml(field.key, true)).join('')}<button class="btn btn-primary candidate-apply" type="submit">Apply for this role <span aria-hidden="true">→</span></button><p class="privacy-note">Your information is only used for this prototype and stays in this browser.</p></form></section></main><footer class="candidate-footer">Powered by Pathway · A clearer way to hire</footer></div>`;
      const form = root.querySelector('#candidate-info-form');
      Object.entries(state.info).forEach(([key, value]) => { const input = form.elements[key]; if (input && input.type !== 'file') input.value = value; });
      form.addEventListener('submit', event => {
        event.preventDefault();
        if (!form.reportValidity()) return;
        const data = new FormData(form);
        state.info = {};
        [...data.entries()].forEach(([key, value]) => {
          state.info[key] = key === 'resume' ? (value && value.name ? value.name : '') : String(value).trim();
        });
        if (state.current && state.current.type === 'end') { complete(state.current.subtype || 'submitted'); return; }
        state.screen = 'interstitial';
        render();
      });
    }

    function renderInterstitial() {
      root.innerHTML = `<main class="interstitial-screen"><section class="interstitial-content"><div class="interstitial-mark" aria-hidden="true">✳</div><div class="eyebrow" style="margin-bottom:13px">One more thing</div><h1>A little more about you.</h1><p>${C.esc(INFO_MESSAGE)}</p><button id="continue-questions" class="btn btn-primary">Continue to questions <span aria-hidden="true">→</span></button><div class="question-footnote">${C.esc(flow.companyName || 'The hiring team')} · ${C.esc(flow.jobTitle || 'Application')}</div></section></main>`;
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
      const outgoing = flow.edges.filter(edge => edge.fromNodeId === node.id);
      let input = '';
      const previousAnswer = state.answers[node.id];
      if (node.type === 'shortText') {
        input = `<textarea class="answer-text" name="answer" placeholder="Write your answer here…" required>${C.esc(previousAnswer || '')}</textarea>`;
      } else if (node.type === 'singleChoice') {
        input = `<div class="answer-area">${(node.options || []).map((value, index) => `<label class="answer-option"><input type="radio" name="answer" value="${C.esc(value)}" required ${previousAnswer === value ? 'checked' : ''}><span>${C.esc(value)}</span></label>`).join('')}</div>`;
      } else if (node.type === 'multiChoice') {
        input = `<div class="answer-area">${(node.options || []).map((value, index) => `<label class="answer-option"><input type="checkbox" name="answer" value="${C.esc(value)}" ${(Array.isArray(previousAnswer) && previousAnswer.includes(value)) ? 'checked' : ''}><span>${C.esc(value)}</span></label>`).join('')}</div>`;
      } else {
        renderInvalid(root, 'This application contains a question type that cannot be displayed.'); return;
      }
      const progress = Math.min(92, Math.max(10, state.questionCount * 17 + 18));
      root.innerHTML = `<main class="question-screen"><header class="question-top"><a class="brand" href="#" aria-label="Pathway"><span class="brand-mark">↗</span>pathway</a><span class="candidate-header-note">${C.esc(flow.companyName || 'Your application')}</span></header><section class="question-main"><div class="question-progress"><span>Question ${state.questionCount + 1}</span><div class="progress-track"><div class="progress-fill" style="width:${progress}%"></div></div></div><form id="question-form"><h1 class="question-heading">${C.esc(node.label || 'A question for you')}</h1>${input}<div class="question-actions"><button type="button" class="btn btn-quiet btn-sm" id="question-back">← Back</button><button type="submit" class="btn btn-primary">Continue <span aria-hidden="true">→</span></button></div></form><p class="question-footnote">Your answers are saved only when you complete this prototype application.</p></section></main>`;
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

    function complete(subtype, endingLabel) {
      state.screen = 'complete';
      const isDisqualified = subtype === 'disqualified';
      const collected = { companyName: flow.companyName, jobTitle: flow.jobTitle, candidateInfo: state.info, answers: state.answers, completedAt: new Date().toISOString() };
      if (!options.preview && !state.logged) {
        state.logged = true;
        console.info('[Pathway prototype] Application received (local demo only):', collected);
        try {
          const existing = JSON.parse(localStorage.getItem(C.ANSWERS_KEY) || '[]');
          existing.push(collected);
          localStorage.setItem(C.ANSWERS_KEY, JSON.stringify(existing));
        } catch (error) { console.warn('Pathway could not save this local demo submission.', error); }
      }
      root.innerHTML = `<main class="completion-screen ${isDisqualified ? 'disqualified' : ''}"><section class="completion-content"><div class="completion-mark" aria-hidden="true">${isDisqualified ? '↗' : '✓'}</div><div class="eyebrow" style="margin-bottom:13px">${isDisqualified ? 'Thank you for your interest' : 'Application complete'}</div><h1>${isDisqualified ? 'Thanks for sharing.' : C.esc(endingLabel || 'Application received.')}</h1><p>${isDisqualified ? 'Based on the information shared, this role may not be the right fit right now. We appreciate your time and interest in ' + C.esc(flow.companyName || 'our team') + '.' : C.esc(flow.companyName || 'The hiring team') + ' has received your application. Thanks for taking the time to share a little about yourself.'}</p><a class="btn btn-primary" href="${options.preview ? '#' : 'index.html'}" id="finish-link">${options.preview ? 'Return to preview' : 'Done'}</a><div class="prototype-note">${options.preview ? 'Preview mode · Answers are not stored.' : 'Prototype note: answers are stored only in this browser as a demonstration. No hiring system or company receives them.'}</div></section></main>`;
      root.querySelector('#finish-link').addEventListener('click', event => { if (options.preview) { event.preventDefault(); options.onFinish && options.onFinish(); } });
    }

    render();
    return { destroy() { root.innerHTML = ''; }, restart() { state.screen = 'landing'; state.current = start; state.history = []; state.answers = {}; state.info = {}; state.questionCount = 0; render(); } };
  }

  function renderInvalid(root, reason) {
    root.innerHTML = `<main class="invalid-screen"><section class="invalid-content"><div class="invalid-mark" aria-hidden="true">!</div><div class="eyebrow" style="margin-bottom:13px">Link unavailable</div><h1>This link is invalid or incomplete.</h1><p>${C.esc(reason || 'Ask the hiring team for a fresh application link.')}</p><a class="btn btn-primary" href="index.html">Back to Pathway</a><div class="prototype-note">This is a static prototype. Published links contain the application flow in the URL; no account or server is needed.</div></section></main>`;
  }

  window.PathwayCandidate = { mountCandidate, renderInvalid, INFO_MESSAGE };
})();
