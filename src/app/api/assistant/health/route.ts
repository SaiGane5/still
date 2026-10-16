import { NextResponse } from "next/server";
import { generateText, Output } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { z } from "zod";

/**
 * Diagnostic endpoint — confirms Gemini key + model reachability from Vercel.
 * Safe: returns no secrets, only which model succeeded.
 */
export async function GET(): Promise<Response> {
  const key = process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GEMINI_API_KEY;
  if (!key) {
    return NextResponse.json({ ok: false, reason: "missing_key" }, { status: 503 });
  }

  const schema = z.object({ reply: z.string() });
  const google = createGoogleGenerativeAI({ apiKey: key });
  const models = ["gemini-3.5-flash", "gemini-3.6-flash", "gemini-flash-lite-latest", "gemini-3.8-flash"];
  const errors: Record<string, string> = {};

  for (const modelId of models) {
    try {
      const result = await generateText({
        model: google(modelId),
        output: Output.object({ schema }),
        prompt: 'Reply with JSON {"reply":"pong"}',
        maxRetries: 0,
      });
      return NextResponse.json({
        ok: true,
        model: modelId,
        reply: result.output?.reply?.slice(0, 40) ?? null,
      });
    } catch (err) {
      errors[modelId] = err instanceof Error ? err.message.slice(0, 240) : String(err).slice(0, 240);
    }
  }

  // Fallback: raw REST JSON (no AI SDK structured output)
  for (const modelId of models) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${key}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: "Say pong" }] }],
            generationConfig: { maxOutputTokens: 32 },
          }),
        },
      );
      const body = await res.json();
      if (!res.ok) {
        errors[`rest:${modelId}`] = JSON.stringify(body?.error?.message || body).slice(0, 240);
        continue;
      }
      const text = body?.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
      return NextResponse.json({ ok: true, model: `rest:${modelId}`, reply: text?.slice(0, 40) ?? null });
    } catch (err) {
      errors[`rest:${modelId}`] = err instanceof Error ? err.message.slice(0, 240) : String(err).slice(0, 240);
    }
  }

  return NextResponse.json({ ok: false, reason: "all_failed", errors }, { status: 502 });
}
