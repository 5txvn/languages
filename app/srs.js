/** Spaced repetition for sentence practice. */

import { tokenizeWithPositions, wordsMatch } from "./game.js";

export const LEARNED_THRESHOLD = 5;

/** Ms until next review after each successful completion (1st–5th). */
export const REVIEW_INTERVALS_MS = [
  10 * 60 * 1000,
  24 * 60 * 60 * 1000,
  3 * 24 * 60 * 60 * 1000,
  7 * 24 * 60 * 60 * 1000,
  14 * 24 * 60 * 60 * 1000,
];

export function nextReviewAfterCorrect(correctCount) {
  const idx = Math.max(0, Math.min(correctCount - 1, REVIEW_INTERVALS_MS.length - 1));
  return Date.now() + REVIEW_INTERVALS_MS[idx];
}

export function nextReviewAfterWrong() {
  return Date.now();
}

export function isLearned(review) {
  return (review.correctCount ?? 0) >= LEARNED_THRESHOLD;
}

export function puzzleFromReview(review) {
  const sentence = review.sentence;
  const positioned = tokenizeWithPositions(sentence);
  let blankIndex = positioned.findIndex((t) => wordsMatch(t.text, review.answer));
  if (blankIndex < 0) {
    blankIndex = positioned.findIndex(
      (t) => t.text.toLowerCase() === (review.answer || "").toLowerCase()
    );
  }
  if (blankIndex < 0) blankIndex = 0;
  return {
    sentence,
    lineIndex: review.lineIndex ?? null,
    tokens: positioned,
    blankIndex,
    answer: review.answer || positioned[blankIndex]?.text || "",
    reviewId: review.id,
  };
}
