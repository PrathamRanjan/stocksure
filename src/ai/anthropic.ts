import { config } from "../config.js";

export interface ToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

let fetchImpl: typeof fetch = (input, init) => fetch(input, init);
export function setModelFetch(f: typeof fetch | null) {
  fetchImpl = f ?? ((input, init) => fetch(input, init));
}

export const hasModel = () => Boolean(config.models.anthropicKey);

/** One Messages API call with a single forced tool; the caller validates the JSON. Retries twice on 429/5xx. */
export async function forcedToolCall<T>(opts: { system: string; text?: string; content?: unknown[]; tool: ToolDef; maxTokens?: number }): Promise<{ input: T; model: string }> {
  if (!config.models.anthropicKey) throw new Error("ANTHROPIC_API_KEY is not set");
  let last: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetchImpl(`${config.models.anthropicBaseUrl}/v1/messages`, {
      method: "POST",
      headers: { "x-api-key": config.models.anthropicKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: config.models.model,
        max_tokens: opts.maxTokens ?? 800,
        system: opts.system,
        tools: [opts.tool],
        tool_choice: { type: "tool", name: opts.tool.name },
        messages: [{ role: "user", content: opts.content ?? [{ type: "text", text: opts.text ?? "" }] }],
      }),
      signal: AbortSignal.timeout(45_000),
    });
    const text = await res.text();
    if ((res.status === 429 || res.status >= 500) && attempt < 2) {
      last = new Error(`Anthropic ${res.status}`);
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
      continue;
    }
    if (!res.ok) throw new Error(`Anthropic ${res.status}: ${text.slice(0, 200)}`);
    const data = JSON.parse(text);
    const block = (data.content ?? []).find((b: any) => b.type === "tool_use" && b.name === opts.tool.name);
    if (!block) throw new Error("Model did not return the tool call");
    return { input: block.input as T, model: data.model ?? config.models.model };
  }
  throw last;
}
