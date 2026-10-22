/* Pathway: countries, pronouns and the searchable list ("combobox") used by the application form. */
(function () {
  // [ISO code, English name, extra search words]. The names are what is stored; the server (supabase/functions/applications/geo.ts) accepts exactly these.
  const COUNTRIES = [
    ['AF', 'Afghanistan'], ['AX', 'Åland Islands', 'aland'], ['AL', 'Albania'], ['DZ', 'Algeria'], ['AS', 'American Samoa'], ['AD', 'Andorra'],
    ['AO', 'Angola'], ['AI', 'Anguilla'], ['AQ', 'Antarctica'], ['AG', 'Antigua and Barbuda'], ['AR', 'Argentina'], ['AM', 'Armenia'],
    ['AW', 'Aruba'], ['AU', 'Australia'], ['AT', 'Austria'], ['AZ', 'Azerbaijan'], ['BS', 'Bahamas'], ['BH', 'Bahrain'],
    ['BD', 'Bangladesh'], ['BB', 'Barbados'], ['BY', 'Belarus'], ['BE', 'Belgium'], ['BZ', 'Belize'], ['BJ', 'Benin'],
    ['BM', 'Bermuda'], ['BT', 'Bhutan'], ['BO', 'Bolivia'], ['BQ', 'Bonaire, Sint Eustatius and Saba', 'caribbean netherlands'], ['BA', 'Bosnia and Herzegovina'],
    ['BW', 'Botswana'], ['BV', 'Bouvet Island'], ['BR', 'Brazil', 'brasil'], ['IO', 'British Indian Ocean Territory'], ['VG', 'British Virgin Islands'],
    ['BN', 'Brunei'], ['BG', 'Bulgaria'], ['BF', 'Burkina Faso'], ['BI', 'Burundi'], ['CV', 'Cabo Verde', 'cape verde'],
    ['KH', 'Cambodia'], ['CM', 'Cameroon'], ['CA', 'Canada'], ['KY', 'Cayman Islands'], ['CF', 'Central African Republic'],
    ['TD', 'Chad'], ['CL', 'Chile'], ['CN', 'China'], ['CX', 'Christmas Island'], ['CC', 'Cocos (Keeling) Islands'],
    ['CO', 'Colombia'], ['KM', 'Comoros'], ['CG', 'Congo', 'republic of the congo'], ['CD', 'Democratic Republic of the Congo', 'drc dr congo congo-kinshasa'],
    ['CK', 'Cook Islands'], ['CR', 'Costa Rica'], ['CI', 'Côte d’Ivoire', 'ivory coast cote d ivoire'], ['HR', 'Croatia'], ['CU', 'Cuba'],
    ['CW', 'Curaçao', 'curacao'], ['CY', 'Cyprus'], ['CZ', 'Czechia', 'czech republic'], ['DK', 'Denmark'], ['DJ', 'Djibouti'],
    ['DM', 'Dominica'], ['DO', 'Dominican Republic'], ['EC', 'Ecuador'], ['EG', 'Egypt'], ['SV', 'El Salvador'],
    ['GQ', 'Equatorial Guinea'], ['ER', 'Eritrea'], ['EE', 'Estonia'], ['SZ', 'Eswatini', 'swaziland'], ['ET', 'Ethiopia'],
    ['FK', 'Falkland Islands', 'malvinas'], ['FO', 'Faroe Islands'], ['FJ', 'Fiji'], ['FI', 'Finland'], ['FR', 'France'],
    ['GF', 'French Guiana'], ['PF', 'French Polynesia'], ['TF', 'French Southern Territories'], ['GA', 'Gabon'], ['GM', 'Gambia'],
    ['GE', 'Georgia'], ['DE', 'Germany', 'deutschland'], ['GH', 'Ghana'], ['GI', 'Gibraltar'], ['GR', 'Greece'],
    ['GL', 'Greenland'], ['GD', 'Grenada'], ['GP', 'Guadeloupe'], ['GU', 'Guam'], ['GT', 'Guatemala'],
    ['GG', 'Guernsey'], ['GN', 'Guinea'], ['GW', 'Guinea-Bissau'], ['GY', 'Guyana'], ['HT', 'Haiti'],
    ['HM', 'Heard Island and McDonald Islands'], ['VA', 'Vatican City', 'holy see'], ['HN', 'Honduras'], ['HK', 'Hong Kong'], ['HU', 'Hungary'],
    ['IS', 'Iceland'], ['IN', 'India'], ['ID', 'Indonesia'], ['IR', 'Iran', 'persia'], ['IQ', 'Iraq'],
    ['IE', 'Ireland'], ['IM', 'Isle of Man'], ['IL', 'Israel'], ['IT', 'Italy'], ['JM', 'Jamaica'],
    ['JP', 'Japan'], ['JE', 'Jersey'], ['JO', 'Jordan'], ['KZ', 'Kazakhstan'], ['KE', 'Kenya'],
    ['KI', 'Kiribati'], ['XK', 'Kosovo'], ['KW', 'Kuwait'], ['KG', 'Kyrgyzstan'], ['LA', 'Laos'],
    ['LV', 'Latvia'], ['LB', 'Lebanon'], ['LS', 'Lesotho'], ['LR', 'Liberia'], ['LY', 'Libya'],
    ['LI', 'Liechtenstein'], ['LT', 'Lithuania'], ['LU', 'Luxembourg'], ['MO', 'Macao', 'macau'], ['MG', 'Madagascar'],
    ['MW', 'Malawi'], ['MY', 'Malaysia'], ['MV', 'Maldives'], ['ML', 'Mali'], ['MT', 'Malta'],
    ['MH', 'Marshall Islands'], ['MQ', 'Martinique'], ['MR', 'Mauritania'], ['MU', 'Mauritius'], ['YT', 'Mayotte'],
    ['MX', 'Mexico'], ['FM', 'Micronesia'], ['MD', 'Moldova'], ['MC', 'Monaco'], ['MN', 'Mongolia'],
    ['ME', 'Montenegro'], ['MS', 'Montserrat'], ['MA', 'Morocco'], ['MZ', 'Mozambique'], ['MM', 'Myanmar', 'burma'],
    ['NA', 'Namibia'], ['NR', 'Nauru'], ['NP', 'Nepal'], ['NL', 'Netherlands', 'holland'], ['NC', 'New Caledonia'],
    ['NZ', 'New Zealand'], ['NI', 'Nicaragua'], ['NE', 'Niger'], ['NG', 'Nigeria'], ['NU', 'Niue'],
    ['NF', 'Norfolk Island'], ['KP', 'North Korea', 'korea'], ['MK', 'North Macedonia', 'macedonia'], ['MP', 'Northern Mariana Islands'], ['NO', 'Norway'],
    ['OM', 'Oman'], ['PK', 'Pakistan'], ['PW', 'Palau'], ['PS', 'Palestine'], ['PA', 'Panama'],
    ['PG', 'Papua New Guinea'], ['PY', 'Paraguay'], ['PE', 'Peru'], ['PH', 'Philippines'], ['PN', 'Pitcairn Islands'],
    ['PL', 'Poland'], ['PT', 'Portugal'], ['PR', 'Puerto Rico'], ['QA', 'Qatar'], ['RE', 'Réunion', 'reunion'],
    ['RO', 'Romania'], ['RU', 'Russia', 'russian federation'], ['RW', 'Rwanda'], ['BL', 'Saint Barthélemy', 'st barthelemy'], ['SH', 'Saint Helena, Ascension and Tristan da Cunha'],
    ['KN', 'Saint Kitts and Nevis', 'st kitts'], ['LC', 'Saint Lucia', 'st lucia'], ['MF', 'Saint Martin', 'st martin'], ['PM', 'Saint Pierre and Miquelon'], ['VC', 'Saint Vincent and the Grenadines', 'st vincent'],
    ['WS', 'Samoa'], ['SM', 'San Marino'], ['ST', 'São Tomé and Príncipe', 'sao tome'], ['SA', 'Saudi Arabia'], ['SN', 'Senegal'],
    ['RS', 'Serbia'], ['SC', 'Seychelles'], ['SL', 'Sierra Leone'], ['SG', 'Singapore'], ['SX', 'Sint Maarten'],
    ['SK', 'Slovakia'], ['SI', 'Slovenia'], ['SB', 'Solomon Islands'], ['SO', 'Somalia'], ['ZA', 'South Africa'],
    ['GS', 'South Georgia and the South Sandwich Islands'], ['KR', 'South Korea', 'korea republic of korea'], ['SS', 'South Sudan'], ['ES', 'Spain', 'espana'], ['LK', 'Sri Lanka'],
    ['SD', 'Sudan'], ['SR', 'Suriname'], ['SJ', 'Svalbard and Jan Mayen'], ['SE', 'Sweden'], ['CH', 'Switzerland'],
    ['SY', 'Syria'], ['TW', 'Taiwan'], ['TJ', 'Tajikistan'], ['TZ', 'Tanzania'], ['TH', 'Thailand'],
    ['TL', 'Timor-Leste', 'east timor'], ['TG', 'Togo'], ['TK', 'Tokelau'], ['TO', 'Tonga'], ['TT', 'Trinidad and Tobago'],
    ['TN', 'Tunisia'], ['TR', 'Türkiye', 'turkey turkiye'], ['TM', 'Turkmenistan'], ['TC', 'Turks and Caicos Islands'], ['TV', 'Tuvalu'],
    ['UG', 'Uganda'], ['UA', 'Ukraine'], ['AE', 'United Arab Emirates', 'uae emirates'], ['GB', 'United Kingdom', 'uk great britain britain england scotland wales northern ireland'], ['US', 'United States', 'usa u s a america us'],
    ['UM', 'U.S. Minor Outlying Islands'], ['VI', 'U.S. Virgin Islands'], ['UY', 'Uruguay'], ['UZ', 'Uzbekistan'], ['VU', 'Vanuatu'],
    ['VE', 'Venezuela'], ['VN', 'Vietnam', 'viet nam'], ['WF', 'Wallis and Futuna'], ['EH', 'Western Sahara'], ['YE', 'Yemen'],
    ['ZM', 'Zambia'], ['ZW', 'Zimbabwe']
  ];
  // What the "Pronouns" list offers. "Other" lets the person write their own (stored as "Other: ..." with at most PRONOUN_OTHER_MAX characters).
  const PRONOUNS = ['He/him', 'She/her', 'They/them', 'He/they', 'She/they', 'Ze/zir', 'Xe/xem', 'It/its', 'Prefer not to say'];
  const PRONOUN_OTHER = 'Other';
  const PRONOUN_OTHER_MAX = 40;
  const CITY_LIST_URL = 'vendor/geonames/cities15000.json';

  // Voluntary self-identification (the optional "Diversity questions" page). Every question needs an answer, and every one offers "Prefer not to say".
  // The server accepts exactly these values (geo.ts is generated from this file). disabilityType is only asked when disability is "Yes".
  const PREFER_NOT_TO_SAY = 'Prefer not to say';
  const DIVERSITY = {
    genderIdentity: { label: 'Gender identity', options: ['Woman', 'Man', 'Non-binary', 'Another gender identity', PREFER_NOT_TO_SAY] },
    sexualOrientation: { label: 'Sexual orientation', options: ['Heterosexual or straight', 'Gay or lesbian', 'Bisexual', 'Pansexual', 'Asexual', 'Another sexual orientation', PREFER_NOT_TO_SAY] },
    raceEthnicity: { label: 'Race and ethnicity', options: ['Hispanic or Latino', 'White (not Hispanic or Latino)', 'Black or African American (not Hispanic or Latino)', 'Asian (not Hispanic or Latino)', 'Native Hawaiian or Other Pacific Islander (not Hispanic or Latino)', 'American Indian or Alaska Native (not Hispanic or Latino)', 'Two or more races (not Hispanic or Latino)', 'Another race or ethnicity', PREFER_NOT_TO_SAY] },
    disability: { label: 'Do you have a disability or a chronic condition?', options: ['Yes', 'No', PREFER_NOT_TO_SAY] },
    disabilityType: { label: 'Which best describes it?', options: ['Physical or mobility', 'Visual', 'Hearing', 'Neurodivergence (for example ADHD, autism or dyslexia)', 'Mental health', 'Chronic illness', 'More than one of these', 'Another disability or condition', PREFER_NOT_TO_SAY] }
  };
  const DIVERSITY_KEYS = ['genderIdentity', 'sexualOrientation', 'raceEthnicity', 'disability', 'disabilityType'];

  const COUNTRY_NAMES = COUNTRIES.map(country => country[1]);
  const COUNTRY_BY_CODE = new Map(COUNTRIES.map(country => [country[0], country[1]]));

  function normalize(text) {
    return String(text == null ? '' : text).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }

  // Items are { label, key (normalized search text), nameKey (normalized main name), aliasKey (normalized other names, optional) }. Best matches first:
  // the typed word is one of the item's other names ("uk", "usa"), then the name starts with it, then a word starts with it, then it appears anywhere.
  // Items keep their own order inside each group (cities come largest first).
  function rankItems(items, query, max) {
    const tokens = normalize(query).split(' ').filter(Boolean);
    if (!tokens.length) return items.slice(0, max);
    const groups = [[], [], [], []];
    for (const item of items) {
      let ok = true;
      for (const token of tokens) if (!item.key.includes(token)) { ok = false; break; }
      if (!ok) continue;
      const group = item.aliasKey && tokens.length === 1 && (' ' + item.aliasKey + ' ').includes(' ' + tokens[0] + ' ') ? 0
        : item.nameKey.startsWith(tokens[0]) ? 1 : (' ' + item.key).includes(' ' + tokens[0]) ? 2 : 3;
      groups[group].push(item);
      if (groups[0].length + groups[1].length >= max) break;
    }
    return groups[0].concat(groups[1], groups[2], groups[3]).slice(0, max);
  }

  function countryItems() {
    return COUNTRIES.map(([, name, extra]) => ({ label: name, nameKey: normalize(name), aliasKey: normalize(extra || ''), key: normalize(name + ' ' + (extra || '')) }));
  }

  let cityRequest = null;
  function loadCityItems() {
    if (!cityRequest) {
      cityRequest = fetch(CITY_LIST_URL).then(response => {
        if (!response.ok) throw new Error('The city list could not be loaded.');
        return response.json();
      }).then(data => {
        if (!data || !Array.isArray(data.cities) || !Array.isArray(data.countries) || !Array.isArray(data.regions)) throw new Error('The city list is not valid.');
        const countryNames = data.countries.map(code => COUNTRY_BY_CODE.get(code) || code);
        return data.cities.map(([name, region, country]) => {
          const regionName = region >= 0 ? data.regions[region] : '';
          const label = [name, regionName && regionName !== name ? regionName : '', countryNames[country]].filter(Boolean).join(', ');
          return { label, nameKey: normalize(name), key: normalize(label) };
        });
      });
      cityRequest.catch(() => { cityRequest = null; });
    }
    return cityRequest;
  }

  let comboCounter = 0;
  // Scrolls ONLY the list so that the item is visible (or in the middle). scrollIntoView() also scrolls the page, which jumped the form around.
  function scrollListTo(list, item, center) {
    if (!item) return;
    const top = item.offsetTop, bottom = top + item.offsetHeight;
    if (center) list.scrollTop = top - (list.clientHeight - item.offsetHeight) / 2;
    else if (top < list.scrollTop) list.scrollTop = top;
    else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight;
  }
  // Turns a text input into a searchable list. strict: only a value from the list is accepted; allowCustom: the typed text may also be used as it is.
  function attachCombobox(input, options) {
    const { items, loadItems, strict = false, fullListOnFocus = strict, allowCustom = false, maxResults = 8, invalidMessage = 'Choose a value from the list.', loadingText = 'Loading…' } = options;
    const wrap = input.parentElement;
    wrap.classList.add('combo');
    const list = document.createElement('ul');
    list.className = 'combo-list'; list.id = (input.id || 'combo') + '-list-' + (++comboCounter); list.setAttribute('role', 'listbox'); list.hidden = true;
    wrap.appendChild(list);
    input.setAttribute('role', 'combobox'); input.setAttribute('aria-autocomplete', 'list'); input.setAttribute('aria-expanded', 'false'); input.setAttribute('aria-controls', list.id);
    input.setAttribute('autocomplete', 'off'); input.setAttribute('autocapitalize', 'off'); input.spellcheck = false;
    let all = items || null, loading = false, failed = false, shown = [], active = -1, pristine = false; // pristine: opened and not typed in yet

    const exact = value => all && all.find(item => item.nameKey === normalize(value) || normalize(item.label) === normalize(value));
    const syncValidity = () => { const value = input.value.trim(); input.setCustomValidity(strict && value && all && !exact(value) ? invalidMessage : ''); };
    const close = () => { list.hidden = true; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); active = -1; };
    const choose = item => { input.value = item.label; pristine = fullListOnFocus; syncValidity(); close(); input.dispatchEvent(new Event('change', { bubbles: true })); };
    function paint() {
      list.innerHTML = '';
      if (loading) { const li = document.createElement('li'); li.className = 'combo-note'; li.textContent = loadingText; list.appendChild(li); }
      shown.forEach((item, index) => {
        const li = document.createElement('li');
        li.id = list.id + '-' + index; li.setAttribute('role', 'option'); li.setAttribute('aria-selected', index === active ? 'true' : 'false');
        li.className = 'combo-option' + (item.custom ? ' is-custom' : '') + (index === active ? ' is-active' : '');
        li.textContent = item.custom ? 'Use “' + item.label + '”' : item.label;
        li.addEventListener('mousedown', event => { event.preventDefault(); choose(item); });
        list.appendChild(li);
      });
      if (!loading && !shown.length) { const li = document.createElement('li'); li.className = 'combo-note'; li.textContent = failed ? 'The list is not available. Type it in your own words.' : 'No match'; list.appendChild(li); }
      list.hidden = false; input.setAttribute('aria-expanded', 'true');
      if (active >= 0) input.setAttribute('aria-activedescendant', list.id + '-' + active); else input.removeAttribute('aria-activedescendant');
    }
    function update() {
      const value = input.value.trim();
      // Opened but not typed in yet: show the whole list (the chosen value is just highlighted), so the person can pick another one straight away.
      shown = all ? rankItems(all, pristine ? '' : value, maxResults) : [];
      if (allowCustom && !pristine && value && !shown.some(item => normalize(item.label) === normalize(value))) shown.push({ label: value, custom: true });
      const current = pristine && value ? exact(value) : null;
      active = shown.length ? Math.max(0, current ? shown.indexOf(current) : 0) : -1;
      paint();
      if (pristine) scrollListTo(list, list.querySelector('.is-active'), true);
    }
    async function open() {
      if (!all && loadItems && !loading) {
        loading = true; update();
        try { all = await loadItems(); } catch { all = []; failed = true; }
        loading = false;
      }
      if (document.activeElement === input) update();
    }
    input.addEventListener('focus', () => { pristine = fullListOnFocus; if (pristine) setTimeout(() => { if (document.activeElement === input) input.select(); }, 0); open(); });
    input.addEventListener('mouseup', event => { if (pristine) event.preventDefault(); }); // keep the text selected after the click
    // The field is still focused after a country was picked: a new click must select the text again (not drop the caret in the middle of the word) and open the list.
    input.addEventListener('click', () => { if (pristine) { input.select(); if (list.hidden) open(); } });
    input.addEventListener('input', () => { pristine = false; syncValidity(); open(); });
    input.addEventListener('blur', () => {
      pristine = false;
      const match = strict && exact(input.value);
      if (match) input.value = match.label;
      syncValidity(); close();
    });
    input.addEventListener('keydown', event => {
      const isOpen = !list.hidden;
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        if (!isOpen) { open(); return; }
        if (!shown.length) return;
        active = (active + (event.key === 'ArrowDown' ? 1 : -1) + shown.length) % shown.length; paint();
        scrollListTo(list, list.querySelector('.is-active'), false);
      } else if (event.key === 'Enter' && isOpen && active >= 0 && shown[active]) { event.preventDefault(); choose(shown[active]); }
      else if (event.key === 'Escape' && isOpen) { event.preventDefault(); close(); }
    });
    syncValidity();
    return { input, list };
  }

  // ---- Phone number: a country (calling code) list plus a field that is formatted the way that country writes numbers ((31) 99999-9999 in Brazil).
  // The formatting and checking come from libphonenumber-js (vendor/libphonenumber, MIT), loaded only when a page has a phone field.
  const PHONE_LIB_URL = 'vendor/libphonenumber/libphonenumber-max.js?v=1.12.10';
  const PHONE_EXAMPLES_URL = 'vendor/libphonenumber/examples.mobile.json?v=1.12.10'; // one example mobile number per country (the shape of the mask)
  const phoneExamples = {};
  // Fallback example national numbers, used only if the examples file of the library cannot be loaded.
  const PHONE_EXAMPLES = { BR: '31999999999', US: '5551234567', CA: '5551234567', PT: '912345678', GB: '07911123456', ES: '612345678', FR: '0612345678', DE: '015123456789', IT: '3123456789', MX: '5512345678', AR: '1123456789', CO: '3123456789', CL: '912345678', IN: '9123456789', AU: '0412345678', JP: '09012345678', NL: '0612345678', IE: '0851234567', CH: '0781234567', SE: '0701234567', PL: '512345678', ZA: '0821234567', NG: '08012345678', TR: '05321234567', AE: '0501234567', SG: '81234567', PE: '912345678', UY: '094231234', VE: '04121234567', EC: '0991234567' };
  // The country that stands for a calling code shared by several countries.
  const PHONE_MAIN_COUNTRY = { 1: 'US', 7: 'RU', 39: 'IT', 44: 'GB', 47: 'NO', 61: 'AU', 212: 'MA', 262: 'RE', 358: 'FI', 590: 'GP', 599: 'CW' };
  let phoneLibRequest = null;
  function loadPhoneLib() {
    if (typeof window !== 'undefined' && window.libphonenumber && window.libphonenumber.AsYouType) return Promise.resolve(window.libphonenumber);
    if (!phoneLibRequest) {
      phoneLibRequest = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = PHONE_LIB_URL; script.async = true;
        script.onload = () => {
          if (!(window.libphonenumber && window.libphonenumber.AsYouType)) { reject(new Error('The phone list is not valid.')); return; }
          fetch(PHONE_EXAMPLES_URL).then(response => (response.ok ? response.json() : {})).then(data => { Object.assign(phoneExamples, data || {}); }).catch(() => {}).then(() => resolve(window.libphonenumber));
        };
        script.onerror = () => reject(new Error('The phone list could not be loaded.'));
        document.head.appendChild(script);
      });
      phoneLibRequest.catch(() => { phoneLibRequest = null; });
    }
    return phoneLibRequest;
  }
  // What the person has typed, written the way the country writes it (digits only go in; "(31) 99999-9999" comes out).
  // A number cannot be longer than the longest number of that country: extra digits are dropped as they are typed or pasted.
  function phoneNational(lib, iso, raw) {
    let digits = String(raw || '').replace(/[^0-9]/g, '');
    while (digits && lib.validatePhoneNumberLength(digits, iso) === 'TOO_LONG') digits = digits.slice(0, -1);
    return digits ? new lib.AsYouType(iso).input(digits) : '';
  }
  function phoneMaxDigits(lib, iso) {
    let max = 0;
    for (let length = 4; length <= 17; length += 1) { if (lib.validatePhoneNumberLength('9'.repeat(length), iso) === 'TOO_LONG') break; max = length; }
    return max;
  }
  // The shape of a number of that country with underscores for the digits: (__) _____-____ in Brazil, (___) ___-____ in the United States.
  function phoneMask(lib, iso) {
    const max = phoneMaxDigits(lib, iso);
    const example = phoneExamples[iso] || PHONE_EXAMPLES[iso] || '';
    const parsed = example ? lib.parsePhoneNumberFromString(example, iso) : null;
    if (parsed) return parsed.formatNational().replace(/[0-9]/g, '_');
    const digits = example ? example.slice(0, max) : '9'.repeat(max);
    return digits ? new lib.AsYouType(iso).input(digits).replace(/[0-9]/g, '_') : '';
  }
  function phoneExample(lib, iso) {
    const example = phoneExamples[iso] || PHONE_EXAMPLES[iso];
    return example ? phoneNational(lib, iso, example) : '';
  }
  // { ok, text } : text is the number in international form ("+55 31 99999 9999") when it is a valid number of that country.
  function phoneCheck(lib, iso, national) {
    const number = national ? lib.parsePhoneNumberFromString(national, iso) : null;
    // +1 is shared by the United States, Canada and others, so the calling code (not the country) must match the chosen one.
    const ok = Boolean(number && number.isValid() && String(number.countryCallingCode) === String(lib.getCountryCallingCode(iso)));
    return { ok, text: ok ? number.formatInternational() : '' };
  }
  // A number written with its "+55 ..." country code (pasted, or restored): which country and which national digits.
  function phoneParse(lib, text) {
    const number = lib.parsePhoneNumberFromString(String(text || ''));
    return number && number.country ? { iso: number.country, national: phoneNational(lib, number.country, number.nationalNumber) } : null;
  }
  function defaultPhoneCountry(lib) {
    let region = '';
    try { const locale = new Intl.Locale(navigator.language || 'en-US'); region = locale.region || (locale.maximize && locale.maximize().region) || ''; } catch { region = ''; }
    return lib && region && lib.getCountries().includes(region) ? region : 'US';
  }

  // A country picker the way phone fields usually do it: a button that shows the chosen country, and a list with a search box inside.
  // (An editable text box here made the chosen name get in the way of typing another one.) Typing while the button is focused starts a search.
  function attachCountryPicker(wrap, options) {
    const { items, onPick } = options;
    const id = 'cp-' + (++comboCounter);
    wrap.classList.add('country-picker');
    wrap.innerHTML = '<button type="button" class="country-picker-btn" aria-haspopup="listbox" aria-expanded="false" aria-controls="' + id + '-panel"><span class="cp-name"></span><span class="cp-code"></span></button>'
      + '<div class="country-picker-panel" id="' + id + '-panel" hidden><input type="search" class="country-picker-search" placeholder="Search country or code" aria-label="Search countries" aria-controls="' + id + '-list" autocomplete="off" spellcheck="false"><ul class="country-picker-list" id="' + id + '-list" role="listbox" aria-label="Countries"></ul></div>';
    const button = wrap.querySelector('.country-picker-btn'), panel = wrap.querySelector('.country-picker-panel'), search = wrap.querySelector('.country-picker-search'), list = wrap.querySelector('.country-picker-list');
    let selected = null, shown = [], active = 0;
    const isOpen = () => !panel.hidden;
    const setSelected = item => {
      selected = item;
      wrap.querySelector('.cp-name').textContent = item ? item.name : 'Country';
      wrap.querySelector('.cp-code').textContent = item ? '+' + item.code : '';
      button.title = item ? item.label : '';
      button.setAttribute('aria-label', item ? 'Country calling code: ' + item.label : 'Country calling code');
    };
    const paint = center => {
      list.innerHTML = '';
      shown.forEach((item, index) => {
        const li = document.createElement('li');
        li.id = id + '-o' + index; li.setAttribute('role', 'option'); li.setAttribute('aria-selected', item === selected ? 'true' : 'false');
        li.className = 'combo-option' + (index === active ? ' is-active' : '') + (item === selected ? ' is-chosen' : '');
        li.textContent = item.label;
        li.addEventListener('mousedown', event => { event.preventDefault(); pick(item); });
        list.appendChild(li);
      });
      if (!shown.length) { const li = document.createElement('li'); li.className = 'combo-note'; li.textContent = 'No match'; list.appendChild(li); }
      if (shown.length) search.setAttribute('aria-activedescendant', id + '-o' + active); else search.removeAttribute('aria-activedescendant');
      scrollListTo(list, list.querySelector('.is-active'), center);
    };
    const close = (giveFocusBack) => {
      if (!isOpen()) return;
      panel.hidden = true; button.setAttribute('aria-expanded', 'false');
      document.removeEventListener('mousedown', outside, true);
      if (giveFocusBack) button.focus();
    };
    function outside(event) { if (!wrap.contains(event.target)) close(false); }
    const open = initial => {
      if (isOpen()) return;
      panel.hidden = false; button.setAttribute('aria-expanded', 'true');
      search.value = initial || '';
      shown = rankItems(items, search.value, items.length);
      active = Math.max(0, !search.value && selected ? shown.indexOf(selected) : 0);
      paint(true); search.focus({ preventScroll: true });
      document.addEventListener('mousedown', outside, true);
    };
    function pick(item) { setSelected(item); close(false); if (onPick) onPick(item); }
    button.addEventListener('click', () => { if (isOpen()) close(true); else open(''); });
    button.addEventListener('keydown', event => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); open(''); }
      else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey && event.key !== ' ') { event.preventDefault(); open(event.key); }
    });
    search.addEventListener('input', () => { shown = rankItems(items, search.value, items.length); active = 0; paint(); });
    search.addEventListener('keydown', event => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        if (shown.length) { active = (active + (event.key === 'ArrowDown' ? 1 : -1) + shown.length) % shown.length; paint(); }
      } else if (event.key === 'Home' || event.key === 'End') { if (shown.length && !search.value) { event.preventDefault(); active = event.key === 'Home' ? 0 : shown.length - 1; paint(); } }
      else if (event.key === 'Enter') { event.preventDefault(); if (shown[active]) pick(shown[active]); }
      else if (event.key === 'Escape') { event.preventDefault(); close(true); }
      else if (event.key === 'Tab') close(false);
    });
    return { setSelected, close, button };
  }

  function setupPhone(countryWrap, numberInput) {
    const state = { iso: '', lib: null, items: [], pending: numberInput._pendingPhone || '' };
    numberInput._phone = state;
    let picker = null;
    const nameOf = iso => COUNTRY_BY_CODE.get(iso) || iso;
    const itemOf = iso => state.items.find(entry => entry.iso === iso);
    const labelOf = iso => { const item = itemOf(iso); return item ? item.label : ''; };
    const validate = () => {
      if (!state.lib) return;
      const text = numberInput.value.trim();
      numberInput.setCustomValidity(!text || phoneCheck(state.lib, state.iso, text).ok ? '' : 'Enter a valid phone number for ' + nameOf(state.iso) + '.');
    };
    const setCountry = iso => {
      state.iso = iso; if (picker) picker.setSelected(itemOf(iso) || null);
      numberInput.placeholder = phoneMask(state.lib, iso) || 'Phone number';
      numberInput.value = phoneNational(state.lib, iso, numberInput.value);
      validate();
    };
    const applyPending = () => {
      const text = state.pending; state.pending = '';
      if (!text) return;
      const parsed = text.trim().startsWith('+') ? phoneParse(state.lib, text) : null;
      if (parsed && labelOf(parsed.iso)) { setCountry(parsed.iso); numberInput.value = parsed.national; validate(); }
      else { numberInput.value = phoneNational(state.lib, state.iso, text); validate(); }
    };
    numberInput._applyPending = value => { state.pending = value || ''; if (state.lib) applyPending(); };
    loadPhoneLib().then(lib => {
      state.lib = lib;
      const supported = new Set(lib.getCountries());
      state.items = COUNTRIES.filter(country => supported.has(country[0])).map(([code, name, extra]) => {
        const callingCode = lib.getCountryCallingCode(code);
        return { label: name + ' (+' + callingCode + ')', name, code: callingCode, iso: code, nameKey: normalize(name), aliasKey: normalize(extra || ''), key: normalize(name + ' ' + (extra || '') + ' ' + callingCode) };
      });
      // After a country is picked the cursor goes to the number: the next thing to do is to type it.
      picker = attachCountryPicker(countryWrap, { items: state.items, onPick: item => { if (item.iso !== state.iso) setCountry(item.iso); numberInput.focus({ preventScroll: true }); } });
      state.iso = defaultPhoneCountry(lib);
      setCountry(state.iso);
      applyPending();
      numberInput.addEventListener('input', () => {
        const raw = numberInput.value;
        if (raw.trim().startsWith('+')) {
          const found = new lib.AsYouType(); found.input(raw);
          const callingCode = found.getCallingCode();
          // Several countries share some codes (+1, +44, +7...): keep the country already chosen when it uses that code, else the main country of the code, else the one the library finds.
          const sameCode = iso => String(lib.getCountryCallingCode(iso)) === String(callingCode);
          const country = !callingCode ? '' : sameCode(state.iso) ? state.iso : (PHONE_MAIN_COUNTRY[callingCode] && labelOf(PHONE_MAIN_COUNTRY[callingCode]) ? PHONE_MAIN_COUNTRY[callingCode] : (found.getCountry() || (state.items.find(entry => sameCode(entry.iso)) || {}).iso));
          if (country && labelOf(country)) {
            const number = found.getNumber();
            const national = number ? number.nationalNumber : raw.replace(/[^0-9]/g, '').slice(String(callingCode).length);
            state.iso = country; picker.setSelected(itemOf(country)); numberInput.placeholder = phoneMask(lib, country) || 'Phone number';
            numberInput.value = phoneNational(lib, country, national); validate(); return;
          }
        }
        numberInput.value = phoneNational(lib, state.iso, raw);
        validate();
      });
    }).catch(() => {
      // The list could not be loaded: keep it usable with a plain number that starts with the country code.
      countryWrap.hidden = true;
      numberInput.placeholder = '+55 31 99999-9999'; numberInput.pattern = '\\+[0-9 ()\\-]{7,24}'; numberInput.title = 'Start with the country code, for example +55 31 99999-9999';
    });
  }
  function readPhone(form) {
    const numberInput = form.elements.phone;
    if (!numberInput) return '';
    const state = numberInput._phone;
    if (state && state.lib) { const result = phoneCheck(state.lib, state.iso, numberInput.value.trim()); return result.ok ? result.text : numberInput.value.trim(); }
    return numberInput.value.trim();
  }
  function fillPhone(form, value) {
    const numberInput = form.elements.phone;
    if (!numberInput || !value) return;
    if (numberInput._applyPending) numberInput._applyPending(value); else numberInput._pendingPhone = value;
  }

  function joinPronouns(choice, other) {
    if (choice !== PRONOUN_OTHER) return PRONOUNS.includes(choice) ? choice : '';
    const text = String(other || '').replace(/\s+/g, ' ').trim().slice(0, PRONOUN_OTHER_MAX);
    return text ? PRONOUN_OTHER + ': ' + text : PRONOUN_OTHER;
  }
  function splitPronouns(value) {
    const text = String(value || '');
    if (PRONOUNS.includes(text)) return { choice: text, other: '' };
    if (text === PRONOUN_OTHER) return { choice: PRONOUN_OTHER, other: '' };
    if (text.startsWith(PRONOUN_OTHER + ': ')) return { choice: PRONOUN_OTHER, other: text.slice(PRONOUN_OTHER.length + 2) };
    return { choice: '', other: '' };
  }

  // Wires every geography / pronoun field found inside a form (the markup comes from candidate.js).
  function enhanceForm(form) {
    form.querySelectorAll('input[data-geo="country"]').forEach(input => attachCombobox(input, { items: countryItems(), strict: true, maxResults: 300, invalidMessage: 'Choose a country from the list.' }));
    form.querySelectorAll('input[data-geo="city"]').forEach(input => attachCombobox(input, { loadItems: loadCityItems, allowCustom: true, maxResults: 8, loadingText: 'Loading cities…' }));
    const phoneCountry = form.querySelector('[data-geo="phone-country"]'), phoneNumber = form.querySelector('input[data-geo="phone-number"]');
    if (phoneCountry && phoneNumber) setupPhone(phoneCountry, phoneNumber);
    const select = form.querySelector('select[data-geo="pronouns"]'), other = form.querySelector('input[data-geo="pronouns-other"]');
    if (select && other) {
      const sync = () => { other.hidden = select.value !== PRONOUN_OTHER; other.required = !other.hidden; };
      select.addEventListener('change', sync); sync();
    }
  }
  function fillPronouns(form, value) {
    const select = form.querySelector('select[data-geo="pronouns"]'), other = form.querySelector('input[data-geo="pronouns-other"]');
    if (!select) return;
    const parts = splitPronouns(value);
    select.value = parts.choice;
    if (other) { other.value = parts.other; other.hidden = parts.choice !== PRONOUN_OTHER; other.required = !other.hidden; }
  }

  window.PathwayGeo = { phoneExamples, loadPhoneLib, phoneMask, phoneMaxDigits, phoneNational, phoneCheck, phoneParse, phoneExample, readPhone, fillPhone, DIVERSITY, DIVERSITY_KEYS, PREFER_NOT_TO_SAY, COUNTRIES, COUNTRY_NAMES, COUNTRY_BY_CODE, PRONOUNS, PRONOUN_OTHER, PRONOUN_OTHER_MAX, normalize, rankItems, countryItems, loadCityItems, attachCombobox, enhanceForm, joinPronouns, splitPronouns, fillPronouns };
})();
