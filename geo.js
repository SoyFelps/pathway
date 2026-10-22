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
  // Turns a text input into a searchable list. strict: only a value from the list is accepted; allowCustom: the typed text may also be used as it is.
  function attachCombobox(input, options) {
    const { items, loadItems, strict = false, allowCustom = false, maxResults = 8, invalidMessage = 'Choose a value from the list.', loadingText = 'Loading…' } = options;
    const wrap = input.parentElement;
    wrap.classList.add('combo');
    const list = document.createElement('ul');
    list.className = 'combo-list'; list.id = (input.id || 'combo') + '-list-' + (++comboCounter); list.setAttribute('role', 'listbox'); list.hidden = true;
    wrap.appendChild(list);
    input.setAttribute('role', 'combobox'); input.setAttribute('aria-autocomplete', 'list'); input.setAttribute('aria-expanded', 'false'); input.setAttribute('aria-controls', list.id);
    input.setAttribute('autocomplete', 'off'); input.setAttribute('autocapitalize', 'off'); input.spellcheck = false;
    let all = items || null, loading = false, failed = false, shown = [], active = -1;

    const exact = value => all && all.find(item => item.nameKey === normalize(value) || normalize(item.label) === normalize(value));
    const syncValidity = () => { const value = input.value.trim(); input.setCustomValidity(strict && value && all && !exact(value) ? invalidMessage : ''); };
    const close = () => { list.hidden = true; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); active = -1; };
    const choose = item => { input.value = item.label; syncValidity(); close(); input.dispatchEvent(new Event('change', { bubbles: true })); };
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
      shown = all ? rankItems(all, value, maxResults) : [];
      if (allowCustom && value && !shown.some(item => normalize(item.label) === normalize(value))) shown.push({ label: value, custom: true });
      active = shown.length ? 0 : -1;
      paint();
    }
    async function open() {
      if (!all && loadItems && !loading) {
        loading = true; update();
        try { all = await loadItems(); } catch { all = []; failed = true; }
        loading = false;
      }
      if (document.activeElement === input) update();
    }
    input.addEventListener('focus', open);
    input.addEventListener('input', () => { syncValidity(); open(); });
    input.addEventListener('blur', () => {
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
        list.querySelector('.is-active')?.scrollIntoView({ block: 'nearest' });
      } else if (event.key === 'Enter' && isOpen && active >= 0 && shown[active]) { event.preventDefault(); choose(shown[active]); }
      else if (event.key === 'Escape' && isOpen) { event.preventDefault(); close(); }
    });
    syncValidity();
    return { input, list };
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
    const select = form.querySelector('select[data-geo="pronouns"]'), other = form.querySelector('input[data-geo="pronouns-other"]');
    if (select && other) {
      const sync = () => { other.hidden = select.value !== PRONOUN_OTHER; };
      select.addEventListener('change', sync); sync();
    }
  }
  function fillPronouns(form, value) {
    const select = form.querySelector('select[data-geo="pronouns"]'), other = form.querySelector('input[data-geo="pronouns-other"]');
    if (!select) return;
    const parts = splitPronouns(value);
    select.value = parts.choice;
    if (other) { other.value = parts.other; other.hidden = parts.choice !== PRONOUN_OTHER; }
  }

  window.PathwayGeo = { COUNTRIES, COUNTRY_NAMES, COUNTRY_BY_CODE, PRONOUNS, PRONOUN_OTHER, PRONOUN_OTHER_MAX, normalize, rankItems, countryItems, loadCityItems, attachCombobox, enhanceForm, joinPronouns, splitPronouns, fillPronouns };
})();
