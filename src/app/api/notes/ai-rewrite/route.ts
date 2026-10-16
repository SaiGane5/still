import { generateText } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { z } from "zod";
import { route, readJson } from "@/server/http";
import { HttpError } from "@/server/http-error";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  text: z.string().trim().min(1).max(12_000),
  instruction: z.string().trim().max(500).optional(),
  context: z.string().max(8_000).optional(),
});

const MODELS = ["gemini-3.5-flash", "gemini-3.6-flash", "gemini-flash-lite-latest"] as const;

function geminiKey(): string {
  const key = process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GEMINI_API_KEY;
  if (!key) throw new HttpError(503, "misconfigured", "Gemini is not configured");
  return key;
}

export const POST = route(async (ctx) => {
  void ctx.userId;
  const body = bodySchema.parse(await readJson(ctx.req));
  const google = createGoogleGenerativeAI({ apiKey: geminiKey() });
  const instruction = body.instruction?.trim() || "Improve clarity and tone while preserving meaning.";
  const system = `You rewrite a highlighted passage inside a focus-app note.
Return ONLY the rewritten passage — no quotes, no preamble, no markdown fences.
Keep roughly similar length unless the instruction asks otherwise.
Preserve any intentional markdown the passage already uses.`;

  const prompt = [
    `Instruction: ${instruction}`,
    body.context?.trim() ? `Surrounding note context:\n${body.context.trim().slice(0, 4000)}` : "",
    `Passage to rewrite:\n${body.text}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  let lastErr: unknown;
  for (const modelId of MODELS) {
    try {
      const result = await generateText({
        model: google(modelId),
        system,
        prompt,
        temperature: 0.35,
        maxRetries: 1,
      });
      const text = result.text?.trim();
      if (!text) throw new Error("empty rewrite");
      return { text };
    } catch (err) {
      lastErr = err;
      console.error(`notes ai-rewrite error (${modelId})`, err);
    }
  }
  console.error("notes ai-rewrite exhausted", lastErr);
  throw new HttpError(502, "assistant_failed", "Couldn’t rewrite that passage. Try again.");
});
