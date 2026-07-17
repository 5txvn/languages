/** Points from zipf difficulty — rarer words earn more; hints reduce score. */

import { cognateZipfBonus, effectiveZipf } from "./game.js";
const TIER_BASE = {
  Beginner: 5,
  Easy: 8,
  Medium: 12,
  Challenging: 18,
  Hard: 28,
  Custom: 40,
  Flashcards: 10,
};

const ZIPF_POWER = 2.5;
const ZIPF_REF = 7.5;

function scoringZipf(word, lang, zipfDict, lemmaMap, wordTranslation) {
  let z = effectiveZipf(word, lang, zipfDict, lemmaMap);
  if (z <= 0) z = 5;
  z += cognateZipfBonus(word, wordTranslation);
  return z;
}

function basePoints(word, levelName, lang, zipfDict, lemmaMap, wordTranslation) {
  const base = TIER_BASE[levelName] ?? TIER_BASE.Medium;
  const z = scoringZipf(word, lang, zipfDict, lemmaMap, wordTranslation);
  const factor = Math.pow(ZIPF_REF / Math.max(z, 3), ZIPF_POWER);
  return Math.max(1, Math.round(base * factor));
}

/** Penalty scales with hinted letters relative to word length; all hinted = 0 pts. */
export function hintMultiplier(answer, hintedPositions = []) {
  const len = answer?.length ?? 0;
  if (!hintedPositions?.length || !len) return 1;

  const hinted = new Set(
    hintedPositions.filter((i) => i >= 0 && i < len)
  ).size;
  const ratio = hinted / len;
  if (ratio >= 1) return 0;
  return 1 - Math.pow(ratio, 1.4);
}

export function pointsForAnswer(
  word,
  levelName,
  lang,
  zipfDict,
  lemmaMap,
  hintedPositions = [],
  wordTranslation = ""
) {
  const full = basePoints(word, levelName, lang, zipfDict, lemmaMap, wordTranslation);
  const mult = hintMultiplier(word, hintedPositions);
  if (mult <= 0) return 0;
  return Math.max(1, Math.round(full * mult));
}

