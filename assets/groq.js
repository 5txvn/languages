/** Groq API chat for word analysis. */

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const DEFAULT_MODEL = "llama-3.3-70b-versatile";

export async function groqChat(apiKey, messages, model = DEFAULT_MODEL) {
  const res = await fetch(GROQ_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: 1024,
      temperature: 0.4,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `Groq error ${res.status}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim() ?? "";
}

export function buildWordContext(word, translation, langLabel) {
  return `You are helping an English speaker learn ${langLabel}. They looked up the word "${word}" (translation: ${translation}). Answer concisely and help them understand usage, grammar, and nuance.`;
}
