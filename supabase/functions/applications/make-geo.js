// Regenerates geo.ts from ../../../geo.js so the server and the form always share the same country and pronoun lists.
// Usage (from the repository root): node supabase/functions/applications/make-geo.js
const fs = require('fs'), path = require('path'), vm = require('vm');
const source = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'geo.js'), 'utf8');
const sandbox = { window: {}, document: {}, fetch() {} };
vm.runInNewContext(source, sandbox);
const G = sandbox.window.PathwayGeo;
const out = `// GENERATED from geo.js by make-geo.js. Do not edit by hand: change geo.js and run \`node supabase/functions/applications/make-geo.js\`.
// The application form lets people pick a country (and pronouns) from lists; the server accepts exactly these values.
export const COUNTRY_NAMES: string[] = ${JSON.stringify(G.COUNTRY_NAMES, null, 1).replace(/\n\s*/g, ' ')};
export const PRONOUNS: string[] = ${JSON.stringify(G.PRONOUNS)};
export const PRONOUN_OTHER = ${JSON.stringify(G.PRONOUN_OTHER)};
export const PRONOUN_OTHER_MAX = ${G.PRONOUN_OTHER_MAX};
`;
fs.writeFileSync(path.join(__dirname, 'geo.ts'), out);
console.log('geo.ts written:', G.COUNTRY_NAMES.length, 'countries');
