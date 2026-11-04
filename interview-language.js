/*
 * Which language is a job description written in? The language of the job decides the language of the AI interview (owner decision,
 * 2026-11-04). The job editor runs this while the employer types and shows the result, which the employer can always correct.
 * Three languages are supported by the interview: English (en), Portuguese (pt) and Spanish (es).
 *
 * How it decides (no network, no cost, same answer every time): it counts the very common words of each language in the text, adds a
 * few spelling hints (ã õ ç and -ção for Portuguese, ñ ¿ ¡ and -ción for Spanish) and picks the language that clearly leads.
 * A text that is too short, or where two languages are close, gives "unsure" (code null): the interview then waits until a person
 * chooses the language. In the browser it is window.PathwayLanguage; in Node it is module.exports.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PathwayLanguage = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const LANGUAGES = ['en', 'pt', 'es'];
  const NAMES = { en: 'English', pt: 'Português (Brasil)', es: 'Español' };
  const MIN_WORDS = 20;     // fewer words than this is never enough to be sure
  const MIN_LEAD = 2;       // the best language needs this many times the score of the second one
  const MIN_SCORE = 6;      // and at least this many hits

  const WORDS = {
    en: 'the and of to in is for with you will are our we as on be that this your or by an at from have has work team experience skills role join who they their all can about more which not it what when while also must should including strong ability looking responsible requirements responsibilities opportunity candidates company position part these other new its out up if any one been was were would per across within who well'.split(' '),
    pt: 'de que e o a os as do da dos das em no na nos nas um uma para com por não mais se ao aos você nós sua seu nossa nosso são ser tem como mas ou também experiência equipe trabalho vaga empresa será serão ter está entre sobre pelo pela já muito anos além conhecimento procuramos buscamos responsável requisitos responsabilidades oportunidade candidatos cargo parte esta este essa esse isso seus suas nossos nossas onde quando quem pessoas'.split(' '),
    es: 'de que y el la los las del en un una para con por no más se al usted nosotros su sus nuestra nuestro son ser tiene como pero o también experiencia equipo trabajo vacante empresa será serán tener está entre sobre ya muy años además conocimientos puesto buscamos responsable requisitos responsabilidades oportunidad candidatos cargo parte esta este esa ese eso nuestros nuestras donde cuando quien personas'.split(' '),
  };
  // Words that mean the same in two languages count once for each; the words below are the ones that tell the languages apart,
  // so they count double.
  const DISTINCT = {
    en: 'the and of you will our your with that this have team',
    pt: 'você não são também uma os as nós nossa seu sua com para experiência vaga',
    es: 'usted nosotros nuestra también una los las con para su sus experiencia vacante son',
  };
  const SETS = {}, DOUBLE = {};
  for (const lang of LANGUAGES) { SETS[lang] = new Set(WORDS[lang]); DOUBLE[lang] = new Set(DISTINCT[lang].split(' ')); }

  /** The words of a text, lower-case, with their accents (they are hints too). */
  function tokens(text) {
    return String(text == null ? '' : text).toLowerCase().match(/[a-zà-ÿñ]+/g) || [];
  }

  /**
   * { code, confidence, words, scores }. `code` is 'en', 'pt' or 'es', or null when the text is too short or the languages are too close.
   * `confidence` is 'high' (clear lead and plenty of text), 'low' (a lead, but short) or 'none'.
   */
  function detect(text) {
    const list = tokens(text);
    const scores = { en: 0, pt: 0, es: 0 };
    for (const word of list) {
      for (const lang of LANGUAGES) {
        if (SETS[lang].has(word)) scores[lang] += DOUBLE[lang].has(word) ? 2 : 1;
      }
      if (/ção$|ções$|ão$|ões$/.test(word)) scores.pt += 2;
      if (/ción$|ciones$|sión$/.test(word)) scores.es += 2;
      if (/[ãõç]/.test(word)) scores.pt += 1;
      if (/ñ/.test(word)) scores.es += 2;
    }
    if (/[¿¡]/.test(String(text))) scores.es += 3;
    const ranked = LANGUAGES.slice().sort((a, b) => scores[b] - scores[a]);
    const best = ranked[0], second = ranked[1];
    const result = { code: null, confidence: 'none', words: list.length, scores };
    if (list.length < MIN_WORDS || scores[best] < MIN_SCORE) return result;
    if (scores[second] > 0 && scores[best] < scores[second] * MIN_LEAD) return result;
    result.code = best;
    result.confidence = list.length >= 40 ? 'high' : 'low';
    return result;
  }

  function isSupported(code) {
    return LANGUAGES.includes(code);
  }

  return { LANGUAGES, NAMES, detect, isSupported };
});
