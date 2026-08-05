/** Load and seed built-in vocabulary flashcard sets per language. */

import { assetUrl } from "./game.js";
import { getFlashcardSets, saveFlashcardSet } from "./db.js";

export const PRESET_ICONS = {
  "builtin-colors": "🎨",
  "builtin-animals": "🐾",
  "builtin-numbers": "🔢",
  "builtin-days": "📅",
  "builtin-months": "🗓️",
  "builtin-family": "👨‍👩‍👧",
  "builtin-body": "🧍",
  "builtin-food": "🍽️",
  "builtin-drinks": "🥤",
  "builtin-verbs": "⚡",
  "builtin-greetings": "👋",
  "builtin-weather": "⛅",
  "builtin-clothing": "👕",
  "builtin-house": "🏠",
  "builtin-transport": "🚌",
  "builtin-professions": "💼",
  "builtin-adjectives": "✨",
  "builtin-time": "⏰",
  "builtin-school": "📚",
  "builtin-nature": "🌿",
  "builtin-emotions": "😊",
  "builtin-places": "📍",
  "builtin-sports": "⚽",
  "builtin-questions": "❓",
  "builtin-directions": "🧭",
  "builtin-fruits": "🍎",
  "builtin-technology": "💻",
  "builtin-health": "❤️",
  "builtin-kitchen": "🍳",
};

const NAME_ICON_FALLBACKS = [
  [/color/i, "🎨"],
  [/animal/i, "🐾"],
  [/food|comida|manger/i, "🍽️"],
  [/cloth|roupa|vêt/i, "👕"],
  [/famil/i, "👨‍👩‍👧"],
  [/body|corpo/i, "🧍"],
  [/house|casa|home/i, "🏠"],
  [/travel|viagem/i, "✈️"],
  [/nature|natur/i, "🌿"],
  [/school|escola/i, "📚"],
  [/work|trabalh/i, "💼"],
  [/time|tempo/i, "⏰"],
  [/weather|tempo/i, "⛅"],
  [/emotion|feeling/i, "😊"],
  [/verb/i, "⚡"],
  [/number|número/i, "🔢"],
  [/place|lugar/i, "📍"],
  [/transport|car/i, "🚌"],
  [/sport/i, "⚽"],
];

export function iconForPreset(set) {
  if (set?.icon) return set.icon;
  if (set?.builtinId && PRESET_ICONS[set.builtinId]) return PRESET_ICONS[set.builtinId];
  const name = set?.name || "";
  for (const [re, icon] of NAME_ICON_FALLBACKS) {
    if (re.test(name)) return icon;
  }
  return "🗂️";
}

export const PRESET_ROUND_GOAL = 10;

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
      icon: preset.icon || PRESET_ICONS[preset.id] || iconForPreset({ name, builtinId: preset.id }),
      successfulRounds: 0,
      words,
      createdAt: now,
      updatedAt: now,
    });
    existingNames.add(name.toLowerCase());
    added += 1;
  }
  return added;
}
