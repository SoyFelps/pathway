// Every English message the server (edge functions) or the database (raise exception) can show to a person.
// The browser shows them through t(), so each one needs a translation: tests/i18n.test.js checks it.
const fs = require('fs');
const path = require('path');
const base = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(base, file), 'utf8');
const found = new Set();
const FUNCS = ['applications/index.ts', 'team/index.ts', 'billing/index.ts', 'delete-account/index.ts', 'ai-interview/index.ts', 'ai-interview/logic.ts', 'ai-questions/index.ts'];
const sentence = text => /^[A-Z][^]*[.?!]$/.test(text) && /\s/.test(text) && !text.includes('${');
for (const file of FUNCS) {
  const src = read('supabase/functions/' + file);
  // fail(req, n, "..."), fail(req, n, "code", "..."), { error: "..." }, x || "...", ? "..." : "...", return "..." (logic.ts), throw new Error("...")
  for (const m of src.matchAll(/\bfail\(\s*req\s*,\s*\d+\s*,\s*(?:"[\w_]+"\s*,\s*)?"((?:[^"\\]|\\.)*)"/g)) found.add(m[1]);
  for (const m of src.matchAll(/\berror:\s*"((?:[^"\\]|\\.)*)"/g)) found.add(m[1]);
  for (const m of src.matchAll(/fail\(req, \d+, [^;\n]*/g)) for (const s of m[0].matchAll(/"((?:[^"\\]|\\.)*)"/g)) if (sentence(s[1])) found.add(s[1]);
  for (const m of src.matchAll(/throw new Error\("((?:[^"\\]|\\.)*)"\)/g)) if (sentence(m[1])) found.add(m[1]);
  if (file === 'ai-interview/logic.ts') for (const m of src.matchAll(/return "((?:[^"\\]|\\.)*)";/g)) if (sentence(m[1])) found.add(m[1]);
  for (const m of src.matchAll(/(?:const|let) (?:planMessage|message)\s*=\s*([^;]+);/g)) for (const s of m[1].matchAll(/"((?:[^"\\]|\\.)*)"/g)) if (sentence(s[1])) found.add(s[1]);
}
// Database messages (raise exception '...'), latest wording of every migration.
const migrations = fs.readdirSync(path.join(base, 'supabase/migrations')).filter(name => name.endsWith('.sql'));
for (const name of migrations) for (const m of read('supabase/migrations/' + name).matchAll(/raise exception '((?:[^']|'')*)'/g)) { const text = m[1].replace(/''/g, "'"); if (!text.includes('%')) found.add(text); }
const list = [...found].filter(text => sentence(text)).sort();
module.exports = list;
