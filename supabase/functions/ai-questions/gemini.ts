import { buildQuestionRequest, cleanDescription, cleanExisting, descriptionIsEnough, isTooSimilar, oneLine, parseModelAnswer } from "./logic.ts";

// Calls Google Gemini to write ONE interview question. Same pinned models as the Witcher (never the moving "latest" alias), tried in order when
// Google says one is busy or slow. Text only, so it is quick and cheap; "thinking" stays low because the person is waiting for the answer.

export interface ModelChoice { name: string; thinkingLevel: string; timeoutMs: number }
export const MODEL_CHAIN: ModelChoice[] = [
  { name: "gemini-3.5-flash", thinkingLevel: "minimal", timeoutMs: 15_000 },
  { name: "gemini-3.8-flash", thinkingLevel: "low", timeoutMs: 20_000 },
  { name: "gemini-3.5-flash-lite", thinkingLevel: "minimal", timeoutMs: 20_000 },
];
const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
const RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);

export interface GeminiOptions { apiKey: string; models?: ModelChoice[]; fetchFn?: typeof fetch }

async function callGemini(request: { generationConfig: Record<string, unknown> }, options: GeminiOptions): Promise<unknown> {
  const chain = options.models && options.models.length ? options.models : MODEL_CHAIN;
  const fetchFn = options.fetchFn ?? fetch;
  let lastStatus = 0;
  for (const model of chain) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), model.timeoutMs);
    try {
      const response = await fetchFn(`${ENDPOINT}/${model.name}:generateContent`, {
        method: "POST",
        headers: { "x-goog-api-key": options.apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({ ...request, generationConfig: { ...request.generationConfig, thinkingConfig: { thinkingLevel: model.thinkingLevel } } }),
        signal: controller.signal,
      });
      if (response.ok) return await response.json();
      lastStatus = response.status;
      if (!RETRY_STATUSES.has(response.status)) break; // a bad request will not get better with another model
    } catch {
      lastStatus = 0; // timeout or network problem: try the next model
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`gemini_http_${lastStatus}`); // only the status: never a body, a key or the job text
}

export type CreateResult =
  | { generated: true; question: string }
  | { generated: false; reason: "insufficient" | "similar" };

/**
 * The whole job: too little description means no call at all; the model may still decline; a question too close to an existing one gets one more try
 * and then "similar". It only ever returns a question the model really wrote.
 */
export async function createQuestion(input: { jobTitle: unknown; description: unknown; existing: unknown }, options: GeminiOptions): Promise<CreateResult> {
  const description = cleanDescription(input.description);
  if (!descriptionIsEnough(description)) return { generated: false, reason: "insufficient" };
  const existing = cleanExisting(input.existing);
  const base = { jobTitle: oneLine(input.jobTitle, 120), description, existing };

  const first = parseModelAnswer(await callGemini(buildQuestionRequest(base), options));
  if (first.kind === "insufficient") return { generated: false, reason: "insufficient" };
  if (!isTooSimilar(first.question, existing)) return { generated: true, question: first.question };

  const second = parseModelAnswer(await callGemini(buildQuestionRequest({ ...base, avoid: first.question }), options));
  if (second.kind === "insufficient") return { generated: false, reason: "insufficient" };
  if (!isTooSimilar(second.question, existing)) return { generated: true, question: second.question };
  return { generated: false, reason: "similar" };
}
