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
    return theme;
  }

  window.NellioTheme = {
    CHOICES: CHOICES,
    get: stored,
    resolved: function () { return resolve(stored()); },
    set: function (choice) {
      if (CHOICES.indexOf(choice) < 0) choice = 'auto';
      memory = choice === 'auto' ? null : choice;
      try { if (choice === 'auto') window.localStorage.removeItem(KEY); else window.localStorage.setItem(KEY, choice); } catch (error) { /* private window: the choice lasts until the page closes */ }
      return apply();
    }
  };

  apply();
  // In Automatic mode the page follows the device when it switches between light and dark.
  if (query) {
    var follow = function () { if (stored() === 'auto') apply(); };
    if (query.addEventListener) query.addEventListener('change', follow); else if (query.addListener) query.addListener(follow);
  }
})();
