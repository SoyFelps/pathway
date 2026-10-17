/*
 * Public Cloudflare Turnstile settings for the candidate application page.
 * The SITE key is public and designed for browser use. The SECRET key never goes in this repository:
 * it lives in the Supabase project secrets as TURNSTILE_SECRET_KEY.
 * Leave siteKey empty to run without a CAPTCHA (the server only enforces it when it has the secret).
 */
window.PATHWAY_TURNSTILE = {
  siteKey: '0x4AAAAAAFZky1B_pMur1z2L'
};
