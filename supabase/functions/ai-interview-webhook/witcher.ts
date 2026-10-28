// Client for the Witcher interviews API (server to server). This file is copied into each AI-interview function folder;
// tests/ai_interview_functions.test.js checks the copies are identical. No Deno-only APIs, so Node can test it.
// Nothing the candidate said and no key is ever logged or put into an error.

export interface WitcherConfig { url: string; apiKey: string }
export interface WitcherResult { ok: boolean; status: number; json: Record<string, unknown> }

/** One call to the API. A network problem or timeout comes back as status 0 (never thrown), so callers can retry. */
export async function callWitcher(
  config: WitcherConfig,
  action: string,
  body: Record<string, unknown>,
  options: { fetchFn?: typeof fetch; timeoutMs?: number } = {},
): Promise<WitcherResult> {
  const fetchFn = options.fetchFn ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 20_000);
  try {
    const response = await fetchFn(config.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-witcher-api-key": config.apiKey },
      body: JSON.stringify({ action, ...body }),
      signal: controller.signal,
    });
    let json: Record<string, unknown> = {};
    try {
      const parsed = await response.json();
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) json = parsed as Record<string, unknown>;
    } catch { /* an empty or broken body is treated as no data */ }
    return { ok: response.ok, status: response.status, json };
  } catch {
    return { ok: false, status: 0, json: {} };
  } finally {
    clearTimeout(timer);
  }
}
