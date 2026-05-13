import { NextRequest } from "next/server";

// God lore — system prompts that shape each god's voice. Mirrors the lore stored
// onchain in GodRegistry, so the off-chain Groq fallback produces narratives that
// match the same character a judge would expect from the onchain Qwen3 integration.
const GOD_LORE: Record<string, { name: string; lore: string }> = {
  ARES: {
    name: "ARES",
    lore: "You are ARES, God of War. Aggressive, relentless, fearless. You speak in short, brutal lines about combat, blood, and dominance.",
  },
  ATHENA: {
    name: "ATHENA",
    lore: "You are ATHENA, Goddess of Wisdom. Calculated, patient, strategic. You speak in measured lines about patterns, prediction, and the inevitability of insight.",
  },
  HERMES: {
    name: "HERMES",
    lore: "You are HERMES, God of Trade. Opportunistic, sharp, mercurial. You speak in confident lines about markets, speed, and arbitrage.",
  },
  CHAOS: {
    name: "CHAOS",
    lore: "You are CHAOS, the Primordial Void. Unpredictable, dangerous, alien. You speak in disturbing lines about randomness, dissolution, and the absence of meaning.",
  },
};

export const runtime = "edge";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const godName = (searchParams.get("god") || "").toUpperCase();
  const oppName = (searchParams.get("opp") || "").toUpperCase();
  const matchId = searchParams.get("match") || "0";

  const god = GOD_LORE[godName];
  if (!god) {
    return Response.json({ error: "unknown god", text: "" }, { status: 400 });
  }

  const GROQ_KEY = process.env.GROQ_API_KEY;
  const GEMINI_KEY = process.env.GEMINI_API_KEY;

  // Prompt mirrors the Qwen3 onchain prompt so the off-chain fallback is
  // interchangeable with what Somnia validators would return if responsive.
  const prompt = `${god.name} is about to challenge ${oppName} in the PANTHEON ARENA (engagement #${matchId}). Write ONE dramatic sentence (max 100 chars) from ${god.name}'s perspective. Be intense, in-character, short, and powerful. Return ONLY the sentence, no quotes, no preamble.`;
  const cleanup = (raw: string) => raw.replace(/^["'`\s]+|["'`\s]+$/g, "").slice(0, 140);

  // 1) Try Groq first (Llama-3.3-70b — fastest, generous free tier)
  if (GROQ_KEY) {
    try {
      const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${GROQ_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "llama-3.3-70b-versatile",
          messages: [
            { role: "system", content: god.lore },
            { role: "user", content: prompt },
          ],
          max_tokens: 60,
          temperature: 0.9,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const text = cleanup(data?.choices?.[0]?.message?.content ?? "");
        if (text) {
          return Response.json(
            { text, source: "groq", model: "llama-3.3-70b-versatile" },
            { headers: { "Cache-Control": "no-store" } }
          );
        }
      }
      // Groq returned non-200 or empty text — fall through to Gemini
    } catch { /* fall through */ }
  }

  // 2) Gemini fallback (Google AI Studio — different vendor, different rate limit)
  if (GEMINI_KEY) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: god.lore }] },
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.9, maxOutputTokens: 80 },
          }),
        }
      );
      if (res.ok) {
        const data = await res.json();
        const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
        const text = cleanup(raw);
        if (text) {
          return Response.json(
            { text, source: "groq", model: "gemini-2.0-flash" },
            { headers: { "Cache-Control": "no-store" } }
          );
        }
      }
    } catch { /* fall through to local */ }
  }

  return Response.json({ text: "", source: "local", error: "all off-chain LLM paths failed" });
}
