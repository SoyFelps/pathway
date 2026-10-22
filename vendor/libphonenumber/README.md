# libphonenumber-js

`libphonenumber-max.js` is the "max" browser bundle of libphonenumber-js (https://gitlab.com/catamphetamine/libphonenumber-js), version 1.12.10, MIT license (see LICENSE).
It knows the calling code, the way numbers are written and which numbers exist in every country, so the phone field of the application form can offer a country list,
show the shape of a number (the mask, from `examples.mobile.json`), format the number as it is typed ((31) 99999-9999 in Brazil) and accept only real numbers of that country.
(The lighter "min" bundle was tried first, but it checks numbers loosely: it accepted Brazilian numbers that are too short.)
It is hosted here and loaded only when a page has a phone field (geo.js), so nothing a candidate types goes to a third party.

- `libphonenumber-max.js`: https://cdn.jsdelivr.net/npm/libphonenumber-js@1.12.10/bundle/libphonenumber-max.js (245 KB, about 60 KB compressed), downloaded on 2026-10-22.
- `examples.mobile.json`: https://cdn.jsdelivr.net/npm/libphonenumber-js@1.12.10/examples.mobile.json (4 KB), one example mobile number per country.
- Update: replace both files with the same ones of a newer version and change the `?v=` of `PHONE_LIB_URL` and `PHONE_EXAMPLES_URL` in geo.js.
