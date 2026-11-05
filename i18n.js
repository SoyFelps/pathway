/* Pathway interface language (English, Portuguese (Brazil), Spanish).
 *
 * How it works (plan: D:\Pathway\plano-idiomas.md):
 *  - The key is the English text itself: t('Delete account'). English needs no dictionary; a missing translation shows English.
 *  - Variables go inside braces: t('Rename {name}', { name }). t() never escapes HTML, so escape user data before passing it
 *    when the result goes into HTML. Dictionary texts are ours and never contain < > " or ` (a test checks).
 *  - Plurals: tn('{count} workspace', '{count} workspaces', count). The dictionary entry is keyed by the singular English
 *    text and holds { one, other } (and optionally many) for that language.
 *  - Dictionaries live in locales/<code>.js and register themselves in window.PathwayLocales.
 *  - The person's choice is stored in profiles.ui_language (empty = follow the browser). A copy in localStorage only paints
 *    the screens shown before sign-in.
 */
(function () {
  const SUPPORTED = ['en', 'pt-BR', 'es'];
  const STORAGE_KEY = 'pathway_ui_language';
  // Names are shown in their own language, so a person can always find theirs.
  const NAMES = { en: 'English', 'pt-BR': 'Português (Brasil)', es: 'Español' };

  // Any form of a supported language maps to it ("pt", "pt-PT", "es-MX", "en-GB"); anything else is not supported.
  function normalize(code) {
    const value = String(code || '').trim().toLowerCase();
    if (!value) return null;
    if (value === 'pt' || value.startsWith('pt-')) return 'pt-BR';
    if (value === 'es' || value.startsWith('es-')) return 'es';
    if (value === 'en' || value.startsWith('en-')) return 'en';
    return null;
  }

  function browserLanguage() {
    const nav = typeof navigator !== 'undefined' ? navigator : null;
    const list = nav ? (Array.isArray(nav.languages) && nav.languages.length ? nav.languages : [nav.language]) : [];
    for (const item of list) {
      const code = normalize(item);
      if (code) return code;
    }
    return 'en';
  }

  function readStored() {
    try { return normalize(window.localStorage.getItem(STORAGE_KEY)); } catch (_) { return null; }
  }
  function writeStored(code) {
    try {
      if (code) window.localStorage.setItem(STORAGE_KEY, code);
      else window.localStorage.removeItem(STORAGE_KEY);
    } catch (_) { /* private mode: the profile still remembers it */ }
  }

  let preference = readStored(); // null = automatic (browser language)
  let current = preference || browserLanguage();

  function applyDocumentLanguage() {
    if (typeof document !== 'undefined' && document.documentElement) document.documentElement.lang = current;
  }
  applyDocumentLanguage();

  function dictionary(code = current) {
    if (code === 'en') return null;
    const all = window.PathwayLocales || {};
    return all[code] || null;
  }

  function fill(text, vars) {
    if (!vars) return text;
    return text.replace(/\{(\w+)\}/g, (match, name) => (Object.prototype.hasOwnProperty.call(vars, name) && vars[name] != null ? String(vars[name]) : match));
  }

  function t(text, vars) {
    const key = String(text);
    const dict = dictionary();
    const entry = dict ? dict[key] : undefined;
    return fill(typeof entry === 'string' ? entry : key, vars);
  }

  let pluralRules = null;
  function pluralCategory(count) {
    if (!pluralRules || pluralRules.locale !== current) pluralRules = { locale: current, rules: new Intl.PluralRules(current) };
    return pluralRules.rules.select(Number(count) || 0);
  }

  function tn(one, other, count, vars) {
    const values = { count, ...(vars || {}) };
    const dict = dictionary();
    const entry = dict ? dict[String(one)] : undefined;
    if (entry && typeof entry === 'object') {
      const form = entry[pluralCategory(count)] || entry.other || entry.one;
      if (typeof form === 'string') return fill(form, values);
    }
    return fill(Number(count) === 1 ? String(one) : String(other), values);
  }

  // Dates and numbers follow the interface language.
  function formatDate(value, options) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat(current, options).format(date);
  }
  function formatNumber(value, options) {
    return new Intl.NumberFormat(current, options).format(Number(value) || 0);
  }

  // code = 'en' | 'pt-BR' | 'es', or null/'' for automatic. Returns the language now in use.
  function setPreference(code) {
    preference = normalize(code);
    current = preference || browserLanguage();
    writeStored(preference);
    applyDocumentLanguage();
    return current;
  }

  window.PathwayI18n = {
    SUPPORTED,
    NAMES,
    normalize,
    browserLanguage,
    t,
    tn,
    formatDate,
    formatNumber,
    setPreference,
    get language() { return current; },
    get preference() { return preference; }
  };
}());
