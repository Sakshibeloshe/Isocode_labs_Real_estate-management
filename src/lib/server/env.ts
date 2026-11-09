// central place for env access; values never logged
export function appUrl(): string {
  return (process.env.APP_URL || process.env.VERCEL_PROJECT_PRODUCTION_URL && `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` || "http://localhost:3000").replace(/\/$/, "");
}

export function sessionSecret(): Uint8Array {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("SESSION_SECRET must be set (32+ chars)");
  return new TextEncoder().encode(s);
}

export function llmConfig() {
  return {
    baseUrl: (process.env.LLM_BASE_URL || "https://api.groq.com/openai/v1").replace(/\/$/, ""),
    model: process.env.LLM_MODEL || "qwen/qwen3.8-27b",
    apiKey: process.env.LLM_API_KEY || "",
    timeoutMs: Number(process.env.LLM_TIMEOUT_MS || 10_000),
  };
}
