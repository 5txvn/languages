/** Flashcard set export/import with validation. */

export const EXPORT_VERSION = 1;

export function exportSet(set) {
  return JSON.stringify(
    {
      version: EXPORT_VERSION,
      name: set.name,
      langCode: set.langCode,
      words: set.words.map((w) => ({ word: w.word, addedAt: w.addedAt })),
      exportedAt: Date.now(),
    },
    null,
    2
  );
}

export function parseImport(jsonText, expectedLang) {
  let data;
  try {
    data = JSON.parse(jsonText);
  } catch {
    throw new Error("Invalid JSON file.");
  }
  if (!data || typeof data !== "object") throw new Error("Invalid flashcard file.");
  if (!data.name || typeof data.name !== "string") throw new Error("Missing set name.");
  if (data.langCode && data.langCode !== expectedLang) {
    throw new Error(`This set is for ${data.langCode}, not ${expectedLang}.`);
  }
  if (!Array.isArray(data.words)) throw new Error("Missing words array.");
  const words = data.words
    .map((w) => (typeof w === "string" ? w : w?.word))
    .filter((w) => typeof w === "string" && w.trim())
    .map((w) => ({ word: w.trim().normalize("NFC"), addedAt: Date.now() }));
  if (!words.length) throw new Error("No valid words in file.");
  return { name: data.name.trim(), words };
}
