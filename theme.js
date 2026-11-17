/* Nellio colour theme (dark mode, 2026-11-17). Loaded in <head> before the page is drawn, so there is no flash of the wrong theme.
   The person chooses Automatic (follows the device), Light or Dark; the choice is saved in this browser only (localStorage).
   Result: <html data-theme="light|dark">, read by styles.css. Only the app for recruiters uses it. */
(function () {
  var KEY = 'nellio-theme';
  var CHOICES = ['auto', 'light', 'dark'];
  var memory = null; // used when the browser blocks storage
  var query = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  function stored() {
    try { var value = window.localStorage.getItem(KEY); return CHOICES.indexOf(value) >= 0 ? value : 'auto'; }
    catch (error) { return memory || 'auto'; }
  }
  function resolve(choice) {
    if (choice === 'dark' || choice === 'light') return choice;
    return query && query.matches ? 'dark' : 'light';
  }
  function apply() {
    var theme = resolve(stored());
    document.documentElement.setAttribute('data-theme', theme);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#121c17' : '#f8f8f8');
    labelButtons(theme);
    return theme;
  }
  // The light / dark button (side menu of the app and the sign-in screens) says what it will do; its two texts come from the screen, already translated.
  function labelButtons(theme) {
    var buttons = document.querySelectorAll ? document.querySelectorAll('.theme-toggle') : [];
    for (var i = 0; i < buttons.length; i++) {
      var label = buttons[i].getAttribute(theme === 'dark' ? 'data-to-light' : 'data-to-dark');
      if (label) { buttons[i].title = label; buttons[i].setAttribute('aria-label', label); }
    }
  }

  window.NellioTheme = {
    CHOICES: CHOICES,
    get: stored,
    resolved: function () { return resolve(stored()); },
    buttonHtml: function (toLight, toDark) {
      var dark = resolve(stored()) === 'dark';
      var label = dark ? toLight : toDark;
      return '<button class="theme-toggle" type="button" title="' + label + '" aria-label="' + label + '" data-to-light="' + toLight + '" data-to-dark="' + toDark + '">' +
        '<svg class="icon-moon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>' +
        '<svg class="icon-sun" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg></button>';
    },
    set: function (choice) {
      if (CHOICES.indexOf(choice) < 0) choice = 'auto';
      memory = choice === 'auto' ? null : choice;
      try { if (choice === 'auto') window.localStorage.removeItem(KEY); else window.localStorage.setItem(KEY, choice); } catch (error) { /* private window: the choice lasts until the page closes */ }
      return apply();
    }
  };

  apply();
  // One listener for every light / dark button, whatever screen draws it.
  document.addEventListener('click', function (event) {
    var button = event.target && event.target.closest ? event.target.closest('.theme-toggle') : null;
    if (button) window.NellioTheme.set(resolve(stored()) === 'dark' ? 'light' : 'dark');
  });
  // In Automatic mode the page follows the device when it switches between light and dark.
  if (query) {
    var follow = function () { if (stored() === 'auto') apply(); };
    if (query.addEventListener) query.addEventListener('change', follow); else if (query.addListener) query.addListener(follow);
  }
})();
