// Builds cities15000.json (the city list of the "City" field) from two public GeoNames files.
// Usage: node build-cities.js <cities15000.txt> <admin1CodesASCII.txt> [output.json]
// Source: https://download.geonames.org/export/dump/ (cities15000.zip and admin1CodesASCII.txt), CC BY 4.0, see README.md.
// Output (compact on purpose, it is downloaded by candidates): { v, countries:[ISO codes], regions:[state/region names],
// cities:[[name, regionIndex (-1 = none), countryIndex], ...] } sorted by population (largest first).
const fs = require('fs');
const path = require('path');
const [citiesFile, adminFile, outFile = path.join(__dirname, 'cities15000.json')] = process.argv.slice(2);
if (!citiesFile || !adminFile) { console.error('Usage: node build-cities.js <cities15000.txt> <admin1CodesASCII.txt> [output.json]'); process.exit(1); }

const regionName = new Map();
fs.readFileSync(adminFile, 'utf8').split('\n').forEach(line => {
  const [code, name, ascii] = line.split('\t');
  if (code) regionName.set(code, (name || ascii || '').trim());
});

const countries = [], countryIndex = new Map(), regions = [], regionIndex = new Map();
const rows = [];
fs.readFileSync(citiesFile, 'utf8').split('\n').forEach(line => {
  if (!line.trim()) return;
  const f = line.split('\t');
  const name = (f[1] || '').trim(), country = f[8], admin1 = f[10], population = Number(f[14]) || 0;
  if (!name || !country) return;
  if (!countryIndex.has(country)) { countryIndex.set(country, countries.length); countries.push(country); }
  const region = admin1 ? regionName.get(country + '.' + admin1) : '';
  let ri = -1;
  if (region) { if (!regionIndex.has(region)) { regionIndex.set(region, regions.length); regions.push(region); } ri = regionIndex.get(region); }
  rows.push({ population, row: [name, ri, countryIndex.get(country)] });
});
rows.sort((a, b) => b.population - a.population);
const out = { v: 1, countries, regions, cities: rows.map(item => item.row) };
fs.writeFileSync(outFile, JSON.stringify(out));
console.log('cities', rows.length, 'countries', countries.length, 'regions', regions.length, 'bytes', fs.statSync(outFile).size);
