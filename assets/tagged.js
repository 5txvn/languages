/** Tagged corpus parsing — lemma*POS[*sense] lines aligned with plain sentences. */

import {
  resolveDataUrl,
  normalizeForMatch,
  tokenizeWithPositions,
  senseDedupKey,
  sentenceFilename,
  legacyFallbacks,
  sentenceOnly,
} from "./game.js";

export { senseDedupKey };

/** Compact POS codes used in tagged corpora (see movie-corpus tagger). */
export const POS_CODES = new Set([
  "N", "PROP", "V", "ADJ", "ADV", "ADP", "DET", "PRON", "NUM", "CONJ", "PART", "INTJ", "PUNCT", "SYM", "X",
]);

export const POS_OPTIONS = [
  { id: "N", label: "Nouns" },
  { id: "PROP", label: "Proper nouns" },
  { id: "V", label: "Verbs" },
  { id: "ADJ", label: "Adjectives" },
  { id: "ADV", label: "Adverbs" },
  { id: "PRON", label: "Pronouns" },
  { id: "DET", label: "Determiners" },
  { id: "ADP", label: "Prepositions" },
  { id: "NUM", label: "Numbers" },
  { id: "CONJ", label: "Conjunctions" },
  { id: "PART", label: "Particles" },
  { id: "INTJ", label: "Interjections" },
];

export const DEFAULT_POS_FILTER = {
  enabled: false,
  /** Empty = all POS allowed when advanced POS filter is on. */
  allowed: POS_OPTIONS.filter((p) => p.id !== "PROP").map((p) => p.id),
};

export function taggedFilename(langCode, corpus = "wiki") {
  return `${langCode}_${corpus}_tagged.txt`;
}

/**
 * Parse one tagged token.
 * New format: surface*lemma*POS[*sense]
 * Legacy: lemma*POS[*sense]
 */
export function parseTaggedToken(raw) {
  const tok = (raw ?? "").trim();
  if (!tok) return null;
  if (!tok.includes("*")) {
    return { surface: tok, lemma: tok, pos: "PUNCT", sense: null };
  }
  const parts = tok.split("*");
  if (parts.length >= 4) {
    return {
      surface: (parts[0] || "").normalize("NFC"),
      lemma: (parts[1] || "").normalize("NFC"),
      pos: (parts[2] || "X").toUpperCase(),
      sense: parts[3] || null,
    };
  }
  if (parts.length === 3) {
    const a = parts[0];
    const b = parts[1];
    const c = parts[2];
    if (POS_CODES.has((b || "").toUpperCase())) {
      // lemma*POS*sense
      return {
        surface: (a || "").normalize("NFC"),
        lemma: (a || "").normalize("NFC"),
        pos: b.toUpperCase(),
        sense: c || null,
      };
    }
    // surface*lemma*POS
    return {
      surface: (a || "").normalize("NFC"),
      lemma: (b || "").normalize("NFC"),
      pos: (c || "X").toUpperCase(),
      sense: null,
    };
  }
  if (parts.length === 2) {
    return {
      surface: (parts[0] || "").normalize("NFC"),
      lemma: (parts[0] || "").normalize("NFC"),
      pos: (parts[1] || "X").toUpperCase(),
      sense: null,
    };
  }
  return {
    surface: (parts[0] || "").normalize("NFC"),
    lemma: (parts[0] || "").normalize("NFC"),
    pos: "X",
    sense: null,
  };
}

/** Content tags only (skip punctuation / symbols). */
export function parseTaggedLine(line) {
  const trimmed = (line ?? "").trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  const tags = [];
  for (const raw of trimmed.split(/\s+/)) {
    const t = parseTaggedToken(raw);
    if (!t) continue;
    if (t.pos === "PUNCT" || t.pos === "SYM" || t.pos === "X") continue;
    tags.push(t);
  }
  return tags.length ? tags : null;
}

/**
 * Align tagged tokens with surface tokens — prefer surface/lemma match over index.
 */
export function alignTagsToTokens(surfaceTokens, tags) {
  if (!tags?.length || !surfaceTokens?.length) return null;
  const unused = tags.map((_, i) => i);
  return surfaceTokens.map((text) => {
    const norm = normalizeForMatch(text);
    let found = -1;
    for (let u = 0; u < unused.length; u++) {
      const t = tags[unused[u]];
      const surf = normalizeForMatch(t.surface || "");
      const lem = normalizeForMatch(t.lemma || "");
      if (surf === norm || lem === norm) {
        found = u;
        break;
      }
    }
    if (found < 0 && unused.length) {
      // fall back to next unused by order when lengths roughly match
      if (tags.length === surfaceTokens.length) found = 0;
    }
    if (found < 0) {
      return { text, surface: text, lemma: text, pos: null, sense: null };
    }
    const ti = unused.splice(found, 1)[0];
    const t = tags[ti];
    return {
      text,
      surface: t.surface || text,
      lemma: t.lemma || text,
      pos: t.pos,
      sense: t.sense,
    };
  });
}

/** Zipf-like score from raw counts (corpus-relative log10 per-billion). */
export function zipfFromCounts(counts) {
  const values = Object.values(counts);
  const total = values.reduce((a, b) => a + b, 0);
  if (!total) return {};
  const out = {};
  for (const [key, count] of Object.entries(counts)) {
    const perBillion = (count / total) * 1e9;
    out[key] = +Math.max(1, Math.log10(perBillion)).toFixed(3);
  }
  return out;
}

/** @deprecated Use zipfFromCounts — kept for callers expecting lemma-only maps. */
export function lemmaZipfFromCounts(counts) {
  return zipfFromCounts(counts);
}

/** Zipf for a tagged token: lemma+sense share one score across conjugations. */
export function senseZipfForTag(tag, senseZipf, lemmaZipf = null) {
  if (!tag?.lemma) return 0;
  const sk = senseDedupKey(tag.lemma, tag.sense);
  if (senseZipf && senseZipf[sk] != null) return senseZipf[sk];
  const lem = normalizeForMatch(tag.lemma);
  if (lemmaZipf && lemmaZipf[lem] != null) return lemmaZipf[lem];
  return 0;
}

/**
 * Stream tagged + plain corpus; return example sentences whose tags include `lemma`.
 * Paginated via offset/limit. Falls back to null if tagged file missing.
 */
export async function findSentencesContainingLemma(
  langCode,
  corpus,
  lemma,
  { offset = 0, limit = 10, onProgress } = {}
) {
  const needle = normalizeForMatch(lemma);
  if (!needle) return { matches: [], nextOffset: offset, hasMore: false };

  const taggedFile = taggedFilename(langCode, corpus);
  const taggedUrl = await resolveDataUrl(taggedFile, { required: false });
  if (!taggedUrl) return null;

  const plainFile = sentenceFilename(langCode, corpus);
  const plainUrl = await resolveDataUrl(plainFile, {
    required: false,
    fallbacks: legacyFallbacks(langCode, corpus),
  });
  if (!plainUrl) return null;

  // Pass 1: collect matching line indices (need offset + limit + 1 for hasMore).
  const need = offset + limit + 1;
  const matchIndices = [];
  {
    const res = await fetch(taggedUrl);
    if (!res.ok) return null;
    const total = Number(res.headers.get("Content-Length")) || 0;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let bytesRead = 0;
    let fileLineIndex = -1;

    function processLine(raw) {
      if (matchIndices.length >= need) return;
      const trimmed = raw.trim();
      if (!trimmed || trimmed.startsWith("#")) return;
      fileLineIndex += 1;
      const tags = parseTaggedLine(trimmed);
      if (!tags?.some((t) => normalizeForMatch(t.lemma) === needle)) return;
      matchIndices.push(fileLineIndex);
    }

    while (matchIndices.length < need) {
      const { done, value } = await reader.read();
      if (done) {
        if (buffer.trim()) processLine(buffer);
        break;
      }
      bytesRead += value.byteLength;
      if (onProgress && total > 0) {
        onProgress(Math.min(90, Math.round((bytesRead / total) * 50)), "Searching tagged corpus…");
      }
      buffer += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buffer.indexOf("\n")) >= 0) {
        processLine(buffer.slice(0, idx));
        buffer = buffer.slice(idx + 1);
        if (matchIndices.length >= need) break;
      }
    }
    try {
      reader.cancel();
    } catch {
      /* ignore */
    }
  }

  const slice = matchIndices.slice(offset, offset + limit);
  const hasMore = matchIndices.length > offset + limit;
  if (!slice.length) return { matches: [], nextOffset: offset, hasMore: false };

  const want = new Set(slice);
  const byIndex = new Map();
  {
    const res = await fetch(plainUrl);
    if (!res.ok) throw new Error(`Could not load sentences (${res.status})`);
    const total = Number(res.headers.get("Content-Length")) || 0;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let bytesRead = 0;
    let fileLineIndex = -1;

    function processLine(raw) {
      const trimmed = raw.trim();
      if (trimmed.startsWith("#")) return;
      const line = sentenceOnly(trimmed);
      if (!line) return;
      fileLineIndex += 1;
      if (want.has(fileLineIndex)) {
        byIndex.set(fileLineIndex, { text: line, lineIndex: fileLineIndex });
      }
    }

    while (byIndex.size < slice.length) {
      const { done, value } = await reader.read();
      if (done) {
        if (buffer.trim()) processLine(buffer);
        break;
      }
      bytesRead += value.byteLength;
      if (onProgress && total > 0) {
        onProgress(50 + Math.min(49, Math.round((bytesRead / total) * 49)), "Loading examples…");
      }
      buffer += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buffer.indexOf("\n")) >= 0) {
        processLine(buffer.slice(0, idx));
        buffer = buffer.slice(idx + 1);
        if (byIndex.size >= slice.length) break;
      }
    }
    try {
      reader.cancel();
    } catch {
      /* ignore */
    }
  }

  const matches = slice.map((i) => byIndex.get(i)).filter(Boolean);
  return { matches, nextOffset: offset + matches.length, hasMore };
}

export async function taggedCorpusAvailable(langCode, corpus) {
  const file = taggedFilename(langCode, corpus);
  const url = await resolveDataUrl(file, { required: false });
  return Boolean(url);
}

export function sensesFilename(langCode) {
  return `${langCode}_senses.json`;
}

/** Load `{lang}_senses.json` — map of lemma → { monosemous, senses: [{id,gloss}] }. */
export async function loadSensesInventory(langCode) {
  const file = sensesFilename(langCode);
  const url = await resolveDataUrl(file, { required: false });
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Stream tagged file; return byLine tags + lemma/sense frequency Zipf maps.
 * Zipf is computed on the client from tagged lemma+sense counts (not static zipf/*.json).
 */
export async function loadTaggedCorpus(langCode, corpus, { onProgress } = {}) {
  const file = taggedFilename(langCode, corpus);
  const url = await resolveDataUrl(file, { required: false });
  if (!url) return null;

  const res = await fetch(url);
  if (!res.ok) return null;
  const total = Number(res.headers.get("Content-Length")) || 0;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let bytesRead = 0;
  let fileLineIndex = -1;
  const byLine = [];
  const lemmaCounts = Object.create(null);
  const senseCounts = Object.create(null);
  /** surface form → lemma (first seen) for lookup resolution */
  const surfaceToLemma = Object.create(null);
  /** senseKey → { lemma, sense, pos } */
  const senseMeta = Object.create(null);

  function processLine(raw) {
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    fileLineIndex += 1;
    const tags = parseTaggedLine(trimmed);
    byLine[fileLineIndex] = tags;
    if (!tags) return;
    for (const t of tags) {
      const lem = normalizeForMatch(t.lemma);
      if (!lem) continue;
      lemmaCounts[lem] = (lemmaCounts[lem] ?? 0) + 1;
      const sk = senseDedupKey(t.lemma, t.sense);
      if (sk) {
        senseCounts[sk] = (senseCounts[sk] ?? 0) + 1;
        const prev = senseMeta[sk];
        if (!prev) {
          senseMeta[sk] = { lemma: lem, sense: (t.sense || "s0").toLowerCase(), pos: t.pos || null };
        } else if (prev.pos === "PROP" && t.pos && t.pos !== "PROP") {
          prev.pos = t.pos;
        }
      }
      const surf = normalizeForMatch(t.surface || "");
      if (surf && !surfaceToLemma[surf]) surfaceToLemma[surf] = lem;
    }
  }

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      if (buffer.trim()) processLine(buffer);
      break;
    }
    bytesRead += value.byteLength;
    if (onProgress && total > 0) {
      onProgress(Math.min(95, Math.round((bytesRead / total) * 100)), "Loading tagged corpus…");
    }
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf("\n")) >= 0) {
      processLine(buffer.slice(0, idx));
      buffer = buffer.slice(idx + 1);
    }
  }

  return {
    source: file,
    lineCount: fileLineIndex + 1,
    byLine,
    lemmaCounts,
    senseCounts,
    lemmaZipf: zipfFromCounts(lemmaCounts),
    senseZipf: zipfFromCounts(senseCounts),
    senseMeta,
    surfaceToLemma,
  };
}

/** Resolve a typed word to its lemma using tagged surface map / senses inventory. */
export function resolveLemma(word, tagged, sensesInventory = null, lemmaMap = null) {
  const needle = normalizeForMatch(word);
  if (!needle) return "";
  if (sensesInventory?.[needle]) return needle;
  if (tagged?.surfaceToLemma?.[needle]) return tagged.surfaceToLemma[needle];
  if (lemmaMap?.[needle]) return normalizeForMatch(lemmaMap[needle]);
  // Scan tagged lines for a surface match (slower fallback).
  if (tagged?.byLine) {
    for (const tags of tagged.byLine) {
      if (!tags) continue;
      for (const t of tags) {
        if (normalizeForMatch(t.surface) === needle && t.lemma) {
          return normalizeForMatch(t.lemma);
        }
      }
    }
  }
  return needle;
}

/**
 * Collect example sentences whose tags include `lemma` (any conjugation / surface).
 * Supports pagination via offset/limit.
 */
export function sentencesContainingLemma(sentences, lemma, { offset = 0, limit = 10 } = {}) {
  const needle = normalizeForMatch(lemma);
  if (!needle) return { matches: [], nextOffset: offset, hasMore: false };
  const matches = [];
  let found = 0;
  for (const entry of sentences ?? []) {
    if (!entry.tags?.some((t) => normalizeForMatch(t.lemma) === needle)) continue;
    if (found < offset) {
      found += 1;
      continue;
    }
    matches.push(entry);
    found += 1;
    if (matches.length >= limit) break;
  }
  let hasMore = false;
  if (matches.length >= limit) {
    let count = 0;
    for (const entry of sentences ?? []) {
      if (!entry.tags?.some((t) => normalizeForMatch(t.lemma) === needle)) continue;
      count += 1;
      if (count > offset + matches.length) {
        hasMore = true;
        break;
      }
    }
  }
  return { matches, nextOffset: offset + matches.length, hasMore };
}

/** Attach aligned tag info onto loaded plain sentence entries (in place). */
export function annotateSentencesWithTags(sentences, tagged) {
  if (!tagged?.byLine || !sentences?.length) return false;
  let matched = 0;
  for (const entry of sentences) {
    const idx = entry.lineIndex;
    const tags = idx != null ? tagged.byLine[idx] : null;
    if (!tags) {
      entry.tags = null;
      continue;
    }
    const positioned = tokenizeWithPositions(entry.text ?? "");
    const aligned = alignTagsToTokens(
      positioned.map((t) => t.text),
      tags
    );
    entry.tags = aligned;
    if (aligned) matched += 1;
  }
  return matched > 0;
}

export function posAllowed(pos, posFilter) {
  if (!posFilter?.enabled) return true;
  if (!pos) return false;
  const allowed = posFilter.allowed;
  if (!allowed?.length) return false;
  return allowed.includes(pos);
}
