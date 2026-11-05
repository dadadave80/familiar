import { dials, type Dial } from "./pricing";

export type Reasoning = {
  dial: Dial;
  tooltip: string;
  source: "script" | "llm";
};
export async function reason(
  current: Dial,
  options?: {
    key: string;
    model: string;
    fetcher?: (input: string, init?: RequestInit) => Promise<Response>;
  },
): Promise<Reasoning> {
  const fallback: Reasoning = {
    dial: current,
    tooltip:
      "A little flour, a little patience. There is bread enough to go around.",
    source: "script",
  };
  if (!options?.key || !options.model) return fallback;
  try {
    const response = await (options.fetcher ?? fetch)(
      "https://cloud-api.near.ai/v1/chat/completions",
      {
        method: "POST",
        signal: AbortSignal.timeout(4000),
        headers: {
          authorization: `Bearer ${options.key}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: options.model,
          max_tokens: 100,
          messages: [
            {
              role: "system",
              content:
                "You are Bram, a warm and wry harbor baker. Return JSON only with exactly dial (steady, generous or careful) and tooltip (plain text, at most 140 characters). You cannot set prices, spend funds, or request actions.",
            },
            {
              role: "user",
              content: `Current temperament: ${current}. Choose today\u2019s temperament and explain it in one short line.`,
            },
          ],
        }),
      },
    );
    if (!response.ok) return fallback;
    const result = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = result.choices?.[0]?.message?.content;
    if (!content || content.length > 2048) return fallback;
    const value = JSON.parse(content);
    if (
      !value ||
      Object.keys(value).sort().join(",") !== "dial,tooltip" ||
      !dials.includes(value.dial) ||
      typeof value.tooltip !== "string"
    )
      return fallback;
    const tooltip = Array.from(
      value.tooltip.replace(/[\u0000-\u001f\u007f]/g, " ").trim(),
    )
      .slice(0, 140)
      .join("");
    return tooltip ? { dial: value.dial, tooltip, source: "llm" } : fallback;
  } catch {
    return fallback;
  }
}
