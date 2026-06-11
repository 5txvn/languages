/** Static frontend game logic — no backend required. */

export const WORD_PATTERN = /\b[\wáéíóúüñÁÉÍÓÚÜÑàèéìòùäöüßąćęłńóśźżА-яЁё'-]+\b/gu;
export const ZIPF_MIN = 3.0;
export const ZIPF_MAX = 8.0;
export const TARGET_COUNT = 20000;

/** Zipf ranges — descriptions are language-neutral. */
export const DIFFICULTY_PRESETS = [
  { name: "Beginner", lo: 6.0, hi: 8.0, desc: "The most common words: articles, pronouns, basic verbs" },
  { name: "Easy", lo: 5.5, hi: 6.0, desc: "Everyday vocabulary you hear in normal conversation" },
  { name: "Medium", lo: 5.0, hi: 5.5, desc: "Less frequent words: news, opinions, descriptions" },
  { name: "Challenging", lo: 4.5, hi: 5.0, desc: "Uncommon words that still appear in real writing" },
  { name: "Hard", lo: 4.0, hi: 4.5, desc: "Specialized or literary vocabulary" },
  { name: "Expert", lo: 3.0, hi: 4.0, desc: "Rare words. Still fair game, but tough" },
];

export function assetUrl(relative) {
  return new URL(relative, window.location.href).href;
}

/** Legacy sentence filenames before {code}_sentences.txt rename. */
export const LEGACY_SENTENCE_FILES = {
  es: "spanish.txt",
  pt: "portuguese.txt",
  de: "german.txt",
  fr: "french.txt",
  it: "italian.txt",
  en: "english.txt",
  nl: "dutch.txt",
  pl: "polish.txt",
  ru: "russian.txt",
};

export function sentenceFilename(langCode) {
  return `${langCode}_sentences.txt`;
}

/** Resolve data file — works from repo root or GitHub Pages /app/ */
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

export const FILTER_WORD_MIN = 5;
export const FILTER_WORD_MAX = 15;
export const FILTER_AVG_ZIPF_MIN = 4.9;
export const FILTER_AVG_ZIPF_MAX = 6.5;

export const DEFAULT_SENTENCE_FILTERS = {
  enabled: false,
  minWords: 5,
  maxWords: 15,
  minAvgZipf: 4.9,
  maxAvgZipf: 6.5,
};

/** Pessimistic Zipf for tokens missing from the static dictionary (pulls avg down). */
export const ZIPF_UNKNOWN_ESTIMATE = 3.0;

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

export function sentenceAverageZipf(sentence, lang, zipfDict, lemmaMap) {
  const tokens = tokenizeWithPositions(sentence).filter((t) => isSentenceContentToken(t.text));
  if (!tokens.length) return null;
  const zipfs = tokens.map((t) => estimateTokenZipf(t.text, lang, zipfDict, lemmaMap));
  return zipfs.reduce((a, b) => a + b, 0) / zipfs.length;
}

/** Optional filters so surrounding sentence complexity matches the blank word level. */
export function sentencePassesFilters(sentence, filters, lang, zipfDict, lemmaMap) {
  if (!filters?.enabled) return true;
  const positioned = tokenizeWithPositions(sentence);
  const wc = positioned.length;
  if (filters.minWords != null && wc < filters.minWords) return false;
  if (filters.maxWords != null && wc > filters.maxWords) return false;
  if (filters.minAvgZipf != null || filters.maxAvgZipf != null) {
    const avg = sentenceAverageZipf(sentence, lang, zipfDict, lemmaMap);
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

export function effectiveZipf(word, lang, zipfDict, lemmaMap) {
  const lower = word.toLowerCase();
  const tryLookup = (w) => zipfDict[w] ?? 0;

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

export function zipfInRange(word, lo, hi, lang, zipfDict, lemmaMap) {
  const z = effectiveZipf(word, lang, zipfDict, lemmaMap);
  return z >= lo && z < hi;
}

export function eligibleBlankIndices(tokens, lo, hi, lang, zipfDict, lemmaMap) {
  const indices = [];
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok.length < 3 || !/^\p{L}+$/u.test(tok)) continue;
    if (zipfInRange(tok, lo, hi, lang, zipfDict, lemmaMap)) indices.push(i);
  }
  return indices;
}

export async function loadZipfDict(lang) {
  const res = await fetch(assetUrl(`zipf/${lang}.json`));
  if (!res.ok) throw new Error(`Missing zipf data for ${lang}. Run: cd node && node export_zipf.js ${lang}`);
  return await res.json();
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

export async function streamSentences(url, maxStore, onProgress) {
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
      const pct = total > 0 ? 20 + (bytesRead / total) * 75 : 50;
      onProgress(pct, total > 0 ? `Loading… ${Math.round((bytesRead / total) * 100)}%` : `Loading…`);
    }
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf("\n")) >= 0) {
      processLine(buffer.slice(0, idx));
      buffer = buffer.slice(idx + 1);
    }
  }
  return { lines, lang };
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
      const pct = total > 0 ? 5 + (bytesRead / total) * 90 : 50;
      onProgress(pct, total > 0 ? `Scanning sentences… ${Math.round((bytesRead / total) * 100)}%` : "Scanning sentences…");
    }
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf("\n")) >= 0) {
      processLine(buffer.slice(0, idx));
      buffer = buffer.slice(idx + 1);
    }
  }
  return { lines, lang };
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
  filters = null
) {
  for (let i = 0; i < maxTries; i++) {
    const entry = sentences[Math.floor(Math.random() * sentences.length)];
    if (isSkipped(entry, skippedSet)) continue;
    const sentence = sentenceText(entry);
    if (!sentencePassesFilters(sentence, filters, lang, zipfDict, lemmaMap)) continue;
    const positioned = tokenizeWithPositions(sentence);
    if (positioned.length < 5) continue;
    const texts = positioned.map((t) => t.text);
    const candidates = eligibleBlankIndices(texts, lo, hi, lang, zipfDict, lemmaMap);
    if (candidates.length === 0) continue;
    const blankIndex = candidates[Math.floor(Math.random() * candidates.length)];
    return {
      sentence,
      lineIndex: sentenceLineIndex(entry),
      tokens: positioned,
      blankIndex,
      answer: positioned[blankIndex].text,
    };
  }
  return null;
}

/** Scan all sentences and collect every puzzle that blanks a flashcard word. */
export function indexFlashcardPuzzles(sentences, words, skippedSet = null) {
  const targets = new Set(words.map((w) => w.toLowerCase()));
  const puzzles = [];
  if (!targets.size) return puzzles;

  for (const entry of sentences) {
    if (isSkipped(entry, skippedSet)) continue;
    const sentence = sentenceText(entry);
    const positioned = tokenizeWithPositions(sentence);
    if (positioned.length < 4) continue;
    for (let j = 0; j < positioned.length; j++) {
      const tok = positioned[j].text;
      const key = tok.toLowerCase();
      if (tok.length < 2 || !targets.has(key)) continue;
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
export function pickFlashcardPuzzle(pool, { sequential, wordOrder, cycleIndex }) {
  if (!pool?.length) {
    return { puzzle: null, nextCycleIndex: cycleIndex ?? 0, nextWordOrder: wordOrder };
  }

  if (!sequential || !wordOrder?.length) {
    return {
      puzzle: pool[Math.floor(Math.random() * pool.length)],
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
    const matching = pool.filter((p) => p.targetWord === targetWord);
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
  const result = data[0][0][0];
  cache[key] = result;
  return result;
}

export function translateSentence(text, fromLang, toLang, cache) {
  return translateText(text, fromLang, toLang, cache);
}
