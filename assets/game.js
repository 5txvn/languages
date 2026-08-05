/** Static frontend game logic — no backend required. */

/** Unicode letters + marks (ç, á, ã…). Avoid \\b — JS word boundaries break on accents. */
export const WORD_PATTERN = /[\p{L}\p{M}0-9'’-]+/gu;
export const ZIPF_MIN = 3.0;
export const ZIPF_MAX = 8.0;
/** @deprecated Prefer loading the full corpus via streamAllSentences. */
export const TARGET_COUNT = Infinity;
export const CORPUS_STATS_VERSION = 4;

/** Zipf ranges — descriptions are language-neutral. */
export const DIFFICULTY_PRESETS = [
  { name: "Beginner", lo: 6.0, hi: 8.0, desc: "The most common words: articles, pronouns, basic verbs" },
  { name: "Easy", lo: 5.5, hi: 6.0, desc: "Everyday vocabulary you hear in normal conversation" },
  { name: "Medium", lo: 5.0, hi: 5.5, desc: "Less frequent words: news, opinions, descriptions" },
  { name: "Challenging", lo: 4.5, hi: 5.0, desc: "Uncommon words that still appear in real writing" },
  { name: "Hard", lo: 4.0, hi: 4.5, desc: "Specialized or literary vocabulary" },
  { name: "Expert", lo: 3.0, hi: 4.0, desc: "Rare words. Still fair game, but tough" },
];

const ASSET_BASE = "assets/";

export function assetUrl(relative) {
  const path = relative.replace(/^\//, "");
  return new URL(ASSET_BASE + path, window.location.href).href;
}

/** Supported sentence corpora (files: `{lang}_{corpus}.txt`). */
export const CORPUS_OPTIONS = [
  { id: "wiki", label: "Wikipedia" },
  { id: "movies", label: "Movies" },
];

/** Legacy filenames for older installs / bookmarks. */
export const LEGACY_SENTENCE_FILES = {
  es: ["es_sentences.txt", "spanish.txt"],
  pt: ["pt_sentences.txt", "portuguese.txt"],
  de: ["de_sentences.txt", "german.txt"],
  fr: ["fr_sentences.txt", "french.txt"],
  it: ["it_sentences.txt", "italian.txt"],
  en: ["en_sentences.txt", "english.txt"],
  nl: ["nl_sentences.txt", "dutch.txt"],
  pl: ["pl_sentences.txt", "polish.txt"],
  ru: ["ru_sentences.txt", "russian.txt"],
};

export function sentenceFilename(langCode, corpus = "wiki") {
  return `${langCode}_${corpus}.txt`;
}

export function corpusStatsFilename(langCode, corpus = "wiki") {
  return `${langCode}_${corpus}.json`;
}

export function legacyFallbacks(langCode, corpus = "wiki") {
  if (corpus !== "wiki") return [];
  return LEGACY_SENTENCE_FILES[langCode] ?? [`${langCode}_sentences.txt`];
}

/** Resolve data file — works from site root (index.html + assets/). */
export async function resolveDataUrl(filename, { fallbacks = [], required = true } = {}) {
  const names = [filename, ...fallbacks];
  for (const name of names) {
    for (const rel of [`../data/${name}`, `data/${name}`]) {
      const url = assetUrl(rel);
      try {
        let r = await fetch(url, { method: "HEAD" });
        if (!r.ok) r = await fetch(url, { headers: { Range: "bytes=0-2" } });
        if (r.ok) return url;
      } catch {
        /* try next */
      }
    }
  }
  if (!required) return null;
  throw new Error(`Could not find data/${filename}`);
}

export const FILTER_WORD_MIN = 1;
export const FILTER_WORD_MAX = 40;
export const FILTER_AVG_ZIPF_MIN = 2.5;
export const FILTER_AVG_ZIPF_MAX = 8.0;
/** Minimum tokens needed for a fill-in-the-blank puzzle. */
export const MIN_PUZZLE_WORDS = 1;

export const DEFAULT_SENTENCE_FILTERS = {
  enabled: false,
  minWords: 5,
  maxWords: 15,
  minAvgZipf: 4.9,
  maxAvgZipf: 6.5,
};

/** Pessimistic Zipf for tokens missing from the static dictionary (pulls avg down). */
export const ZIPF_UNKNOWN_ESTIMATE = 3.0;
export const MAX_BLANK_WORD_EXPOSURE = 5;

/** True when the lemma map links this form to a verb infinitive (conjugation). */
export function isVerbForm(word, lemmaMap) {
  const lower = (word ?? "").toLowerCase();
  return Boolean(lemmaMap?.[lower]);
}

/** Singular/plural normalization for nouns — not applied to verb forms. */
export function nounLemmaKey(word, lang) {
  let w = normalizeForMatch(word);
  if (lang === "pt") {
    if (w.endsWith("ões") && w.length > 4) return `${w.slice(0, -3)}ão`;
    if (w.endsWith("ães") && w.length > 4) return `${w.slice(0, -3)}ão`;
    if (w.endsWith("ais") && w.length > 4) return `${w.slice(0, -1)}l`;
    if (w.endsWith("éis") && w.length > 4) return `${w.slice(0, -3)}el`;
    if (w.endsWith("óis") && w.length > 4) return `${w.slice(0, -3)}ol`;
    if (w.endsWith("uis") && w.length > 4) return `${w.slice(0, -3)}ul`;
    if (w.endsWith("zes") && w.length > 4) return `${w.slice(0, -2)}z`;
    if (
      w.endsWith("es") &&
      w.length > 4 &&
      !w.endsWith("mes") &&
      !w.endsWith("res") &&
      !w.endsWith("nes")
    ) {
      return w.slice(0, -2);
    }
    if (w.endsWith("s") && w.length > 3) return w.slice(0, -1);
    return w;
  }
  if (lang === "es") {
    if (w.endsWith("ces") && w.length > 4) return `${w.slice(0, -3)}z`;
    if (
      w.endsWith("es") &&
      w.length > 4 &&
      !w.endsWith("mes") &&
      !w.endsWith("res") &&
      !w.endsWith("nes")
    ) {
      return w.slice(0, -2);
    }
    if (w.endsWith("s") && w.length > 3) return w.slice(0, -1);
    return w;
  }
  if (
    w.endsWith("es") &&
    w.length > 4 &&
    !w.endsWith("mes") &&
    !w.endsWith("res") &&
    !w.endsWith("nes")
  ) {
    return w.slice(0, -2);
  }
  if (w.endsWith("s") && w.length > 3) return w.slice(0, -1);
  return w;
}

/** Lemma+sense key — conjugations / gender variants share one quiz slot. */
export function senseDedupKey(lemma, sense) {
  const lem = normalizeForMatch(lemma || "");
  if (!lem) return "";
  return `${lem}::${(sense || "s0").toLowerCase()}`;
}

/** Session/global dedup key — nouns collapse plural forms; verbs keep each surface form. */
export function blankWordDedupKey(word, lang, lemmaMap) {
  const lower = normalizeForMatch(word);
  if (isVerbForm(word, lemmaMap)) return `v:${lower}`;
  return `n:${nounLemmaKey(lower, lang)}`;
}

export function puzzleMatchesReported(a, b) {
  if (!a || !b) return false;
  if (a.lineIndex != null && b.lineIndex != null && a.lineIndex === b.lineIndex) return true;
  const na = (a.sentence ?? "").trim().normalize("NFC");
  const nb = (b.sentence ?? "").trim().normalize("NFC");
  return na.length > 0 && na === nb;
}

export function puzzleIsSkipped(puzzle, skippedSet) {
  if (!puzzle || !skippedSet) return false;
  if (puzzle.lineIndex != null && skippedSet.indices?.has(puzzle.lineIndex)) return true;
  const norm = puzzle.sentence?.trim().normalize("NFC");
  if (norm && skippedSet.sentences?.has(norm)) return true;
  return false;
}

export function blankWordAllowed(
  word,
  lang,
  lemmaMap,
  {
    sessionBlankKeys = null,
    wordExposure = null,
    maxExposure = MAX_BLANK_WORD_EXPOSURE,
    blockedWordKeys = null,
  } = {}
) {
  const key = blankWordDedupKey(word, lang, lemmaMap);
  if (sessionBlankKeys?.has(key)) return false;
  if (blockedWordKeys?.has(key)) return false;
  if ((wordExposure?.[key] ?? 0) >= maxExposure) return false;
  return true;
}

const DE_STEM_SUFFIXES = [
  "ieren", "ierung", "ungen", "ung", "heit", "keit", "lich", "isch", "chen", "lein",
  "esten", "este", "sten", "ster", "ung", "eln", "eln", "tum", "sam", "bar",
  "en", "er", "es", "em", "e", "n", "s",
];

export function isSentenceContentToken(text) {
  if (!text || text.length < 2) return false;
  return /\p{L}/u.test(text) && !/^\d+([,.]\d+)?$/.test(text);
}

export function guessInfinitiveDe(word, zipfDict) {
  const w = word.toLowerCase();
  for (const suf of DE_STEM_SUFFIXES) {
    if (!w.endsWith(suf) || w.length <= suf.length + 3) continue;
    const stem = w.slice(0, -suf.length);
    if (zipfDict[stem]) return zipfDict[stem];
    if (zipfDict[stem + "en"]) return zipfDict[stem + "en"];
    if (zipfDict[stem + "er"]) return zipfDict[stem + "er"];
  }
  return 0;
}

/** Best Zipf for a token — dictionary, hyphen parts, morphology, then rare-word penalty. */
export function estimateTokenZipf(word, lang, zipfDict, lemmaMap) {
  let z = effectiveZipf(word, lang, zipfDict, lemmaMap);
  if (z > 0) return z;

  const parts = word.split("-").filter((p) => p.length >= 2);
  if (parts.length > 1) {
    const partZipfs = parts
      .map((p) => effectiveZipf(p, lang, zipfDict, lemmaMap))
      .filter((v) => v > 0);
    if (partZipfs.length) return Math.max(...partZipfs);
  }

  if (lang === "de") {
    z = guessInfinitiveDe(word, zipfDict);
    if (z > 0) return z;
  }

  return ZIPF_UNKNOWN_ESTIMATE;
}

export function sentenceAverageZipf(
  sentence,
  lang,
  zipfDict,
  lemmaMap,
  lemmaZipf = null,
  tags = null,
  senseZipf = null
) {
  const positioned = tokenizeWithPositions(sentence).filter((t) => isSentenceContentToken(t.text));
  if (!positioned.length) return null;
  const zipfs = positioned.map((t, i) => {
    const tag = tags?.[i];
    if (tag?.lemma && senseZipf) {
      const sk = senseDedupKey(tag.lemma, tag.sense);
      const z = senseZipf[sk] ?? lemmaZipf?.[normalizeForMatch(tag.lemma)] ?? 0;
      return z > 0 ? z : ZIPF_UNKNOWN_ESTIMATE;
    }
    const word = tag?.lemma || t.text;
    if (lemmaZipf) {
      const z = effectiveZipf(word, lang, zipfDict, lemmaMap, lemmaZipf);
      return z > 0 ? z : ZIPF_UNKNOWN_ESTIMATE;
    }
    return estimateTokenZipf(word, lang, zipfDict, lemmaMap);
  });
  return zipfs.reduce((a, b) => a + b, 0) / zipfs.length;
}

/** Average Zipf for a sentence — prefers precomputed corpus stats by line index. */
export function sentenceAvgZipfForFilter(sentence, lineIndex, lang, zipfDict, lemmaMap, corpusStats) {
  if (corpusStats?.avgZipfByLine && lineIndex != null && lineIndex < corpusStats.avgZipfByLine.length) {
    const cached = corpusStats.avgZipfByLine[lineIndex];
    if (cached != null) return cached;
  }
  const dict = corpusStats?.wordZipf ?? zipfDict;
  return sentenceAverageZipf(sentence, lang, dict, lemmaMap);
}

/** Optional filters so surrounding sentence complexity matches the blank word level. */
export function sentencePassesFilters(
  sentence,
  filters,
  lang,
  zipfDict,
  lemmaMap,
  corpusStats = null,
  lineIndex = null,
  precomputed = null
) {
  if (!filters?.enabled) return true;
  const wc =
    precomputed?.wordCount ??
    (lineIndex != null && corpusStats?.wordCountByLine?.[lineIndex] != null
      ? corpusStats.wordCountByLine[lineIndex]
      : tokenizeWithPositions(sentence).length);
  if (filters.minWords != null && wc < filters.minWords) return false;
  if (filters.maxWords != null && wc > filters.maxWords) return false;
  if (filters.minAvgZipf != null || filters.maxAvgZipf != null) {
    const avg =
      precomputed?.avgZipf ??
      sentenceAvgZipfForFilter(sentence, lineIndex, lang, zipfDict, lemmaMap, corpusStats);
    if (avg == null) return false;
    if (filters.minAvgZipf != null && avg < filters.minAvgZipf) return false;
    if (filters.maxAvgZipf != null && avg > filters.maxAvgZipf) return false;
  }
  return true;
}

export function normalizeForMatch(s) {
  return s.normalize("NFC").toLowerCase();
}

export function wordsMatch(guess, answer) {
  return normalizeForMatch(guess) === normalizeForMatch(answer);
}

/** True if the same word appears at another token position (would spoil the blank). */
export function answerAppearsElsewhere(tokens, blankIndex, answer) {
  const norm = normalizeForMatch(answer);
  for (let i = 0; i < tokens.length; i++) {
    if (i === blankIndex) continue;
    if (normalizeForMatch(tokens[i]) === norm) return true;
  }
  return false;
}

export function stripAccents(s) {
  return (s ?? "").normalize("NFD").replace(/\p{M}/gu, "");
}

export function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const row = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) row[j] = j;
  for (let i = 1; i <= a.length; i++) {
    let prev = i - 1;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + cost);
      prev = tmp;
    }
  }
  return row[b.length];
}

export const COGNATE_MAX_DISTANCE = 5;
export const COGNATE_MIN_WORD_LEN = 4;
export const COGNATE_ZIPF_BONUS = 1.25;

/** Extra Zipf when target word is a cognate of its translation (easier → fewer points). */
export function cognateZipfBonus(word, translation) {
  if (!word || !translation) return 0;
  const a = stripAccents(normalizeForMatch(word)).replace(/[^a-z0-9]/gu, "");
  const b = stripAccents(normalizeForMatch(translation)).replace(/[^a-z0-9]/gu, "");
  if (!a || !b) return 0;
  const minLen = Math.min(a.length, b.length);
  if (minLen < COGNATE_MIN_WORD_LEN) return 0;
  if (Math.abs(a.length - b.length) > COGNATE_MAX_DISTANCE) return 0;
  if (levenshtein(a, b) <= COGNATE_MAX_DISTANCE) return COGNATE_ZIPF_BONUS;
  return 0;
}

export function prefixMatches(guess, answer) {
  const g = normalizeForMatch(guess);
  const a = normalizeForMatch(answer);
  return g.length > 0 && a.startsWith(g);
}

export function tokenizeWithPositions(sentence) {
  const tokens = [];
  const re = new RegExp(WORD_PATTERN.source, "gu");
  let m;
  while ((m = re.exec(sentence)) !== null) {
    tokens.push({ text: m[0], start: m.index, end: m.index + m[0].length });
  }
  return tokens;
}

export function sentenceOnly(line) {
  if (line.startsWith("#")) return null;
  return line.split("\t", 1)[0].trim();
}

export function sentenceText(entry) {
  if (entry == null) return "";
  return typeof entry === "string" ? entry : entry.text ?? "";
}

export function sentenceLineIndex(entry) {
  if (entry && typeof entry === "object" && entry.lineIndex != null) return entry.lineIndex;
  return null;
}

/** Fetch one sentence from a data file by its 0-based line index. */
export async function fetchSentenceAtIndex(filename, lineIndex) {
  const url = await resolveDataUrl(filename);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load ${filename}`);
  const text = await res.text();
  let idx = -1;
  for (const raw of text.split("\n")) {
    const line = sentenceOnly(raw.trim());
    if (!line) continue;
    idx += 1;
    if (idx === lineIndex) return line;
  }
  return null;
}

/** Vocabulary drawn from sentence files — used to validate flashcard words. */
export function buildVocabSet(sentences) {
  const set = new Set();
  for (const line of sentences) {
    const text = sentenceText(line);
    if (!text) continue;
    for (const tok of tokenizeWithPositions(text)) {
      set.add(normalizeForMatch(tok.text));
    }
  }
  return set;
}

export function isKnownWord(word, lang, zipfDict, lemmaMap, vocabSet) {
  const trimmed = word.trim();
  if (!trimmed || trimmed.length > 80) return false;

  const checkToken = (token) => {
    if (!/^\p{L}[\p{L}\p{M}'-]*$/u.test(token)) return false;
    if (effectiveZipf(token, lang, zipfDict, lemmaMap) > 0) return true;
    return vocabSet?.has(normalizeForMatch(token)) ?? false;
  };

  const parts = trimmed.split(/\s+/);
  return parts.length > 0 && parts.every(checkToken);
}

export function guessInfinitiveEs(word, zipfDict) {
  const w = word.toLowerCase();
  if (w.endsWith("ando")) {
    const stem = w.slice(0, -4);
    if (zipfDict[stem + "ar"]) return stem + "ar";
    if (zipfDict[stem + "er"]) return stem + "er";
  }
  if (w.endsWith("iendo")) {
    const stem = w.slice(0, -5);
    if (zipfDict[stem + "er"]) return stem + "er";
    if (zipfDict[stem + "ir"]) return stem + "ir";
  }
  if (w.endsWith("ado")) {
    const stem = w.slice(0, -3);
    if (zipfDict[stem + "ar"]) return stem + "ar";
  }
  if (w.endsWith("ido")) {
    const stem = w.slice(0, -3);
    if (zipfDict[stem + "er"]) return stem + "er";
    if (zipfDict[stem + "ir"]) return stem + "ir";
  }
  if (w.length > 3 && w.endsWith("o")) {
    const stem = w.slice(0, -1);
    for (const end of ["ar", "er", "ir"]) {
      const inf = stem + end;
      if (zipfDict[inf]) return inf;
    }
  }
  return null;
}

export function effectiveZipf(word, lang, zipfDict, lemmaMap, lemmaZipf = null) {
  const lower = word.toLowerCase();
  const tryLookup = (w) => {
    if (lemmaZipf && lemmaZipf[w] != null) return lemmaZipf[w];
    return zipfDict[w] ?? 0;
  };

  let z = tryLookup(lower);
  if (z > 0) return z;

  const bare = lower.normalize("NFD").replace(/\p{M}/gu, "");
  if (bare !== lower) z = tryLookup(bare);
  if (z > 0) return z;

  if (lemmaMap?.[lower]) z = tryLookup(lemmaMap[lower]);
  if (z > 0) return z;

  if (lang === "es") {
    const inf = guessInfinitiveEs(lower, zipfDict);
    if (inf) z = tryLookup(inf);
  }
  if (z <= 0 && lang === "de") {
    z = guessInfinitiveDe(lower, zipfDict);
  }
  return z;
}

export function zipfInRange(word, lo, hi, lang, zipfDict, lemmaMap, lemmaZipf = null) {
  const z = effectiveZipf(word, lang, zipfDict, lemmaMap, lemmaZipf);
  return z >= lo && z <= hi;
}

export function eligibleBlankIndices(
  tokens,
  lo,
  hi,
  lang,
  zipfDict,
  lemmaMap,
  {
    tags = null,
    posFilter = null,
    lemmaZipf = null,
    senseZipf = null,
    seenSenseKeys = null,
    requireTags = false,
  } = {}
) {
  const indices = [];
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok.length < 3 || !/^\p{L}+$/u.test(tok)) continue;
    const tag = tags?.[i];
    // When a tagged corpus is loaded, only blank tokens that have tags.
    if (requireTags && (!tag || !tag.lemma || !tag.pos)) continue;
    // Never blank proper nouns / names.
    if (tag?.pos === "PROP") continue;
    if (posFilter?.enabled) {
      if (!tag?.pos) continue;
      const allowed = posFilter.allowed;
      if (!allowed?.length || !allowed.includes(tag.pos)) continue;
    }
    if (tag?.lemma && seenSenseKeys) {
      const sk = senseDedupKey(tag.lemma, tag.sense);
      if (sk && seenSenseKeys.has(sk)) continue;
    }
    let z;
    if (tag?.lemma && senseZipf) {
      const sk = senseDedupKey(tag.lemma, tag.sense);
      z = senseZipf[sk] ?? lemmaZipf?.[normalizeForMatch(tag.lemma)] ?? 0;
    } else {
      z = effectiveZipf(tag?.lemma || tok, lang, zipfDict, lemmaMap, lemmaZipf);
    }
    if (!(z >= lo && z <= hi)) continue;
    if (answerAppearsElsewhere(tokens, i, tok)) continue;
    indices.push(i);
  }
  return indices;
}

export async function loadZipfDict(lang) {
  const res = await fetch(assetUrl(`zipf/${lang}.json`));
  if (!res.ok) throw new Error(`Missing zipf data for ${lang}. Run: cd node && node export_zipf.js ${lang}`);
  return await res.json();
}

/** Prefer live / IndexedDB stats — static corpus-stats files are optional legacy only. */
export async function loadCorpusStats(_lang, _corpus = "wiki") {
  return null;
}

export function corpusStatsId(lang, corpus) {
  return `${lang}:${corpus}`;
}

export function corpusFingerprint(lang, corpus, byteLength, sentenceCount) {
  return `${lang}|${corpus}|${byteLength}|${sentenceCount}|v${CORPUS_STATS_VERSION}`;
}

export function statsMatchFingerprint(stats, fingerprint, sentenceCount) {
  if (!stats) return false;
  if (stats.fingerprint && stats.fingerprint === fingerprint) return true;
  if (
    stats.totalSentences === sentenceCount &&
    Array.isArray(stats.avgZipfByLine) &&
    stats.avgZipfByLine.length === sentenceCount &&
    Array.isArray(stats.wordCountByLine) &&
    stats.wordCountByLine.length === sentenceCount
  ) {
    return true;
  }
  return false;
}

function buildHistogramFromValues(values, bins = 24) {
  if (!values.length) return [];
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  if (hi <= lo) return [{ lo: +lo.toFixed(2), hi: +hi.toFixed(2), count: values.length }];
  const width = (hi - lo) / bins;
  const counts = new Array(bins).fill(0);
  for (const v of values) {
    const idx = Math.min(bins - 1, Math.floor((v - lo) / width));
    counts[idx] += 1;
  }
  return counts.map((count, i) => ({
    lo: +(lo + i * width).toFixed(2),
    hi: +(lo + (i + 1) * width).toFixed(2),
    count,
  }));
}

function buildWordHistogram(wordCounts) {
  if (!wordCounts.length) return [];
  const lo = Math.min(...wordCounts);
  const hi = Math.max(...wordCounts);
  const hist = [];
  for (let w = lo; w <= hi; w++) {
    let count = 0;
    for (const c of wordCounts) if (c === w) count += 1;
    hist.push({ words: w, count });
  }
  return hist;
}

/** Compute per-sentence word counts + avg Zipf; annotates sentence entries in place. */
export function buildCorpusStatsFromSentences(
  sentences,
  lang,
  zipfDict,
  lemmaMap,
  corpus = "wiki",
  lemmaZipf = null,
  senseZipf = null
) {
  const avgZipfByLine = [];
  const wordCountByLine = [];
  const avgValues = [];
  const wordValues = [];

  for (const entry of sentences) {
    const text = sentenceText(entry);
    const positioned = tokenizeWithPositions(text);
    const wc = positioned.length;
    const avg = sentenceAverageZipf(
      text,
      lang,
      zipfDict,
      lemmaMap,
      lemmaZipf,
      entry.tags,
      senseZipf
    );
    const idx = sentenceLineIndex(entry);
    if (idx != null) {
      avgZipfByLine[idx] = avg;
      wordCountByLine[idx] = wc;
    }
    entry.wordCount = wc;
    entry.avgZipf = avg;
    if (wc > 0 && avg != null) {
      avgValues.push(avg);
      wordValues.push(wc);
    }
  }

  const total = wordValues.length;
  return {
    langCode: lang,
    corpus,
    statsVersion: CORPUS_STATS_VERSION,
    minAvgZipf: avgValues.length ? +Math.min(...avgValues).toFixed(2) : FILTER_AVG_ZIPF_MIN,
    maxAvgZipf: avgValues.length ? +Math.max(...avgValues).toFixed(2) : FILTER_AVG_ZIPF_MAX,
    minWords: wordValues.length ? Math.min(...wordValues) : FILTER_WORD_MIN,
    maxWords: wordValues.length ? Math.max(...wordValues) : FILTER_WORD_MAX,
    totalSentences: total,
    histogram: buildHistogramFromValues(avgValues),
    wordHistogram: buildWordHistogram(wordValues),
    avgZipfByLine,
    wordCountByLine,
    source: "computed",
  };
}

/** Attach cached/file stats onto sentence entries for consistent filtering. */
export function annotateSentencesFromStats(sentences, corpusStats) {
  if (!corpusStats?.wordCountByLine || !corpusStats?.avgZipfByLine) return;
  for (const entry of sentences) {
    const idx = sentenceLineIndex(entry);
    if (idx == null) continue;
    if (corpusStats.wordCountByLine[idx] != null) entry.wordCount = corpusStats.wordCountByLine[idx];
    if (corpusStats.avgZipfByLine[idx] != null) entry.avgZipf = corpusStats.avgZipfByLine[idx];
  }
}

/** Count sentences in corpus stats that match the active length + avg-Zipf filters. */
export function countMatchingSentences(corpusStats, filters) {
  if (!corpusStats) return 0;
  const avgs = corpusStats.avgZipfByLine;
  const words = corpusStats.wordCountByLine;
  const total = corpusStats.totalSentences ?? avgs?.length ?? 0;
  if (!filters?.enabled) return total;
  if (!words?.length && !avgs?.length) return 0;

  const n = Math.max(avgs?.length ?? 0, words?.length ?? 0);
  let matched = 0;
  for (let i = 0; i < n; i++) {
    const wc = words?.[i];
    const avg = avgs?.[i];
    if (wc == null && avg == null) continue;
    if (wc != null) {
      if (filters.minWords != null && wc < filters.minWords) continue;
      if (filters.maxWords != null && wc > filters.maxWords) continue;
    }
    if (avg != null) {
      if (filters.minAvgZipf != null && avg < filters.minAvgZipf) continue;
      if (filters.maxAvgZipf != null && avg > filters.maxAvgZipf) continue;
    }
    matched += 1;
  }
  return matched;
}

/** Bounds for filter sliders from corpus stats (falls back to defaults). */
export function corpusFilterBounds(corpusStats) {
  return {
    minWords: corpusStats?.minWords ?? FILTER_WORD_MIN,
    maxWords: corpusStats?.maxWords ?? FILTER_WORD_MAX,
    minAvgZipf: corpusStats?.minAvgZipf ?? FILTER_AVG_ZIPF_MIN,
    maxAvgZipf: corpusStats?.maxAvgZipf ?? FILTER_AVG_ZIPF_MAX,
  };
}

export function puzzleKey(puzzle) {
  if (puzzle.lineIndex != null) return `i:${puzzle.lineIndex}:${puzzle.blankIndex}`;
  return `s:${puzzle.sentence}:${puzzle.blankIndex}`;
}

/** Pre-index every valid blank for the current zipf range and sentence filters. */
export function indexZipfPuzzles(
  sentences,
  lo,
  hi,
  lang,
  zipfDict,
  lemmaMap,
  skippedSet,
  filters,
  corpusStats,
  {
    sessionBlankKeys = null,
    wordExposure = null,
    maxExposure = MAX_BLANK_WORD_EXPOSURE,
    blockedWordKeys = null,
    posFilter = null,
    lemmaZipf = null,
    senseZipf = null,
    seenSenseKeys = null,
    requireTags = false,
  } = {}
) {
  const puzzles = [];
  for (const entry of sentences) {
    if (isSkipped(entry, skippedSet)) continue;
    const sentence = sentenceText(entry);
    const lineIndex = sentenceLineIndex(entry);
    if (
      !sentencePassesFilters(sentence, filters, lang, zipfDict, lemmaMap, corpusStats, lineIndex, {
        wordCount: entry.wordCount,
        avgZipf: entry.avgZipf,
      })
    ) {
      continue;
    }
    const positioned = tokenizeWithPositions(sentence);
    if (positioned.length < MIN_PUZZLE_WORDS) continue;
    const texts = positioned.map((t) => t.text);
    const candidates = eligibleBlankIndices(texts, lo, hi, lang, zipfDict, lemmaMap, {
      tags: entry.tags,
      posFilter,
      lemmaZipf,
      senseZipf,
      seenSenseKeys,
      requireTags,
    });
    for (const blankIndex of candidates) {
      const answer = positioned[blankIndex].text;
      if (
        !blankWordAllowed(answer, lang, lemmaMap, {
          sessionBlankKeys,
          wordExposure,
          maxExposure,
          blockedWordKeys,
        })
      ) {
        continue;
      }
      const tag = entry.tags?.[blankIndex];
      puzzles.push({
        sentence,
        lineIndex,
        tokens: positioned,
        blankIndex,
        answer,
        lemma: tag?.lemma || null,
        pos: tag?.pos || null,
        sense: tag?.sense || null,
      });
    }
  }
  return puzzles;
}

function puzzleSenseAllowed(p, seenSenseKeys) {
  if (!seenSenseKeys || !p?.lemma) return true;
  const sk = senseDedupKey(p.lemma, p.sense);
  return !sk || !seenSenseKeys.has(sk);
}

export function pickFromPuzzlePool(pool, usedKeys, wordOpts = {}) {
  if (!pool?.length) return null;
  const {
    lang,
    lemmaMap,
    sessionBlankKeys,
    wordExposure,
    maxExposure = MAX_BLANK_WORD_EXPOSURE,
    blockedWordKeys = null,
    seenSenseKeys = null,
  } = wordOpts;
  const allowed = (p) => {
    if (!puzzleSenseAllowed(p, seenSenseKeys)) return false;
    if (lang && lemmaMap) {
      return blankWordAllowed(p.answer, lang, lemmaMap, {
        sessionBlankKeys,
        wordExposure,
        maxExposure,
        blockedWordKeys,
      });
    }
    return true;
  };
  let available = pool.filter((p) => !usedKeys.has(puzzleKey(p)) && allowed(p));
  if (!available.length) {
    usedKeys.clear();
    available = pool.filter(allowed);
  }
  if (!available.length) return null;
  const pick = available[Math.floor(Math.random() * available.length)];
  usedKeys.add(puzzleKey(pick));
  return pick;
}

export async function loadLemmaMap(lang) {
  try {
    const res = await fetch(assetUrl(`lemmas/${lang}.json`));
    if (!res.ok) return {};
    return await res.json();
  } catch {
    return {};
  }
}

export async function streamSentences(url, maxStore = Infinity, onProgress) {
  if (!Number.isFinite(maxStore)) {
    return streamAllSentences(url, onProgress);
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load sentences (${res.status})`);
  const total = Number(res.headers.get("Content-Length")) || 0;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const lines = [];
  let totalLines = 0;
  let fileLineIndex = -1;
  let bytesRead = 0;
  let lang = null;

  function processLine(raw) {
    const trimmed = raw.trim();
    if (!lang && trimmed.startsWith("#")) {
      const m = trimmed.match(/^# lang=([a-z]{2})/);
      if (m) lang = m[1];
      return;
    }
    const line = sentenceOnly(trimmed);
    if (!line) return;
    fileLineIndex += 1;
    totalLines += 1;
    const entry = { text: line, lineIndex: fileLineIndex };
    if (lines.length < maxStore) lines.push(entry);
    else {
      const j = Math.floor(Math.random() * totalLines);
      if (j < maxStore) lines[j] = entry;
    }
  }

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      if (buffer.trim()) processLine(buffer);
      break;
    }
    bytesRead += value.byteLength;
    if (onProgress) {
      const ratio = total > 0 ? Math.min(1, bytesRead / total) : 0.5;
      const pct = Math.min(99, 10 + ratio * 85);
      onProgress(pct, total > 0 ? `Loading… ${Math.round(ratio * 100)}%` : `Loading…`);
    }
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf("\n")) >= 0) {
      processLine(buffer.slice(0, idx));
      buffer = buffer.slice(idx + 1);
    }
  }
  return { lines, lang, byteLength: total || bytesRead };
}

/** Load every sentence from the data file (no reservoir sampling). */
export async function streamAllSentences(url, onProgress) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load sentences (${res.status})`);
  const total = Number(res.headers.get("Content-Length")) || 0;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const lines = [];
  let fileLineIndex = -1;
  let bytesRead = 0;
  let lang = null;

  function processLine(raw) {
    const trimmed = raw.trim();
    if (!lang && trimmed.startsWith("#")) {
      const m = trimmed.match(/^# lang=([a-z]{2})/);
      if (m) lang = m[1];
      return;
    }
    const line = sentenceOnly(trimmed);
    if (!line) return;
    fileLineIndex += 1;
    lines.push({ text: line, lineIndex: fileLineIndex });
  }

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      if (buffer.trim()) processLine(buffer);
      break;
    }
    bytesRead += value.byteLength;
    if (onProgress) {
      const ratio = total > 0 ? Math.min(1, bytesRead / total) : 0.5;
      const pct = Math.min(99, 10 + ratio * 85);
      onProgress(pct, total > 0 ? `Scanning sentences… ${Math.round(ratio * 100)}%` : "Scanning sentences…");
    }
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf("\n")) >= 0) {
      processLine(buffer.slice(0, idx));
      buffer = buffer.slice(idx + 1);
    }
  }
  return { lines, lang, byteLength: total || bytesRead };
}

/** Collect up to `limit` sentences whose tokens match `word` (accent-aware). */
export function sentencesContainingWord(sentences, word, limit = 40) {
  const needle = normalizeForMatch(word);
  if (!needle) return [];
  const out = [];
  for (const entry of sentences) {
    const text = sentenceText(entry);
    if (!text) continue;
    const hit = tokenizeWithPositions(text).some((t) => normalizeForMatch(t.text) === needle);
    if (!hit) continue;
    out.push(typeof entry === "string" ? { text, lineIndex: null } : { text, lineIndex: entry.lineIndex ?? null });
    if (out.length >= limit) break;
  }
  return out;
}

/** Stream a corpus file and return example sentences containing `word`. */
export async function findSentencesContainingWord(url, word, { limit = 40, onProgress } = {}) {
  const needle = normalizeForMatch(word);
  if (!needle) return [];
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load sentences (${res.status})`);
  const total = Number(res.headers.get("Content-Length")) || 0;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const matches = [];
  let fileLineIndex = -1;
  let bytesRead = 0;

  function processLine(raw) {
    if (matches.length >= limit) return;
    const trimmed = raw.trim();
    if (trimmed.startsWith("#")) return;
    const line = sentenceOnly(trimmed);
    if (!line) return;
    fileLineIndex += 1;
    const hit = tokenizeWithPositions(line).some((t) => normalizeForMatch(t.text) === needle);
    if (hit) matches.push({ text: line, lineIndex: fileLineIndex });
  }

  while (matches.length < limit) {
    const { done, value } = await reader.read();
    if (done) {
      if (buffer.trim()) processLine(buffer);
      break;
    }
    bytesRead += value.byteLength;
    if (onProgress) {
      const ratio = total > 0 ? Math.min(1, bytesRead / total) : 0.5;
      onProgress(Math.min(99, Math.round(ratio * 100)), `Searching… ${matches.length} found`);
    }
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf("\n")) >= 0) {
      processLine(buffer.slice(0, idx));
      buffer = buffer.slice(idx + 1);
      if (matches.length >= limit) break;
    }
  }
  try { reader.cancel(); } catch { /* ignore */ }
  return matches;
}

function isSkipped(entry, skippedSet) {
  if (!skippedSet) return false;
  const text = sentenceText(entry);
  const idx = sentenceLineIndex(entry);
  if (idx != null && skippedSet.indices?.has(idx)) return true;
  if (text && skippedSet.sentences?.has(text.trim().normalize("NFC"))) return true;
  return false;
}

export function buildPuzzle(
  sentences,
  lo,
  hi,
  lang,
  zipfDict,
  lemmaMap,
  maxTries = 120,
  skippedSet = null,
  filters = null,
  corpusStats = null,
  pool = null,
  usedKeys = null,
  wordOpts = null
) {
  if (pool) {
    return pickFromPuzzlePool(pool, usedKeys ?? new Set(), wordOpts ?? {});
  }
  for (let i = 0; i < maxTries; i++) {
    const entry = sentences[Math.floor(Math.random() * sentences.length)];
    if (isSkipped(entry, skippedSet)) continue;
    const sentence = sentenceText(entry);
    const lineIndex = sentenceLineIndex(entry);
    if (
      !sentencePassesFilters(sentence, filters, lang, zipfDict, lemmaMap, corpusStats, lineIndex, {
        wordCount: entry.wordCount,
        avgZipf: entry.avgZipf,
      })
    ) {
      continue;
    }
    const positioned = tokenizeWithPositions(sentence);
    if (positioned.length < MIN_PUZZLE_WORDS) continue;
    const texts = positioned.map((t) => t.text);
    const candidates = eligibleBlankIndices(texts, lo, hi, lang, zipfDict, lemmaMap, {
      tags: entry.tags,
      posFilter: wordOpts?.posFilter ?? null,
      lemmaZipf: wordOpts?.lemmaZipf ?? null,
      senseZipf: wordOpts?.senseZipf ?? null,
      seenSenseKeys: wordOpts?.seenSenseKeys ?? null,
      requireTags: wordOpts?.requireTags ?? false,
    });
    const allowed = candidates.filter((i) =>
      blankWordAllowed(positioned[i].text, lang, lemmaMap, wordOpts ?? {})
    );
    if (allowed.length === 0) continue;
    const blankIndex = allowed[Math.floor(Math.random() * allowed.length)];
    const tag = entry.tags?.[blankIndex];
    return {
      sentence,
      lineIndex,
      tokens: positioned,
      blankIndex,
      answer: positioned[blankIndex].text,
      lemma: tag?.lemma || null,
      pos: tag?.pos || null,
      sense: tag?.sense || null,
    };
  }
  return null;
}

/** Count sentences that contain any of `words` (and optionally pass length/avg-Zipf filters). */
export function countSentencesContainingWords(
  sentences,
  words,
  {
    filters = null,
    lang = null,
    zipfDict = null,
    lemmaMap = null,
    corpusStats = null,
    skippedSet = null,
  } = {}
) {
  const targets = new Set(
    (words || []).map((w) => String(w || "").toLowerCase().normalize("NFC")).filter(Boolean)
  );
  if (!targets.size || !sentences?.length) return { matched: 0, withWords: 0 };

  let withWords = 0;
  let matched = 0;
  for (const entry of sentences) {
    if (isSkipped(entry, skippedSet)) continue;
    const sentence = sentenceText(entry);
    if (!sentence) continue;
    const positioned = tokenizeWithPositions(sentence);
    if (!positioned.some((t) => targets.has(t.text.toLowerCase().normalize("NFC")))) continue;
    withWords += 1;
    const lineIndex = sentenceLineIndex(entry);
    if (
      filters?.enabled &&
      !sentencePassesFilters(sentence, filters, lang, zipfDict, lemmaMap, corpusStats, lineIndex, {
        wordCount: entry.wordCount,
        avgZipf: entry.avgZipf,
      })
    ) {
      continue;
    }
    matched += 1;
  }
  return { matched, withWords };
}

/** Scan all sentences and collect every puzzle that blanks a flashcard word. */
export function indexFlashcardPuzzles(
  sentences,
  words,
  skippedSet = null,
  filters = null,
  lang = null,
  zipfDict = null,
  lemmaMap = null,
  corpusStats = null,
  { wordExposure = null, maxExposure = MAX_BLANK_WORD_EXPOSURE } = {}
) {
  const targets = new Set(words.map((w) => w.toLowerCase()));
  const puzzles = [];
  if (!targets.size) return puzzles;

  for (const entry of sentences) {
    if (isSkipped(entry, skippedSet)) continue;
    const sentence = sentenceText(entry);
    const lineIndex = sentenceLineIndex(entry);
    if (
      filters?.enabled &&
      !sentencePassesFilters(sentence, filters, lang, zipfDict, lemmaMap, corpusStats, lineIndex, {
        wordCount: entry.wordCount,
        avgZipf: entry.avgZipf,
      })
    ) {
      continue;
    }
    const positioned = tokenizeWithPositions(sentence);
    if (positioned.length < MIN_PUZZLE_WORDS) continue;
    for (let j = 0; j < positioned.length; j++) {
      const tok = positioned[j].text;
      const key = tok.toLowerCase();
      if (tok.length < 2 || !targets.has(key)) continue;
      if (
        lang &&
        lemmaMap &&
        !blankWordAllowed(tok, lang, lemmaMap, { wordExposure, maxExposure })
      ) {
        continue;
      }
      const texts = positioned.map((t) => t.text);
      if (answerAppearsElsewhere(texts, j, tok)) continue;
      puzzles.push({
        sentence,
        lineIndex: sentenceLineIndex(entry),
        tokens: positioned,
        blankIndex: j,
        answer: tok,
        targetWord: key,
      });
    }
  }
  return puzzles;
}

export function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Pick next flashcard puzzle — random pool or shuffled word cycle (each word once per round). */
export function pickFlashcardPuzzle(
  pool,
  { sequential, wordOrder, cycleIndex, lang, lemmaMap, sessionBlankKeys, wordExposure, maxExposure }
) {
  if (!pool?.length) {
    return { puzzle: null, nextCycleIndex: cycleIndex ?? 0, nextWordOrder: wordOrder };
  }

  const wordOk = (p) =>
    !lang ||
    !lemmaMap ||
    blankWordAllowed(p.answer, lang, lemmaMap, { sessionBlankKeys, wordExposure, maxExposure });

  if (!sequential || !wordOrder?.length) {
    const eligible = pool.filter(wordOk);
    if (!eligible.length) {
      return { puzzle: null, nextCycleIndex: cycleIndex ?? 0, nextWordOrder: wordOrder };
    }
    return {
      puzzle: eligible[Math.floor(Math.random() * eligible.length)],
      nextCycleIndex: cycleIndex ?? 0,
      nextWordOrder: wordOrder,
    };
  }

  let order = wordOrder;
  let idx = cycleIndex ?? 0;
  if (idx >= order.length) {
    order = shuffleArray(order);
    idx = 0;
  }

  for (let attempt = 0; attempt < order.length; attempt++) {
    const wordIdx = (idx + attempt) % order.length;
    const targetWord = order[wordIdx].toLowerCase();
    const matching = pool.filter((p) => p.targetWord === targetWord && wordOk(p));
    if (matching.length) {
      const nextIdx = wordIdx + 1;
      const nextOrder = nextIdx >= order.length ? shuffleArray(order) : order;
      return {
        puzzle: matching[Math.floor(Math.random() * matching.length)],
        nextCycleIndex: nextIdx >= order.length ? 0 : nextIdx,
        nextWordOrder: nextOrder,
      };
    }
  }
  return { puzzle: null, nextCycleIndex: idx, nextWordOrder: order };
}

export async function translateText(text, fromLang, toLang, cache) {
  const key = `${fromLang}:${toLang}:${text}`;
  if (cache[key]) return cache[key];
  const res = await fetch(
    `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${fromLang}&tl=${toLang}&dt=t&q=${encodeURIComponent(text)}`
  );
  if (!res.ok) throw new Error("translation failed");
  const data = await res.json();
  // Google returns one segment per sentence/clause — join all so multi-part lines translate fully.
  const segments = Array.isArray(data?.[0]) ? data[0] : [];
  const result = segments.map((seg) => (Array.isArray(seg) ? seg[0] : "")).filter(Boolean).join("") || "";
  cache[key] = result;
  return result;
}

export function translateSentence(text, fromLang, toLang, cache) {
  return translateText(text, fromLang, toLang, cache);
}
