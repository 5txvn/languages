/** Verb conjugation practice — data in assets/verbs/{lang}.json */

import { assetUrl, wordsMatch, shuffleArray } from "./game.js";

/** Languages with conjugation practice available. */
export const CONJUGATION_LANGS = new Set(["es", "pt", "fr", "it", "de"]);

export function conjugationsAvailable(langCode) {
  return CONJUGATION_LANGS.has(langCode);
}

export async function loadVerbPack(langCode) {
  if (!conjugationsAvailable(langCode)) return null;
  try {
    const res = await fetch(assetUrl(`verbs/${langCode}.json`));
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export function listTenses(pack) {
  const tenseIds = new Set();
  for (const verb of pack?.verbs ?? []) {
    for (const t of Object.keys(verb.conjugations ?? {})) tenseIds.add(t);
  }
  const labels = pack?.tenseLabels ?? {};
  return [...tenseIds].map((id) => ({ id, label: labels[id] ?? id }));
}

export function listPronouns(pack) {
  return pack?.pronouns ?? [];
}

/**
 * Build a quiz item: prompt with infinitive + tense + pronoun, answer = conjugated form.
 */
export function pickConjugationItem(pack, { tenseFilter = null, usedKeys = null } = {}) {
  const verbs = pack?.verbs ?? [];
  if (!verbs.length) return null;
  const pronouns = listPronouns(pack);
  const candidates = [];
  for (const verb of verbs) {
    for (const [tense, forms] of Object.entries(verb.conjugations ?? {})) {
      if (tenseFilter?.length && !tenseFilter.includes(tense)) continue;
      for (const p of pronouns) {
        const answer = forms?.[p.id];
        if (!answer) continue;
        const key = `${verb.infinitive}|${tense}|${p.id}`;
        if (usedKeys?.has(key)) continue;
        candidates.push({
          key,
          infinitive: verb.infinitive,
          gloss: verb.gloss || "",
          tense,
          tenseLabel: pack.tenseLabels?.[tense] ?? tense,
          pronounId: p.id,
          pronounLabel: p.label,
          answer,
        });
      }
    }
  }
  if (!candidates.length) {
    usedKeys?.clear();
    return pickConjugationItem(pack, { tenseFilter, usedKeys: null });
  }
  const item = candidates[Math.floor(Math.random() * candidates.length)];
  usedKeys?.add(item.key);
  return item;
}

export function conjugationCorrect(guess, answer) {
  return wordsMatch(guess, answer);
}

export { shuffleArray };
