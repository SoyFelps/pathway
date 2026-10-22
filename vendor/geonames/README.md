# GeoNames city list

`cities15000.json` is the list of cities behind the "City" field of the application form (candidate.js / geo.js). It is served from this site and loaded
only when a candidate opens that field: nothing a candidate types is sent to GeoNames or to any other third party.

- Source: GeoNames, https://www.geonames.org , files `cities15000.zip` (cities with more than 15,000 inhabitants) and `admin1CodesASCII.txt` from https://download.geonames.org/export/dump/ , downloaded on 2026-10-22.
- License: Creative Commons Attribution 4.0 (CC BY 4.0), https://creativecommons.org/licenses/by/4.0/ . Credit required: "This work uses data from GeoNames (https://www.geonames.org)". The credit is in `legal.html` (footer) and here.
- Format: `{ v, countries:[ISO codes], regions:[names], cities:[[name, regionIndex, countryIndex], ...] }`, largest cities first (34,179 cities, about 0.8 MB, about 0.34 MB compressed by GitHub Pages).
- Rebuild: download the two files, unzip `cities15000.txt`, then `node vendor/geonames/build-cities.js cities15000.txt admin1CodesASCII.txt`.
- Small towns that are not in the list can still be typed by the candidate ("Use ..."), the value is stored as free text.
