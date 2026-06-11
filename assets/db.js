/** IndexedDB — settings, languages, stats, skipped sentences, flashcard sets. */

import { LEARNED_THRESHOLD, nextReviewAfterCorrect, nextReviewAfterWrong } from "./srs.js";

const DB_NAME = "lang-practice";
const DB_VERSION = 4;

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      const tx = e.target.transaction;

      if (!db.objectStoreNames.contains("settings")) {
        db.createObjectStore("settings", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("learning")) {
        db.createObjectStore("learning", { keyPath: "code" });
      }
      if (!db.objectStoreNames.contains("stats")) {
        db.createObjectStore("stats", { keyPath: "code" });
      }
      if (!db.objectStoreNames.contains("skipped")) {
        db.createObjectStore("skipped", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("flashcard_sets")) {
        const sets = db.createObjectStore("flashcard_sets", { keyPath: "id" });
        sets.createIndex("langCode", "langCode", { unique: false });
      }
      if (!db.objectStoreNames.contains("favorites")) {
        const fav = db.createObjectStore("favorites", { keyPath: "id" });
        fav.createIndex("langCode", "langCode", { unique: false });
      }
      if (!db.objectStoreNames.contains("sentence_reviews")) {
        const reviews = db.createObjectStore("sentence_reviews", { keyPath: "id" });
        reviews.createIndex("langCode", "langCode", { unique: false });
        reviews.createIndex("nextReviewAt", "nextReviewAt", { unique: false });
      }

      if (e.oldVersion < 2 && db.objectStoreNames.contains("stats")) {
        const statsStore = tx.objectStore("stats");
        statsStore.openCursor().onsuccess = (ev) => {
          const cursor = ev.target.result;
          if (!cursor) return;
          const row = cursor.value;
          const migrated = {
            code: row.code,
            totalScore: row.totalScore ?? (row.correct ?? 0) * 10,
            streak: row.streak ?? 0,
            lastPracticeDate: row.lastPracticeDate ?? null,
            history: row.history ?? [],
          };
          cursor.update(migrated);
          cursor.continue();
        };
      }
    };
  });
}

export function sentenceId(langCode, sentence) {
  return `${langCode}:${sentence.trim().normalize("NFC")}`;
}

export function sentenceRefId(langCode, lineIndex) {
  return `${langCode}:${lineIndex}`;
}

export function localDateKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function uuid() {
  return crypto.randomUUID?.() ?? `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function tx(store, mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const os = t.objectStore(store);
    const result = fn(os);
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
  });
}

export async function getSettings() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction("settings", "readonly");
    const req = t.objectStore("settings").get("main");
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function saveSettings(settings) {
  await tx("settings", "readwrite", (os) => {
    os.put({ id: "main", ...settings });
  });
}

export async function getLearningLanguages() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction("learning", "readonly");
    const req = t.objectStore("learning").getAll();
    req.onsuccess = () => resolve(req.result ?? []);
    req.onerror = () => reject(req.error);
  });
}

export async function addLearningLanguage(lang) {
  await tx("learning", "readwrite", (os) => {
    os.put({ ...lang, addedAt: lang.addedAt ?? Date.now() });
  });
  const stats = await getStats(lang.code);
  if (!stats) {
    await tx("stats", "readwrite", (os) => {
      os.put({ code: lang.code, totalScore: 0, streak: 0, lastPracticeDate: null, history: [] });
    });
  }
}

export async function removeLearningLanguage(code) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(
      ["learning", "stats", "skipped", "flashcard_sets", "favorites", "sentence_reviews"],
      "readwrite"
    );
    t.objectStore("learning").delete(code);
    t.objectStore("stats").delete(code);

    const skipStore = t.objectStore("skipped");
    skipStore.openCursor().onsuccess = (e) => {
      const c = e.target.result;
      if (!c) return;
      if (c.value.langCode === code) c.delete();
      c.continue();
    };

    const setStore = t.objectStore("flashcard_sets");
    setStore.index("langCode").openCursor(IDBKeyRange.only(code)).onsuccess = (e) => {
      const c = e.target.result;
      if (!c) return;
      c.delete();
      c.continue();
    };

    const favStore = t.objectStore("favorites");
    favStore.index("langCode").openCursor(IDBKeyRange.only(code)).onsuccess = (e) => {
      const c = e.target.result;
      if (!c) return;
      c.delete();
      c.continue();
    };

    const reviewStore = t.objectStore("sentence_reviews");
    reviewStore.index("langCode").openCursor(IDBKeyRange.only(code)).onsuccess = (e) => {
      const c = e.target.result;
      if (!c) return;
      c.delete();
      c.continue();
    };

    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

export async function getStats(code) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction("stats", "readonly");
    const req = t.objectStore("stats").get(code);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function getAllStats() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction("stats", "readonly");
    const req = t.objectStore("stats").getAll();
    req.onsuccess = () => resolve(req.result ?? []);
    req.onerror = () => reject(req.error);
  });
}

export async function recordScore(code, points) {
  const existing = (await getStats(code)) ?? {
    code,
    totalScore: 0,
    streak: 0,
    lastPracticeDate: null,
    history: [],
  };
  const today = localDateKey();
  existing.totalScore = (existing.totalScore ?? 0) + points;

  const hist = existing.history ?? [];
  const dayRow = hist.find((h) => h.date === today);
  if (dayRow) dayRow.points += points;
  else hist.push({ date: today, points });
  hist.sort((a, b) => a.date.localeCompare(b.date));
  if (hist.length > 90) hist.splice(0, hist.length - 90);
  existing.history = hist;

  if (existing.lastPracticeDate !== today) {
    const yesterday = localDateKey(new Date(Date.now() - 86400000));
    if (existing.lastPracticeDate === yesterday) existing.streak = (existing.streak ?? 0) + 1;
    else existing.streak = 1;
    existing.lastPracticeDate = today;
  }

  await tx("stats", "readwrite", (os) => os.put(existing));
  return existing;
}

export async function getSkippedSet(langCode) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction("skipped", "readonly");
    const req = t.objectStore("skipped").getAll();
    req.onsuccess = () => {
      const indices = new Set();
      const sentences = new Set();
      for (const row of req.result ?? []) {
        if (row.langCode !== langCode) continue;
        if (row.lineIndex != null) indices.add(row.lineIndex);
        else if (row.sentence) sentences.add(row.sentence.trim().normalize("NFC"));
      }
      resolve({ indices, sentences });
    };
    req.onerror = () => reject(req.error);
  });
}

export async function getSkippedRecords(langCode) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction("skipped", "readonly");
    const req = t.objectStore("skipped").getAll();
    req.onsuccess = () => {
      const rows = (req.result ?? [])
        .filter((r) => r.langCode === langCode)
        .sort((a, b) => (b.reportedAt ?? 0) - (a.reportedAt ?? 0));
      resolve(rows);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function markSentenceSkipped(langCode, lineIndex, sourceFile = "", sentence = null) {
  const id = lineIndex != null ? sentenceRefId(langCode, lineIndex) : sentenceId(langCode, sentence ?? "");
  await tx("skipped", "readwrite", (os) => {
    os.put({
      id,
      langCode,
      lineIndex: lineIndex ?? null,
      sourceFile,
      reportedAt: Date.now(),
      ...(sentence ? { sentence: sentence.trim().normalize("NFC") } : {}),
    });
  });
}

export async function unskipSentence(id) {
  await tx("skipped", "readwrite", (os) => os.delete(id));
}

export async function getFavorites(langCode) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction("favorites", "readonly");
    const req = t.objectStore("favorites").index("langCode").getAll(langCode);
    req.onsuccess = () => {
      const rows = (req.result ?? []).sort((a, b) => (b.savedAt ?? 0) - (a.savedAt ?? 0));
      resolve(rows);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function isFavorite(langCode, lineIndex) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction("favorites", "readonly");
    const req = t.objectStore("favorites").get(sentenceRefId(langCode, lineIndex));
    req.onsuccess = () => resolve(!!req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function addFavorite(langCode, lineIndex, sourceFile = "") {
  const id = sentenceRefId(langCode, lineIndex);
  await tx("favorites", "readwrite", (os) => {
    os.put({ id, langCode, lineIndex, sourceFile, savedAt: Date.now() });
  });
}

export async function removeFavorite(langCode, lineIndex) {
  await tx("favorites", "readwrite", (os) => os.delete(sentenceRefId(langCode, lineIndex)));
}

export async function getFlashcardSets(langCode) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction("flashcard_sets", "readonly");
    const req = t.objectStore("flashcard_sets").index("langCode").getAll(langCode);
    req.onsuccess = () => resolve(req.result ?? []);
    req.onerror = () => reject(req.error);
  });
}

export async function getFlashcardSet(id) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction("flashcard_sets", "readonly");
    const req = t.objectStore("flashcard_sets").get(id);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function saveFlashcardSet(set) {
  const db = await openDb();
  const all = await getFlashcardSets(set.langCode);
  const nameLower = set.name.trim().toLowerCase();
  const dup = all.find((s) => s.id !== set.id && s.name.trim().toLowerCase() === nameLower);
  if (dup) throw new Error(`A set named "${set.name}" already exists.`);
  await tx("flashcard_sets", "readwrite", (os) => os.put(set));
  return set;
}

export async function createFlashcardSet(langCode, name) {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Set name is required.");
  if (trimmed.length > 60) throw new Error("Set name is too long.");
  const set = {
    id: uuid(),
    langCode,
    name: trimmed,
    words: [],
    builtinId: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  return saveFlashcardSet(set);
}

export async function addWordToSet(setId, word) {
  const set = await getFlashcardSet(setId);
  if (!set) throw new Error("Set not found.");
  const w = word.trim().normalize("NFC");
  if (!w) throw new Error("Word is empty.");
  const exists = set.words.some((x) => x.word.toLowerCase() === w.toLowerCase());
  if (!exists) {
    set.words.push({ word: w, addedAt: Date.now() });
    set.updatedAt = Date.now();
    await saveFlashcardSet(set);
  }
  return set;
}

export async function removeWordFromSet(setId, word) {
  const set = await getFlashcardSet(setId);
  if (!set) throw new Error("Set not found.");
  const key = word.trim().toLowerCase();
  set.words = set.words.filter((x) => x.word.toLowerCase() !== key);
  set.updatedAt = Date.now();
  await saveFlashcardSet(set);
  return set;
}

export async function deleteFlashcardSet(id) {
  await tx("flashcard_sets", "readwrite", (os) => os.delete(id));
}

export async function getSentenceReviews(langCode) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction("sentence_reviews", "readonly");
    const req = t.objectStore("sentence_reviews").index("langCode").getAll(langCode);
    req.onsuccess = () => resolve(req.result ?? []);
    req.onerror = () => reject(req.error);
  });
}

export async function getDueReviews(langCode, { includeLearned = false } = {}) {
  const all = await getSentenceReviews(langCode);
  const now = Date.now();
  return all
    .filter((r) => {
      if (!includeLearned && r.learned) return false;
      return (r.nextReviewAt ?? 0) <= now;
    })
    .sort((a, b) => (a.nextReviewAt ?? 0) - (b.nextReviewAt ?? 0));
}

export async function countDueReviews(langCode) {
  return (await getDueReviews(langCode)).length;
}

async function getSentenceReview(id) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction("sentence_reviews", "readonly");
    const req = t.objectStore("sentence_reviews").get(id);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function logSentenceAttempt({
  langCode,
  sentence,
  lineIndex,
  answer,
  typed = "",
  correct,
  hintCount = 0,
}) {
  const norm = sentence.trim().normalize("NFC");
  const id = sentenceId(langCode, norm);
  const existing = await getSentenceReview(id);
  const attempts = [
    ...(existing?.attempts ?? []),
    { at: Date.now(), typed, answer: answer ?? "", correct, hintCount },
  ];
  if (attempts.length > 80) attempts.splice(0, attempts.length - 80);

  let correctCount = existing?.correctCount ?? 0;
  let wrongCount = existing?.wrongCount ?? 0;
  let nextReviewAt;

  if (correct) {
    correctCount += 1;
    nextReviewAt =
      correctCount >= LEARNED_THRESHOLD
        ? Date.now() + 30 * 24 * 60 * 60 * 1000
        : nextReviewAfterCorrect(correctCount);
  } else {
    wrongCount += 1;
    nextReviewAt = nextReviewAfterWrong();
  }

  const row = {
    id,
    langCode,
    sentence: norm,
    lineIndex: lineIndex ?? null,
    answer: answer ?? "",
    correctCount,
    wrongCount,
    learned: correctCount >= LEARNED_THRESHOLD,
    nextReviewAt,
    lastAttemptAt: Date.now(),
    lastCorrect: correct,
    attempts,
  };

  await tx("sentence_reviews", "readwrite", (os) => os.put(row));
  return row;
}

export async function clearAllData() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(
      ["settings", "learning", "stats", "skipped", "flashcard_sets", "favorites", "sentence_reviews"],
      "readwrite"
    );
    for (const name of t.objectStoreNames) t.objectStore(name).clear();
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}
