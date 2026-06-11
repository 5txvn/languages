/** Article corpus loading and sequential fill-in-the-blank puzzles. */

import {
  resolveDataUrl,
  tokenizeWithPositions,
  eligibleBlankIndices,
  estimateTokenZipf,
  isSentenceContentToken,
  sentencePassesFilters,
} from "./game.js";

export function articlesFilename(langCode) {
  return `${langCode}_articles.jsonl`;
}

export async function loadArticles(langCode) {
  const filename = articlesFilename(langCode);
  let url;
  try {
    url = await resolveDataUrl(filename, { required: false });
  } catch {
    return [];
  }
  if (!url) return [];

  const res = await fetch(url);
  if (!res.ok) return [];
  const text = await res.text();
  const articles = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const rec = JSON.parse(trimmed);
      if (rec._meta) continue;
      if (rec.title && rec.text) articles.push(rec);
    } catch {
      /* skip bad lines */
    }
  }
  return articles;
}

export function splitArticleSentences(text) {
  return text
    .split(/(?<=[.!?…])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 8);
}

export function paragraphForSentence(articleText, sentence) {
  const paras = articleText.split(/\n{2,}|\s{2,}/).map((p) => p.trim()).filter(Boolean);
  for (const p of paras) {
    if (p.includes(sentence)) return p;
  }
  const idx = articleText.indexOf(sentence);
  if (idx < 0) return sentence;
  const start = Math.max(0, idx - 120);
  const end = Math.min(articleText.length, idx + sentence.length + 120);
  let chunk = articleText.slice(start, end).trim();
  if (start > 0) chunk = "…" + chunk;
  if (end < articleText.length) chunk += "…";
  return chunk;
}

/**
 * Build the next puzzle in an article, scanning sentences from cursor onward.
 * Returns null when no more eligible blanks remain.
 */
export function buildArticlePuzzle(
  article,
  cursor,
  lo,
  hi,
  lang,
  zipfDict,
  lemmaMap,
  filters = null
) {
  const sentences = splitArticleSentences(article.text);
  for (let si = cursor; si < sentences.length; si++) {
    const sentence = sentences[si];
    if (!sentencePassesFilters(sentence, filters, lang, zipfDict, lemmaMap)) continue;
    const positioned = tokenizeWithPositions(sentence);
    if (positioned.length < 4) continue;
    const texts = positioned.map((t) => t.text);
    const candidates = eligibleBlankIndices(texts, lo, hi, lang, zipfDict, lemmaMap);
    if (!candidates.length) continue;
    const blankIndex = candidates[Math.floor(Math.random() * candidates.length)];
    return {
      sentence,
      lineIndex: null,
      tokens: positioned,
      blankIndex,
      answer: positioned[blankIndex].text,
      articleTitle: article.title,
      articleIndex: si,
      paragraphContext: paragraphForSentence(article.text, sentence),
    };
  }
  return null;
}

/** Rough difficulty label from average word zipf in an article. */
export function articleDifficultyLabel(article, lang, zipfDict, lemmaMap) {
  const tokens = article.text.match(/\b[\wáéíóúüñÁÉÍÓÚÜÑàèéìòùäöüßąćęłńóśźżА-яЁё'-]+\b/gu) || [];
  if (!tokens.length) return "—";
  let sum = 0;
  let n = 0;
  for (const tok of tokens.slice(0, 400)) {
    if (!isSentenceContentToken(tok)) continue;
    sum += estimateTokenZipf(tok, lang, zipfDict, lemmaMap);
    n += 1;
  }
  if (!n) return "—";
  const avg = sum / n;
  if (avg >= 6.2) return "Beginner";
  if (avg >= 5.5) return "Easy";
  if (avg >= 5.0) return "Medium";
  if (avg >= 4.5) return "Challenging";
  return "Advanced";
}
