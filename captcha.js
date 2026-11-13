/* Cloudflare Turnstile CAPTCHA for the account screens (sign up, sign in, forgot password, delete account).
 * The same widget and the same public site key (turnstile-config.js) as the candidate form. The widget is invisible unless Cloudflare wants a
 * human check. The token is valid for five minutes and works once, so it is requested at the moment of submission, never earlier.
 * Without a site key (for example when turnstile-config.js did not load) it returns '' and the request goes without a token: Supabase only
 * refuses that when its own CAPTCHA protection is switched on (Authentication, Attack Protection).
 * The texts reuse keys that candidate.js already translates. */
(function () {
  const { t } = window.PathwayI18n;
  const TURNSTILE_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
  let loader = null;

  function loadTurnstile() {
    if (window.turnstile) return Promise.resolve(window.turnstile);
    if (!loader) {
      loader = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = TURNSTILE_SRC; script.async = true; script.defer = true;
        script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error(t('The security check could not load.'))));
        script.onerror = () => { loader = null; reject(new Error(t('The security check could not load. Check your connection or turn off content blockers, then try again.'))); };
        document.head.appendChild(script);
      });
    }
    return loader;
  }

  // container: an empty element inside the form that is being submitted (it must still be in the page when this is called).
  async function requestToken(container) {
    const siteKey = window.PATHWAY_TURNSTILE && window.PATHWAY_TURNSTILE.siteKey;
    if (!siteKey || !container) return '';
    const turnstile = await loadTurnstile();
    const language = window.PathwayI18n.language;
    return await new Promise((resolve, reject) => {
      let widgetId;
      const finish = (settle, value) => { try { turnstile.remove(widgetId); } catch (_) { /* the widget is already gone */ } settle(value); };
      const failure = () => new Error(t('We could not confirm that you are not a robot. Please try again.'));
      widgetId = turnstile.render(container, {
        sitekey: siteKey,
        language: language === 'pt-BR' ? 'pt-br' : language, // the security check speaks the page language too
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

  window.PathwayCaptcha = { requestToken };
})();
