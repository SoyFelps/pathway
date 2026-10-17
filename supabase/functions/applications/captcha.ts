// Cloudflare Turnstile server-side check, kept free of Deno globals so it can be unit-tested in Node.
// https://developers.cloudflare.com/turnstile/get-started/server-side-validation/

export const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
// Tokens are at most 2048 characters long, valid for 5 minutes and single use.
export const MAX_TOKEN_LENGTH = 2048;

export type CaptchaResult =
  | { ok: true }
  // missing: no token was sent; rejected: Cloudflare says the token is wrong, expired or already used;
  // unavailable: we could not get a verdict (network, timeout, or a problem with our own secret key).
  | { ok: false; reason: "missing" | "rejected" | "unavailable"; codes: string[] };

// Errors that point to our own configuration or to Cloudflare, not to the visitor.
const SERVICE_SIDE_CODES = new Set(["missing-input-secret", "invalid-input-secret", "bad-request", "internal-error"]);

export async function verifyTurnstileToken(
  secret: string,
  token: unknown,
  remoteIp: string,
  fetchImpl: typeof fetch = fetch,
): Promise<CaptchaResult> {
  const response = typeof token === "string" ? token.trim() : "";
  if (!response) return { ok: false, reason: "missing", codes: [] };
  if (response.length > MAX_TOKEN_LENGTH) return { ok: false, reason: "rejected", codes: ["invalid-input-response"] };

  const body = new URLSearchParams({ secret, response });
  if (remoteIp && remoteIp !== "unknown") body.set("remoteip", remoteIp);

  try {
    const result = await fetchImpl(TURNSTILE_VERIFY_URL, { method: "POST", body, signal: AbortSignal.timeout(5000) });
    if (!result.ok) return { ok: false, reason: "unavailable", codes: [`http-${result.status}`] };
    const data = await result.json() as { success?: boolean; "error-codes"?: unknown };
    if (data.success === true) return { ok: true };
    const codes = Array.isArray(data["error-codes"]) ? data["error-codes"].map((code) => String(code).slice(0, 60)).slice(0, 5) : [];
    if (codes.some((code) => SERVICE_SIDE_CODES.has(code))) return { ok: false, reason: "unavailable", codes };
    return { ok: false, reason: "rejected", codes };
  } catch {
    return { ok: false, reason: "unavailable", codes: ["network-error"] };
  }
}
