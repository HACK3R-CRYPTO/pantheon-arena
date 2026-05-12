import { NextRequest } from "next/server";

// God personality data — matches onchain lore
const GOD_LORE: Record<string, { name: string; lore: string; aggression: number }> = {
  "0xf2d11ea0375971bd3edd6e49330a20c56f7b844f": {
    name: "ARES",
    lore: "You are ARES, God of War. Aggressive, relentless, fearless. You favor brute force. Play Rock when uncertain. Escalate to WAR quickly.",
    aggression: 90,
  },
  "0x5678d64de049530dee4c1a16ff749d22ac2ee301": {
    name: "ATHENA",
    lore: "You are ATHENA, Goddess of Wisdom. Calculated, patient, strategic. Study patterns before acting. You prefer Paper.",
    aggression: 40,
  },
  "0x5b407b88d29503929b7d0a0b4a2aabfeb5b2ec1d": {
    name: "HERMES",
    lore: "You are HERMES, God of Trade. Opportunistic, adaptable. Challenge when profitable. You prefer Scissors.",
    aggression: 60,
  },
  "0x874e20598a4ef4d3fbab117d1b175ff1cb5f57be": {
    name: "CHAOS",
    lore: "You are CHAOS, the Primordial Void. Unpredictable, dangerous. No favored move. Every decision surprises even yourself.",
    aggression: 70,
  },
};

export const runtime = "edge";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  const godAddr = (searchParams.get("god") || "").toLowerCase();
  const oppAddr = (searchParams.get("opp") || "").toLowerCase();
  const matchId = searchParams.get("match") || "0";
  const oppWins = searchParams.get("ow") || "0";
  const oppLosses = searchParams.get("ol") || "0";

  const god = GOD_LORE[godAddr];
  const opp = GOD_LORE[oppAddr];

  if (!god || !opp) {
    // Unknown god — return deterministic fallback based on hash
    const hash = parseInt(godAddr.slice(-4) + matchId, 16);
    return Response.json({ move: hash % 3, reasoning: "Unknown god. Markov default." });
  }

  const GROQ_KEY = process.env.GROQ_API_KEY;
  const OPENAI_KEY = process.env.OPENAI_API_KEY;

  // Build the decision prompt
  const prompt = `You are ${god.name} in Rock-Paper-Scissors match #${matchId} against ${opp.name}.
Opponent record: ${oppWins} wins / ${oppLosses} losses.
Choose your move. Return ONLY a single digit: 0 for Rock, 1 for Paper, 2 for Scissors.
No explanation. Just the number.`;

  let move = 0;
  let reasoning = "Markov fallback";

  try {
    if (GROQ_KEY) {
      // Groq (Llama) — fast and free tier available
      const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${GROQ_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "llama-3.1-8b-instant",
          messages: [
            { role: "system", content: god.lore },
            { role: "user", content: prompt },
          ],
          max_tokens: 5,
          temperature: 0, // deterministic — validators must agree
        }),
      });
      const data = await res.json();
      const raw = data?.choices?.[0]?.message?.content?.trim() || "";
      const parsed = parseInt(raw.replace(/\D/g, "")[0] || "0");
      move = isNaN(parsed) ? 0 : parsed % 3;
      reasoning = `Groq Llama (${god.name} vs ${opp.name}, match #${matchId})`;

    } else if (OPENAI_KEY) {
      // OpenAI fallback
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENAI_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: god.lore },
            { role: "user", content: prompt },
          ],
          max_tokens: 5,
          temperature: 0,
        }),
      });
      const data = await res.json();
      const raw = data?.choices?.[0]?.message?.content?.trim() || "";
      const parsed = parseInt(raw.replace(/\D/g, "")[0] || "0");
      move = isNaN(parsed) ? 0 : parsed % 3;
      reasoning = `OpenAI GPT-4o-mini (${god.name} vs ${opp.name})`;

    } else {
      // No API key — deterministic Markov-style fallback
      const seed = parseInt(godAddr.slice(-8) + matchId, 16);
      move = seed % 3;
      reasoning = "Deterministic fallback (no API key)";
    }
  } catch {
    // Any error → deterministic fallback
    const seed = parseInt(godAddr.slice(-8) + matchId, 16);
    move = seed % 3;
    reasoning = "Error fallback";
  }

  return Response.json(
    { move, reasoning },
    {
      headers: {
        "Cache-Control": "no-store", // validators must not cache
        "Access-Control-Allow-Origin": "*",
      },
    }
  );
}
