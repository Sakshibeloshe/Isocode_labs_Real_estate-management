// Minimal OpenAI-compatible chat client (Groq by default; Ollama/OpenRouter work by changing env).
// Plain fetch: no SDK, explicit timeout, typed errors the agent can turn into a graceful fallback.
import { llmConfig } from "../env";

export type ToolCall = { id: string; name: string; arguments: string };
export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[] }
  | { role: "tool"; tool_call_id: string; content: string };

export type ToolDef = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

export type LLMReply = { content: string | null; toolCalls: ToolCall[] };

export interface LLM {
  chat(req: { messages: ChatMessage[]; tools: ToolDef[]; signal?: AbortSignal }): Promise<LLMReply>;
}

export type LLMErrorKind = "config" | "timeout" | "rate_limit" | "server" | "bad_request" | "bad_response";
export class LLMError extends Error {
  constructor(public kind: LLMErrorKind, message: string) {
    super(message);
  }
}

/** model-specific extras: Qwen 3.x reasoning off so tool calls come back fast and clean */
function extras(model: string): Record<string, unknown> {
  if (process.env.LLM_EXTRA_BODY) {
    try {
      return JSON.parse(process.env.LLM_EXTRA_BODY);
    } catch {
      return {};
    }
  }
  return /qwen3/i.test(model) && /groq/i.test(llmConfig().baseUrl) ? { reasoning_effort: "none" } : {};
}

export function openAICompatibleLLM(): LLM {
  const cfg = llmConfig();
  return {
    async chat({ messages, tools }) {
      if (!cfg.apiKey && !/localhost|127\.0\.0\.1/.test(cfg.baseUrl)) throw new LLMError("config", "LLM_API_KEY is not set");

      const send = async (withExtras: boolean) => {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), cfg.timeoutMs);
        try {
          return await fetch(`${cfg.baseUrl}/chat/completions`, {
            method: "POST",
            signal: ctrl.signal,
            headers: { "Content-Type": "application/json", ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}) },
            body: JSON.stringify({
              model: cfg.model,
              messages,
              tools,
              tool_choice: "auto",
              temperature: 0.2,
              max_tokens: 500,
              ...(withExtras ? extras(cfg.model) : {}),
            }),
          });
        } catch (e) {
          if ((e as Error).name === "AbortError") throw new LLMError("timeout", `No reply within ${cfg.timeoutMs} ms`);
          throw new LLMError("server", `Network error: ${(e as Error).message}`);
        } finally {
          clearTimeout(timer);
        }
      };

      let res = await send(true);
      // some providers reject unknown params → retry once plain
      if (res.status === 400 && Object.keys(extras(cfg.model)).length) res = await send(false);
      if (res.status === 429) throw new LLMError("rate_limit", "Rate limited by provider");
      if (res.status >= 500) throw new LLMError("server", `Provider error ${res.status}`);
      if (!res.ok) throw new LLMError("bad_request", `Provider rejected request (${res.status}): ${(await res.text()).slice(0, 300)}`);

      const json = (await res.json()) as {
        choices?: { message?: { content?: string | null; tool_calls?: { id: string; function: { name: string; arguments: string } }[] } }[];
      };
      const msg = json.choices?.[0]?.message;
      if (!msg) throw new LLMError("bad_response", "No message in response");
      return {
        content: msg.content ?? null,
        toolCalls: (msg.tool_calls ?? []).map((c) => ({ id: c.id, name: c.function.name, arguments: c.function.arguments ?? "{}" })),
      };
    },
  };
}
