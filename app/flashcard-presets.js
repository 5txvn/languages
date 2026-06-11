/** Load and seed built-in vocabulary flashcard sets per language. */

import { assetUrl } from "./game.js";
import { getFlashcardSets, saveFlashcardSet } from "./db.js";

export async function loadBuiltinPresets(langCode) {
  try {
    const res = await fetch(assetUrl(`flashcard-presets/${langCode}.json`));
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function seedBuiltinFlashcardSets(langCode) {
  const data = await loadBuiltinPresets(langCode);
  if (!data?.sets?.length) return 0;

  const existing = await getFlashcardSets(langCode);
  const existingBuiltin = new Set(
    existing.filter((s) => s.builtinId).map((s) => s.builtinId)
  );
  const existingNames = new Set(existing.map((s) => s.name.trim().toLowerCase()));

  let added = 0;
  const now = Date.now();
  for (const preset of data.sets) {
    if (existingBuiltin.has(preset.id)) continue;
    const name = preset.name?.trim();
    if (!name || existingNames.has(name.toLowerCase())) continue;

    const words = (preset.words ?? [])
      .map((w) => (typeof w === "string" ? w.trim() : ""))
      .filter(Boolean)
      .map((word, i) => ({ word, addedAt: now + i }));

    if (!words.length) continue;

    await saveFlashcardSet({
      id: crypto.randomUUID(),
      langCode,
      name,
      builtinId: preset.id,
      words,
      createdAt: now,
      updatedAt: now,
    });
    existingNames.add(name.toLowerCase());
    added += 1;
  }
  return added;
}
