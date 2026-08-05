import {
  DIFFICULTY_PRESETS,
  ZIPF_MIN,
  ZIPF_MAX,
  CORPUS_OPTIONS,
  CORPUS_STATS_VERSION,
  assetUrl,
  resolveDataUrl,
  sentenceFilename,
  legacyFallbacks,
  DEFAULT_SENTENCE_FILTERS,
  wordsMatch,
  prefixMatches,
  tokenizeWithPositions,
  loadZipfDict,
  loadLemmaMap,
  streamAllSentences,
  buildPuzzle,
  indexZipfPuzzles,
  indexFlashcardPuzzles,
  pickFlashcardPuzzle,
  shuffleArray,
  translateText,
  buildVocabSet,
  isKnownWord,
  fetchSentenceAtIndex,
  sentenceText,
  blankWordDedupKey,
  senseDedupKey,
  normalizeForMatch,
  puzzleMatchesReported,
  puzzleIsSkipped,
  countMatchingSentences,
  corpusFilterBounds,
  buildCorpusStatsFromSentences,
  annotateSentencesFromStats,
  corpusStatsId,
  corpusFingerprint,
  statsMatchFingerprint,
  sentencesContainingWord,
  findSentencesContainingWord,
  countSentencesContainingWords,
} from "./game.js";
import { loadArticles, buildArticlePuzzle, articleDifficultyLabel } from "./articles.js";
import { feedbackCorrect, feedbackWrong, speakWord, speakSentence, stopSpeech, configureTts, TTS_VARIANTS } from "./tts.js";
import { applyTheme } from "./theme.js";
import { confettiColors } from "./lang-config.js";
import {
  charsFor,
  ACCENT_COMMANDS,
  resolveSlashInput,
  collapseSlashCommands,
  hasPendingSlash,
  maxRawLength,
  accentForHold,
} from "./accents.js";
import { lookupWord, wiktionaryTitleFromHref, wiktionaryUrl } from "./lookup.js";
import { groqChat, buildWordContext } from "./groq.js";
import { pointsForAnswer } from "./score.js";
import { exportSet, parseImport } from "./flashcards-io.js";
import { seedBuiltinFlashcardSets, iconForPreset, PRESET_ROUND_GOAL } from "./flashcard-presets.js";
import { renderScoreChart, attachChartHover } from "./stats-chart.js";
import { renderMarkdown, fetchMarkdown } from "./markdown.js";
import {
  measureWordWidth,
  openModal,
  closeModal,
  bindModalDismiss,
  updateRangeFill,
  flagEl,
  bounceScore,
  fireConfetti,
} from "./ui.js";
import {
  getSettings,
  saveSettings,
  getLearningLanguages,
  addLearningLanguage,
  removeLearningLanguage,
  getAllStats,
  recordScore,
  clearAllData,
  getSkippedSet,
  markSentenceSkipped,
  getSkippedRecords,
  unskipSentence,
  getFavorites,
  addFavorite,
  removeFavorite,
  isFavorite,
  getFlashcardSets,
  createFlashcardSet,
  addWordToSet,
  removeWordFromSet,
  deleteFlashcardSet,
  saveFlashcardSet,
  logSentenceAttempt,
  getDueReviews,
  countDueReviews,
  getActiveReviews,
  countActiveReviews,
  getLearnedReviews,
  requeueLearnedReview,
  deleteSentenceReviewForPuzzle,
  getSentenceReviews,
  getWordExposureMap,
  incrementWordExposure,
  getSeenSenseKeySet,
  markSenseSeen,
  getCachedCorpusStats,
  saveCachedCorpusStats,
} from "./db.js";
import {
  POS_OPTIONS,
  DEFAULT_POS_FILTER,
  loadTaggedCorpus,
  annotateSentencesWithTags,
  taggedCorpusAvailable,
  loadSensesInventory,
  resolveLemma,
  sentencesContainingLemma,
  findSentencesContainingLemma,
} from "./tagged.js";
import {
  conjugationsAvailable,
  loadVerbPack,
  listTenses,
  pickConjugationItem,
  conjugationCorrect,
} from "./conjugator.js";
import { LEARNED_THRESHOLD, puzzleFromReview } from "./srs.js";

const $ = window.jQuery;
const LEGACY_SETTINGS_KEY = "lang-practice-settings";
const NATIVE_LANG = "en";
const NATIVE_LABEL = "English";

const state = {
  lang: "es",
  langLabel: "Spanish",
  country: "es",
  sourceFile: "",
  corpus: "wiki",
  nativeLang: NATIVE_LANG,
  nativeLabel: NATIVE_LABEL,
  nativeCountry: "gb",
  groqApiKey: "",
  zipfDict: {},
  lemmaMap: {},
  corpusStats: null,
  sentences: [],
  vocabSet: new Set(),
  puzzlePool: [],
  puzzlePoolUsed: new Set(),
  sessionBlankKeys: new Set(),
  wordExposure: {},
  blockedWordKeys: new Set(),
  ttsLocales: {},
  ttsRate: 0.92,
  fullVocabLoaded: false,
  dataLoaded: false,
  sessionPoints: 0,
  lastPoints: 0,
  lastHintCount: 0,
  zipfLo: 5.5,
  zipfHi: 6.0,
  levelName: "Easy",
  practiceMode: "zipf",
  activeFlashcardSet: null,
  editingFlashcardSet: null,
  flashcardSets: [],
  flashcardPuzzlePool: [],
  flashcardSequential: false,
  flashcardWordOrder: [],
  flashcardCycleIndex: 0,
  questionLimit: 0,
  questionsAnswered: 0,
  skippedSet: { indices: new Set(), sentences: new Set() },
  puzzle: null,
  translation: "",
  answerTranslation: "",
  rawTyped: "",
  typed: "",
  revealedLen: 0,
  hintedAt: [],
  revealed: false,
  awaitingContinue: false,
  flashcardSetModalMode: "create",
  editingSetId: null,
  pendingWordAfterSetCreate: null,
  pendingFlashcardWord: null,
  translationCache: {},
  catalog: [],
  learning: [],
  stats: {},
  wrongQueue: [],
  questionsSinceReview: 0,
  reviewInterval: 10,
  inReview: false,
  reviewItems: [],
  reviewIndex: 0,
  reviewSessionTotal: 0,
  selectedText: "",
  lookupWord: "",
  lookupTranslation: "",
  lookupWikiHistory: [],
  chatHistory: [],
  selectedSetId: null,
  savedTab: "favorites",
  savedLang: null,
  savedFromHub: false,
  sentenceFilters: { ...DEFAULT_SENTENCE_FILTERS },
  posFilter: { ...DEFAULT_POS_FILTER, allowed: [...DEFAULT_POS_FILTER.allowed] },
  taggedAvailable: false,
  taggedData: null,
  lemmaZipf: null,
  senseZipf: null,
  sensesInventory: null,
  seenSenseKeys: new Set(),
  lookupLemma: "",
  lookupExampleOffset: 0,
  lookupTaggedCache: Object.create(null),
  lookupSenseZipf: null,
  lookupLemmaZipf: null,
  flashcardListTab: "yours",
  wordScreenTab: "lookup",
  masteryItems: [],
  masteryShown: 0,
  senseMeta: null,
  reviewBankTab: "active",
  verbPack: null,
  conjItem: null,
  conjScore: 0,
  conjUsedKeys: new Set(),
  conjTenseFilter: [],
  conjAwaiting: false,
  articles: [],
  activeArticle: null,
  articleCursor: 0,
  enableTts: true,
  revisitQueue: [],
  revisitIndex: 0,
};

function catalogLang(code) {
  return state.catalog.find((l) => l.code === code);
}

function showScreen(id) {
  $(".screen").removeClass("active");
  $(`#${id}`).addClass("active");
  if (id === "screen-home" || id === "screen-about") applyTheme(null, true);
}

function showToast(msg) {
  const $t = $("#toast");
  $t.text(msg).removeClass("hidden");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => $t.addClass("hidden"), 2800);
}

function setLoadProgress(pct, _msg) {
  const clamped = Math.max(0, Math.min(100, Math.round(Number(pct) || 0)));
  const $spinner = $("#load-spinner");
  const $ring = $("#load-progress-ring");
  const $pct = $("#load-pct");
  if (!$spinner.length) return;
  if (clamped <= 0) {
    $spinner.addClass("is-indeterminate");
    $ring.css("stroke-dashoffset", "");
    $pct.text("");
    return;
  }
  $spinner.removeClass("is-indeterminate");
  $ring.css("stroke-dashoffset", String(100 - clamped));
  $pct.text(`${clamped}`);
}

async function migrateLegacySettings() {
  try {
    const raw = localStorage.getItem(LEGACY_SETTINGS_KEY);
    if (!raw) return;
    const legacy = JSON.parse(raw);
    const existing = await getSettings();
    if (!existing?.nativeCode && legacy.nativeCode) {
      const lang = catalogLang(legacy.nativeCode);
      await saveSettings({
        nativeCode: legacy.nativeCode,
        nativeLabel: lang?.label ?? legacy.nativeCode,
        nativeCountry: lang?.country ?? "gb",
        reviewInterval: legacy.reviewInterval ?? 10,
      });
    }
    localStorage.removeItem(LEGACY_SETTINGS_KEY);
  } catch {
    /* ignore */
  }
}

async function loadPersistedSettings() {
  await migrateLegacySettings();
  const s = await getSettings();
  if (s?.nativeCode) {
    const lang = catalogLang(s.nativeCode);
    state.nativeLang = s.nativeCode;
    state.nativeLabel = s.nativeLabel ?? lang?.label ?? s.nativeCode;
    state.nativeCountry = s.nativeCountry ?? lang?.country ?? "gb";
  }
  if (s?.reviewInterval) {
    state.reviewInterval = s.reviewInterval;
    $("#review-interval").val(s.reviewInterval);
  }
  if (s?.groqApiKey) state.groqApiKey = s.groqApiKey;
  if (s?.enableTts != null) {
    state.enableTts = s.enableTts;
    $("#setting-tts").prop("checked", s.enableTts);
  }
  if (s?.ttsLocales) state.ttsLocales = { ...s.ttsLocales };
  if (s?.ttsRate != null) {
    state.ttsRate = s.ttsRate;
    if ($("#tts-rate").length) {
      $("#tts-rate").val(s.ttsRate);
      $("#tts-rate-label").text(s.ttsRate.toFixed(2));
    }
  }
  applyTtsConfig();
  renderTtsLocaleSettings();
}

function applyTtsConfig() {
  configureTts({ locales: state.ttsLocales, rate: state.ttsRate });
}

function renderTtsLocaleSettings() {
  const $wrap = $("#tts-locale-settings").empty();
  const codes = [...new Set(state.learning.map((l) => l.code))];
  if (!codes.length) {
    $wrap.append(
      $("<p>", { class: "text-xs", style: "color:var(--muted)", text: "Add a language to configure pronunciation." })
    );
    return;
  }
  for (const code of codes) {
    const lang = catalogLang(code);
    const variants = TTS_VARIANTS[code];
    if (!variants?.length) continue;
    const $row = $(`
      <label class="block text-sm">
        <span class="font-semibold">${lang?.label ?? code} voice</span>
        <select class="tts-locale-pick select-field mt-1 w-full rounded-lg border px-3 py-2 text-sm" data-lang="${code}" style="border-color:var(--border)"></select>
      </label>
    `);
    const $sel = $row.find("select");
    for (const v of variants) {
      $sel.append(`<option value="${v.locale}">${v.label}</option>`);
    }
    $sel.val(state.ttsLocales[code] || variants[0].locale);
    $wrap.append($row);
  }
  enhanceAllSelects($wrap[0]);
}

function filterStorageKey(langCode = state.lang, corpus = state.corpus) {
  return `${langCode}:${corpus || "wiki"}`;
}

async function applyPersistedSentenceFilters(langCode, corpus = state.corpus) {
  const s = await getSettings();
  const key = filterStorageKey(langCode, corpus);
  const byCorpus = s?.filtersByLangCorpus ?? {};
  // Prefer per-corpus; fall back to legacy per-lang once.
  const saved = byCorpus[key] ?? s?.filtersByLang?.[langCode];
  if (!saved) {
    applyCorpusStatsToFiltersUI({ resetToBounds: true });
    $("#filter-sentences-enable").prop("checked", false);
    $("#filter-advanced-enable").prop("checked", false);
    state.posFilter = { enabled: false, allowed: POS_OPTIONS.map((p) => p.id) };
    renderPosFilterGrid();
    syncFilterUI({ persist: false });
    return;
  }
  $("#filter-sentences-enable").prop("checked", Boolean(saved.enabled));
  applyCorpusStatsToFiltersUI({ resetToBounds: false });
  if (saved.minWords != null) $("#filter-words-lo").val(saved.minWords);
  if (saved.maxWords != null) $("#filter-words-hi").val(saved.maxWords);
  if (saved.minAvgZipf != null) $("#filter-avgzipf-lo").val(saved.minAvgZipf);
  if (saved.maxAvgZipf != null) $("#filter-avgzipf-hi").val(saved.maxAvgZipf);
  applyCorpusStatsToFiltersUI({ resetToBounds: false });

  const pos = saved.posFilter;
  $("#filter-advanced-enable").prop("checked", Boolean(pos?.enabled));
  state.posFilter = {
    enabled: Boolean(pos?.enabled),
    allowed: Array.isArray(pos?.allowed) && pos.allowed.length
      ? [...pos.allowed]
      : POS_OPTIONS.map((p) => p.id),
  };
  renderPosFilterGrid();
  syncFilterUI({ persist: false });
}

let persistFiltersTimer = null;
function schedulePersistSentenceFilters() {
  clearTimeout(persistFiltersTimer);
  persistFiltersTimer = setTimeout(() => {
    persistSentenceFilters().catch(() => {});
  }, 350);
}

async function persistSentenceFilters() {
  if (!state.dataLoaded || !state.lang) return;
  const existing = (await getSettings()) ?? {};
  const filters = readSentenceFilters();
  const key = filterStorageKey();
  await saveSettings({
    ...existing,
    filtersByLangCorpus: {
      ...(existing.filtersByLangCorpus ?? {}),
      [key]: filters,
    },
  });
}

function blankWordOpts() {
  const opts = {
    sessionBlankKeys: state.sessionBlankKeys,
    wordExposure: state.wordExposure,
    lang: state.lang,
    lemmaMap: state.lemmaMap,
    posFilter: state.posFilter,
    lemmaZipf: state.lemmaZipf,
    senseZipf: state.senseZipf,
    seenSenseKeys: state.seenSenseKeys,
    requireTags: Boolean(state.taggedAvailable && state.taggedData),
  };
  // Freeplay only — flashcards, revisit, and casual browse may use review-bank words.
  if (state.practiceMode === "zipf" || state.practiceMode === "article") {
    opts.blockedWordKeys = state.blockedWordKeys;
  }
  return opts;
}

function readPosFilterFromUI() {
  const enabled = $("#filter-advanced-enable").is(":checked");
  const allowed = [];
  $("#pos-filter-grid input[type=checkbox]").each(function () {
    if (this.checked) allowed.push(this.value);
  });
  return {
    enabled: Boolean(enabled && state.taggedAvailable),
    allowed: allowed.length ? allowed : POS_OPTIONS.map((p) => p.id),
  };
}

function renderPosFilterGrid() {
  const $grid = $("#pos-filter-grid").empty();
  const allowed = new Set(state.posFilter?.allowed ?? DEFAULT_POS_FILTER.allowed);
  for (const opt of POS_OPTIONS) {
    const id = `pos-opt-${opt.id}`;
    const $label = $(`<label for="${id}"></label>`);
    const $cb = $(`<input type="checkbox" id="${id}" value="${opt.id}" />`);
    $cb.prop("checked", allowed.has(opt.id));
    $cb.on("change", () => {
      state.posFilter = readPosFilterFromUI();
      schedulePersistSentenceFilters();
      updateFilterMatchCount();
    });
    $label.append($cb, document.createTextNode(opt.label));
    $grid.append($label);
  }
  $("#menu-advanced-filters").toggleClass("hidden", false);
  $("#pos-filter-unavailable").toggleClass("hidden", state.taggedAvailable);
  $("#pos-filter-grid").toggleClass("hidden", !state.taggedAvailable);
}

async function refreshBlockedWordKeys() {
  if (!state.lang) {
    state.blockedWordKeys = new Set();
    return;
  }
  const reviews = await getActiveReviews(state.lang, { skippedSet: state.skippedSet });
  const keys = new Set();
  for (const r of reviews) {
    if (r.lemma) {
      const sk = senseDedupKey(r.lemma, r.sense);
      if (sk) state.seenSenseKeys.add(sk);
    }
    if (!r.answer) continue;
    keys.add(blankWordDedupKey(r.answer, state.lang, state.lemmaMap));
  }
  state.blockedWordKeys = keys;
}

async function trackPuzzleShown(puzzle) {
  if (!puzzle?.answer) return;
  const key = blankWordDedupKey(puzzle.answer, state.lang, state.lemmaMap);
  state.sessionBlankKeys.add(key);
  const count = await incrementWordExposure(state.lang, key);
  state.wordExposure[key] = count;
  // Freeplay: never quiz this lemma+sense again.
  if (
    (state.practiceMode === "zipf" || state.practiceMode === "article") &&
    puzzle.lemma
  ) {
    const senseKey = senseDedupKey(puzzle.lemma, puzzle.sense);
    if (senseKey) {
      state.seenSenseKeys.add(senseKey);
      await markSenseSeen(state.lang, senseKey, {
        lemma: puzzle.lemma,
        sense: puzzle.sense || "",
      });
    }
  }
}

function purgeReportedPuzzle(puzzle) {
  const match = (p) => puzzleMatchesReported(p, puzzle);
  state.wrongQueue = state.wrongQueue.filter((p) => !match(p));
  const reviewIdx = state.reviewItems.findIndex((p) => match(p));
  if (reviewIdx >= 0) {
    state.reviewItems.splice(reviewIdx, 1);
    if (reviewIdx < state.reviewIndex) state.reviewIndex -= 1;
    state.reviewSessionTotal = Math.max(0, state.reviewSessionTotal - 1);
  }
  state.revisitQueue = state.revisitQueue.filter(
    (r) => !(r.lineIndex != null && puzzle.lineIndex != null && r.lineIndex === puzzle.lineIndex) &&
      r.sentence?.trim().normalize("NFC") !== puzzle.sentence?.trim().normalize("NFC")
  );
  state.flashcardPuzzlePool = state.flashcardPuzzlePool.filter((p) => !match(p));
  dropPuzzlePoolForSkipped(puzzle.lineIndex, puzzle.sentence);
}

async function persistSettings() {
  const existing = (await getSettings()) ?? {};
  await saveSettings({
    ...existing,
    nativeCode: NATIVE_LANG,
    nativeLabel: NATIVE_LABEL,
    nativeCountry: "gb",
    reviewInterval: state.reviewInterval,
    groqApiKey: state.groqApiKey,
    enableTts: state.enableTts,
    ttsLocales: state.ttsLocales,
    ttsRate: state.ttsRate,
    filtersByLang: existing.filtersByLang,
  });
}

function syncDualRange(loSel, hiSel, fillSel, labelSel, formatLabel, { allowEqual = true } = {}) {
  const $lo = $(loSel);
  const $hi = $(hiSel);
  const step = +$lo.attr("step") || 1;
  let lo = +$lo.val();
  let hi = +$hi.val();
  if (allowEqual) {
    if (lo > hi) {
      if (document.activeElement === $lo[0]) hi = lo;
      else lo = hi;
    }
  } else if (lo >= hi) {
    if (document.activeElement === $lo[0]) hi = lo + step;
    else lo = hi - step;
  }
  $lo.val(lo);
  $hi.val(hi);
  const fill = $(fillSel)[0];
  if (fill) updateRangeFill($lo[0], $hi[0], fill);
  if (labelSel) $(labelSel).text(formatLabel(lo, hi));
  return { lo, hi };
}

function readSentenceFilters() {
  const enabled = $("#filter-sentences-enable").is(":checked");
  state.posFilter = readPosFilterFromUI();
  if (!enabled) {
    return {
      ...DEFAULT_SENTENCE_FILTERS,
      enabled: false,
      posFilter: { ...state.posFilter },
    };
  }
  const words = syncDualRange(
    "#filter-words-lo",
    "#filter-words-hi",
    "#filter-words-fill",
    "#filter-words-label",
    (lo, hi) => (lo === hi ? `${lo}` : `${lo} – ${hi}`)
  );
  const zipf = syncDualRange(
    "#filter-avgzipf-lo",
    "#filter-avgzipf-hi",
    "#filter-avgzipf-fill",
    "#filter-avgzipf-label",
    (lo, hi) => (lo === hi ? lo.toFixed(1) : `${lo.toFixed(1)} – ${hi.toFixed(1)}`)
  );
  return {
    enabled: true,
    minWords: words.lo,
    maxWords: words.hi,
    minAvgZipf: zipf.lo,
    maxAvgZipf: zipf.hi,
    posFilter: { ...state.posFilter },
  };
}

/** Prefer corpus-stats bounds; otherwise derive from the loaded sentences. */
function liveFilterBounds() {
  const fromStats = corpusFilterBounds(state.corpusStats);
  if (state.corpusStats?.minWords != null && state.corpusStats?.maxWords != null) {
    return fromStats;
  }
  let minWords = Infinity;
  let maxWords = 0;
  for (const entry of state.sentences ?? []) {
    const wc = entry.wordCount ?? tokenizeWordCount(sentenceText(entry));
    if (!wc) continue;
    if (wc < minWords) minWords = wc;
    if (wc > maxWords) maxWords = wc;
  }
  if (!Number.isFinite(minWords) || maxWords < minWords) {
    return fromStats;
  }
  return {
    ...fromStats,
    minWords,
    maxWords,
  };
}

function tokenizeWordCount(sentence) {
  return (sentence.match(/\b[\wáéíóúüñÁÉÍÓÚÜÑàèéìòùäöüßąćęłńóśźżА-яЁё'-]+\b/gu) ?? []).length;
}

function applyCorpusStatsToFiltersUI({ resetToBounds = false } = {}) {
  const bounds = liveFilterBounds();
  const { minWords, maxWords, minAvgZipf, maxAvgZipf } = bounds;

  const $wLo = $("#filter-words-lo");
  const $wHi = $("#filter-words-hi");
  $wLo.attr({ min: minWords, max: maxWords, step: 1 });
  $wHi.attr({ min: minWords, max: maxWords, step: 1 });
  let wLo = resetToBounds ? minWords : +$wLo.val();
  let wHi = resetToBounds ? maxWords : +$wHi.val();
  if (Number.isNaN(wLo)) wLo = minWords;
  if (Number.isNaN(wHi)) wHi = maxWords;
  if (wLo < minWords) wLo = minWords;
  if (wHi > maxWords) wHi = maxWords;
  if (wLo > wHi) {
    wLo = minWords;
    wHi = maxWords;
  }
  $wLo.val(wLo);
  $wHi.val(wHi);
  $("#filter-words-min-label").text(String(minWords));
  $("#filter-words-max-label").text(String(maxWords));
  syncDualRange(
    "#filter-words-lo",
    "#filter-words-hi",
    "#filter-words-fill",
    "#filter-words-label",
    (a, b) => (a === b ? `${a}` : `${a} – ${b}`)
  );

  const $lo = $("#filter-avgzipf-lo");
  const $hi = $("#filter-avgzipf-hi");
  $lo.attr({ min: minAvgZipf, max: maxAvgZipf, step: 0.1 });
  $hi.attr({ min: minAvgZipf, max: maxAvgZipf, step: 0.1 });
  let lo = resetToBounds ? minAvgZipf : +$lo.val();
  let hi = resetToBounds ? maxAvgZipf : +$hi.val();
  if (Number.isNaN(lo)) lo = minAvgZipf;
  if (Number.isNaN(hi)) hi = maxAvgZipf;
  if (lo < minAvgZipf) lo = minAvgZipf;
  if (hi > maxAvgZipf) hi = maxAvgZipf;
  if (lo > hi) {
    lo = minAvgZipf;
    hi = maxAvgZipf;
  }
  $lo.val(lo);
  $hi.val(hi);
  $("#filter-avgzipf-min-label").text(minAvgZipf.toFixed(1));
  $("#filter-avgzipf-max-label").text(maxAvgZipf.toFixed(1));
  syncDualRange(
    "#filter-avgzipf-lo",
    "#filter-avgzipf-hi",
    "#filter-avgzipf-fill",
    "#filter-avgzipf-label",
    (a, b) => (a === b ? a.toFixed(1) : `${a.toFixed(1)} – ${b.toFixed(1)}`)
  );
  updateFilterMatchCount();
}

let filterMatchCountTimer = null;
function updateFilterMatchCount() {
  const filters = readSentenceFilters();
  const $el = $("#filter-match-count");

  if (state.practiceMode === "flashcard" && state.activeFlashcardSet?.words?.length) {
    const run = () => {
      const words = state.activeFlashcardSet.words.map((w) => w.word);
      const { matched, withWords } = countSentencesContainingWords(state.sentences, words, {
        filters: readSentenceFilters(),
        lang: state.lang,
        zipfDict: state.zipfDict,
        lemmaMap: state.lemmaMap,
        corpusStats: state.corpusStats,
        skippedSet: state.skippedSet,
      });
      const enabled = $("#filter-sentences-enable").is(":checked");
      const label = enabled
        ? `${matched.toLocaleString()} of ${withWords.toLocaleString()} sentences with set words match`
        : `${withWords.toLocaleString()} sentences contain words from this set`;
      $el.text(label);
      $el.css("color", enabled && matched === 0 ? "var(--danger, #dc2626)" : "var(--primary)");
      const canStart = withWords > 0 && (!enabled || matched > 0);
      $("#btn-flashcard-start").prop("disabled", !canStart).toggleClass("opacity-50", !canStart);
    };
    $el.text("Counting…");
    clearTimeout(filterMatchCountTimer);
    filterMatchCountTimer = setTimeout(run, 120);
    return;
  }

  const total = state.corpusStats?.totalSentences ?? state.sentences?.length ?? 0;
  const matched = countMatchingSentences(state.corpusStats, filters);
  const label = filters.enabled
    ? `${matched.toLocaleString()} of ${total.toLocaleString()} sentences match`
    : `${total.toLocaleString()} sentences available`;
  $el.text(label);
  $el.css("color", filters.enabled && matched === 0 ? "var(--danger, #dc2626)" : "var(--primary)");
  const canStart = !filters.enabled || matched > 0;
  $("#preset-grid .preset-tile").not(".preset-tile-custom").toggleClass("disabled", !canStart);
  $("#preset-grid .btn-custom-start").prop("disabled", !canStart).toggleClass("opacity-50", !canStart);
}

function refreshPuzzlePool() {
  if (state.practiceMode !== "zipf") {
    state.puzzlePool = [];
    state.puzzlePoolUsed = new Set();
    return;
  }
  state.puzzlePool = indexZipfPuzzles(
    state.sentences,
    state.zipfLo,
    state.zipfHi,
    state.lang,
    state.zipfDict,
    state.lemmaMap,
    state.skippedSet,
    state.sentenceFilters,
    state.corpusStats,
    blankWordOpts()
  );
  state.puzzlePoolUsed = new Set();
}

function dropPuzzlePoolForSkipped(lineIndex, sentence) {
  if (!state.puzzlePool.length) return;
  const norm = sentence?.trim().normalize("NFC");
  state.puzzlePool = state.puzzlePool.filter((p) => {
    if (lineIndex != null && p.lineIndex === lineIndex) return false;
    if (norm && p.sentence.trim().normalize("NFC") === norm) return false;
    return true;
  });
}

function syncFilterUI({ persist = true } = {}) {
  const enabled = $("#filter-sentences-enable").is(":checked");
  $("#filter-sentences-fields").toggleClass("hidden", !enabled);
  const advanced = $("#filter-advanced-enable").is(":checked");
  $("#filter-advanced-fields").toggleClass("hidden", !advanced);
  state.sentenceFilters = readSentenceFilters();
  updateFilterMatchCount();
  if (persist) schedulePersistSentenceFilters();
}

const TRASH_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>`;

function syncSliders() {
  const $lo = $("#zipf-lo");
  const $hi = $("#zipf-hi");
  if (!$lo.length || !$hi.length) return;
  let lo = +$lo.val();
  let hi = +$hi.val();
  if (lo > hi) {
    if (document.activeElement === $lo[0]) hi = lo;
    else lo = hi;
  }
  $lo.val(lo);
  $hi.val(hi);
  state.zipfLo = lo;
  state.zipfHi = hi;
  const $label = $("#slider-label");
  if ($label.length) {
    $label.text(lo === hi ? lo.toFixed(1) : `${lo.toFixed(1)} – ${hi.toFixed(1)}`);
  }
  const fill = $("#range-fill")[0];
  if (fill) updateRangeFill($lo[0], $hi[0], fill);
}

function clonePuzzle(puzzle) {
  return { ...puzzle, tokens: puzzle.tokens.map((t) => ({ ...t })) };
}

async function refreshAvailability() {
  await Promise.all(
    state.catalog.map(async (lang) => {
      try {
        const file = lang.file ?? sentenceFilename(lang.code, "wiki");
        await resolveDataUrl(file, { fallbacks: legacyFallbacks(lang.code, "wiki") });
        lang.available = true;
      } catch {
        lang.available = false;
      }
    })
  );
}

function withTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); }
    );
  });
}

async function refreshLearningData() {
  try {
    state.learning = await withTimeout(getLearningLanguages(), 4000, "getLearningLanguages");
    const allStats = await withTimeout(getAllStats(), 4000, "getAllStats");
    state.stats = Object.fromEntries(allStats.map((s) => [s.code, s]));
  } catch (err) {
    console.warn(err);
    if (!Array.isArray(state.learning)) state.learning = [];
    if (!state.stats || typeof state.stats !== "object") state.stats = {};
  }
}

function renderLangPick(lang, { selected = false, unavailable = false, onClick }) {
  const $card = $("<button>", {
    type: "button",
    class: `card lang-pick flex flex-col items-center gap-1.5 p-2.5 transition ${unavailable ? "unavailable opacity-45" : ""} ${selected ? "selected" : ""}`,
  });
  $card.append(flagEl(lang.country, "md"));
  $card.append($("<span>", { class: "text-[11px] font-semibold text-center", text: lang.label }));
  $card.on("click", onClick);
  return $card[0];
}

function statRow(code) {
  return state.stats[code] ?? { totalScore: 0, streak: 0, history: [] };
}

async function renderHome() {
  await refreshLearningData();
  const $list = $("#learning-list").empty();
  const sorted = [...state.learning].sort((a, b) => (a.addedAt ?? 0) - (b.addedAt ?? 0));
  $("#home-empty").toggleClass("hidden", sorted.length > 0);

  for (const entry of sorted) {
    const lang = catalogLang(entry.code) ?? entry;
    const st = statRow(entry.code);
    const soon = !lang.available;
    const $card = $(`
      <div class="card home-lang-card">
        <button type="button" class="home-lang-open flex items-center gap-4 p-4 text-left hover:opacity-90">
          <div class="flag-slot shrink-0"></div>
          <div class="min-w-0 flex-1">
            <p class="font-semibold">${lang.label ?? entry.label}${soon ? ' <span class="text-xs font-normal" style="color:var(--muted)">· coming soon</span>' : ""}</p>
            <p class="mt-1 text-xs" style="color:var(--muted)">
              ${st.totalScore ?? 0} total points · ${st.streak ?? 0} day streak
            </p>
          </div>
        </button>
        <button type="button" class="btn-remove-lang" aria-label="Remove language">×</button>
      </div>
    `);
    $card.find(".flag-slot").append(flagEl(lang.country ?? entry.country, "lg"));
    $card.find(".home-lang-open").on("click", () => openLanguageHub(lang));
    $card.find(".btn-remove-lang").on("click", async (e) => {
      e.stopPropagation();
      const name = lang.label ?? entry.label;
      if (!confirm(`Remove ${name} from your list? Stats, flashcards, and saved sentences for this language will be deleted on this device.`)) return;
      await removeLearningLanguage(entry.code);
      if (state.lang === entry.code) state.dataLoaded = false;
      await renderHome();
      showToast(`${name} removed.`);
    });
    $list.append($card);
  }
}

function renderHubChart() {
  const st = statRow(state.lang);
  const days = +$("#chart-range").val() || 7;
  const canvas = $("#hub-chart")[0];
  if (!canvas) return;
  renderScoreChart(canvas, st.history, days);
  attachChartHover(canvas, $("#chart-tooltip")[0]);
}

let chartResizeObserver;

function ensureChartObserver() {
  const wrap = document.querySelector("#screen-lang-hub .chart-wrap");
  if (!wrap || chartResizeObserver) return;
  chartResizeObserver = new ResizeObserver(() => {
    if ($("#screen-lang-hub").hasClass("active")) renderHubChart();
  });
  chartResizeObserver.observe(wrap);
}

function scheduleHubChart() {
  ensureChartObserver();
  requestAnimationFrame(() => {
    renderHubChart();
    requestAnimationFrame(renderHubChart);
  });
}

function hubLangAvailable() {
  return catalogLang(state.lang)?.available ?? false;
}

async function renderLangHub() {
  const st = statRow(state.lang);
  const available = hubLangAvailable();
  const [dueCount, activeCount] = await Promise.all([
    countDueReviews(state.lang),
    countActiveReviews(state.lang),
  ]);
  $("#hub-title").text(state.langLabel);
  $("#hub-flag").empty().append(flagEl(state.country, "md"));
  $("#hub-score").text(st.totalScore ?? 0);
  $("#hub-streak").text(st.streak ?? 0);
  $("#hub-coming-soon").toggleClass("hidden", available);
  $(".hub-tile").not("#btn-mode-foundations, #btn-mode-saved, #btn-mode-revisit, #btn-mode-word-lookup, #btn-mode-articles, #btn-mode-conjugator").toggleClass("disabled", !available);
  $("#btn-mode-conjugator").toggleClass("hidden", !conjugationsAvailable(state.lang));
  $("#btn-mode-revisit").toggleClass("disabled", activeCount === 0);
  $("#revisit-due-desc").text(
    activeCount
      ? `${dueCount} due · ${activeCount} in review bank`
      : "Mistakes and hard words appear here for spaced review"
  );
  if (available) scheduleHubChart();
}

async function ensureCorpusStatsForLoaded(lang, corpus, byteLength) {
  const sentenceCount = state.sentences.length;
  const fingerprint = corpusFingerprint(lang.code, corpus, byteLength || 0, sentenceCount);
  const cacheId = corpusStatsId(lang.code, corpus);

  let stats = state.corpusStats;
  if (statsMatchFingerprint(stats, fingerprint, sentenceCount)) {
    annotateSentencesFromStats(state.sentences, stats);
    stats.fingerprint = fingerprint;
    stats.statsVersion = CORPUS_STATS_VERSION;
    state.corpusStats = stats;
    try {
      await saveCachedCorpusStats({ ...stats, id: cacheId });
    } catch {
      /* ignore */
    }
    return stats;
  }

  try {
    const cached = await getCachedCorpusStats(cacheId);
    if (cached && statsMatchFingerprint(cached, fingerprint, sentenceCount)) {
      annotateSentencesFromStats(state.sentences, cached);
      cached.fingerprint = fingerprint;
      state.corpusStats = cached;
      return cached;
    }
  } catch {
    /* ignore cache read errors */
  }

  setLoadProgress(92, `Indexing ${sentenceCount.toLocaleString()} sentences…`);
  await new Promise((r) => requestAnimationFrame(r));
  stats = buildCorpusStatsFromSentences(
    state.sentences,
    lang.code,
    state.zipfDict,
    state.lemmaMap,
    corpus,
    state.lemmaZipf,
    state.senseZipf
  );
  stats.fingerprint = fingerprint;
  stats.id = cacheId;
  state.corpusStats = stats;
  try {
    await saveCachedCorpusStats(stats);
  } catch {
    /* quota / private mode — still usable in memory */
  }
  return stats;
}

async function ensureLanguageData(lang, { corpus = state.corpus || "wiki", force = false } = {}) {
  if (state.dataLoaded && state.lang === lang.code && state.corpus === corpus && !force) return;
  showScreen("screen-loading");
  setLoadProgress(5, `Loading ${lang.label}…`);
  const sourceFile = sentenceFilename(lang.code, corpus);
  const [zipfDict, lemmaMap, sentResult, skipped, sets, wordExposure, taggedAvail, seenSenses] = await Promise.all([
    loadZipfDict(lang.code),
    loadLemmaMap(lang.code),
    resolveDataUrl(sourceFile, { fallbacks: legacyFallbacks(lang.code, corpus) })
      .then((url) => streamAllSentences(url, setLoadProgress)),
    getSkippedSet(lang.code),
    getFlashcardSets(lang.code),
    getWordExposureMap(lang.code),
    taggedCorpusAvailable(lang.code, corpus),
    getSeenSenseKeySet(lang.code),
  ]);
  const { lines, lang: detected, byteLength } = sentResult;
  if (!lines.length) throw new Error(`No sentences in ${sourceFile}. Populate the ${corpus} file to practice.`);
  state.langLabel = lang.label;
  state.country = lang.country;
  state.lang = detected ?? lang.code;
  state.corpus = corpus;
  state.sourceFile = sourceFile;
  state.zipfDict = zipfDict;
  state.lemmaMap = lemmaMap;
  state.corpusStats = null;
  state.sentences = lines;
  state.vocabSet = buildVocabSet(lines);
  state.skippedSet = skipped;
  state.wordExposure = wordExposure;
  state.flashcardSets = sets;
  state.seenSenseKeys = seenSenses;
  state.taggedAvailable = taggedAvail;
  state.taggedData = null;
  state.lemmaZipf = null;
  state.senseZipf = null;
  state.senseMeta = null;
  state.dataLoaded = true;

  if (taggedAvail) {
    setLoadProgress(88, "Loading tagged corpus…");
    try {
      const tagged = await loadTaggedCorpus(lang.code, corpus, { onProgress: setLoadProgress });
      if (tagged) {
        state.taggedData = tagged;
        state.lemmaZipf = tagged.lemmaZipf;
        state.senseZipf = tagged.senseZipf;
        state.senseMeta = tagged.senseMeta || null;
        annotateSentencesWithTags(state.sentences, tagged);
      }
    } catch (err) {
      console.warn("Tagged corpus load failed", err);
    }
  }

  try {
    state.sensesInventory = await loadSensesInventory(lang.code);
  } catch {
    state.sensesInventory = null;
  }

  await ensureCorpusStatsForLoaded(lang, corpus, byteLength);
  await refreshBlockedWordKeys();
  applyCorpusStatsToFiltersUI({ resetToBounds: true });
  await applyPersistedSentenceFilters(lang.code, corpus);
  renderPosFilterGrid();
  syncFilterUI({ persist: false });
  setLoadProgress(100, `Ready — ${lines.length.toLocaleString()} sentences`);
}

async function openLanguageHub(lang) {
  const catalog = catalogLang(lang.code) ?? lang;
  state.lang = catalog.code;
  state.langLabel = catalog.label;
  state.country = catalog.country;
  state.corpus = "wiki";
  applyTheme(catalog.code);
  try {
    if (catalog.available) {
      await ensureLanguageData(catalog);
    } else {
      state.dataLoaded = false;
    }
    await refreshLearningData();
    renderLangHub();
    showScreen("screen-lang-hub");
  } catch (err) {
    $("#error-message").text(err.message || String(err));
    showScreen("screen-error");
  }
}

async function loadAboutPage() {
  const md = await fetchMarkdown(assetUrl("content/about.md"));
  $("#about-content").html(md ? renderMarkdown(md) : "<p>Could not load about page.</p>");
}

async function openFoundationsPage() {
  const md = await fetchMarkdown(assetUrl(`foundations/${state.lang}.md`));
  $("#foundations-flag").empty().append(flagEl(state.country, "md"));
  $("#foundations-content").html(
    md ? renderMarkdown(md) : `<p>Foundations for ${state.langLabel} aren't written yet.</p>`
  );
  showScreen("screen-foundations");
}

function renderAddLangGrid() {
  const query = ($("#add-lang-search").val() || "").trim().toLowerCase();
  const learningCodes = new Set(state.learning.map((l) => l.code));
  const $grid = $("#add-lang-grid").empty();
  const langs = state.catalog.filter((lang) => {
    if (learningCodes.has(lang.code)) return false;
    if (!query) return true;
    return lang.label.toLowerCase().includes(query) || lang.code.toLowerCase().includes(query);
  });
  for (const lang of langs) {
    $grid.append(
      renderLangPick(lang, {
        unavailable: !lang.available,
        onClick: async () => {
          await addLearningLanguage({
            code: lang.code,
            label: lang.label,
            country: lang.country,
            file: lang.file,
          });
          await renderHome();
          closeModal("modal-add-lang");
          if (!lang.available) {
            showToast(`${lang.label} added — foundations ready, sentences coming soon.`);
          }
        },
      })
    );
  }
  if (!langs.length) {
    $grid.append($('<p class="col-span-3 py-4 text-center text-sm" style="color:var(--muted)">No languages match.</p>'));
  }
}

async function ensureFullVocab() {
  if (state.fullVocabLoaded) return;
  const url = await resolveDataUrl(state.sourceFile);
  const { lines } = await streamAllSentences(url);
  state.vocabSet = buildVocabSet(lines);
  state.fullVocabLoaded = true;
}

function validateFlashcardWord(word) {
  if (!isKnownWord(word, state.lang, state.zipfDict, state.lemmaMap, state.vocabSet)) {
    throw new Error("Word not found in vocabulary. Pick a word from practice sentences or the dictionary.");
  }
}

function openFlashcardSetModal(mode = "create", { setId = null, name = "" } = {}) {
  state.flashcardSetModalMode = mode;
  state.editingSetId = setId;
  $("#flashcard-set-modal-title").text(mode === "edit" ? "Rename Set" : "New Set");
  $("#flashcard-set-name-input").val(name);
  openModal("modal-flashcard-set");
  setTimeout(() => $("#flashcard-set-name-input").trigger("focus"), 50);
}

async function saveFlashcardSetModal() {
  const name = $("#flashcard-set-name-input").val().trim();
  if (!name) return showToast("Enter a set name.");
  try {
    if (state.flashcardSetModalMode === "edit" && state.editingSetId) {
      const set = state.flashcardSets.find((s) => s.id === state.editingSetId);
      if (!set) throw new Error("Set not found.");
      set.name = name;
      set.updatedAt = Date.now();
      await saveFlashcardSet(set);
      showToast("Set renamed.");
    } else {
      await createFlashcardSet(state.lang, name);
      state.flashcardSets = await getFlashcardSets(state.lang);
      if (state.pendingWordAfterSetCreate) {
        const word = state.pendingWordAfterSetCreate;
        state.pendingWordAfterSetCreate = null;
        state.pendingFlashcardWord = null;
        const newSet = [...state.flashcardSets].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))[0];
        if (newSet) {
          try {
            validateFlashcardWord(word);
          } catch {
            await ensureFullVocab();
            validateFlashcardWord(word);
          }
          await addWordToSet(newSet.id, word);
          showToast("Set created and word added.");
        } else {
          showToast("Set created.");
        }
      } else {
        showToast("Set created.");
      }
    }
    closeModal("modal-flashcard-set");
    state.flashcardSets = await getFlashcardSets(state.lang);
    renderFlashcardList();
  } catch (err) {
    showToast(err.message);
  }
}

function renderFlashcardHeader() {
  $("#flash-flag").empty().append(flagEl(state.country, "md"));
}

function readQuestionLimit() {
  const n = +$("#question-limit").val();
  return n > 0 ? n : 0;
}

function populateCorpusSelect() {
  const $sel = $("#corpus-select").empty();
  const options = catalogLang(state.lang)?.corpora ?? CORPUS_OPTIONS.map((c) => ({
    id: c.id,
    label: c.label,
    file: sentenceFilename(state.lang, c.id),
  }));
  for (const c of options) {
    $sel.append($("<option>", { value: c.id, text: c.label }));
  }
  $sel.val(state.corpus || "wiki");
  enhanceSelectField($sel[0]);
}

function renderPracticeMenu() {
  renderMenuHeader();
  populateCorpusSelect();
  const mode = state.practiceMode;
  const isFlashcard = mode === "flashcard";
  const isArticle = mode === "article";
  $("#menu-corpus-pick").toggleClass("hidden", isArticle);
  $("#menu-session-opts").toggleClass("hidden", isArticle);
  $("#menu-zipf-section").toggleClass("hidden", isFlashcard);
  $("#menu-sentence-filters").toggleClass("hidden", isArticle);
  $("#menu-flashcard-section").toggleClass("hidden", !isFlashcard);
  $("#menu-article-pick").toggleClass("hidden", !isArticle);
  $("#menu-presets-heading").text(isArticle ? "Blank word difficulty" : "Word difficulty");
  if (isFlashcard && state.activeFlashcardSet) {
    $("#flashcard-set-title").text(state.activeFlashcardSet.name);
  }
  if (isArticle && state.activeArticle) {
    $("#menu-article-title").text(state.activeArticle.title);
  }
  renderPresets();
  updateFilterMatchCount();
}

async function switchCorpus(corpusId) {
  if (!corpusId || corpusId === state.corpus) return;
  const lang = catalogLang(state.lang);
  if (!lang) return;
  const previous = state.corpus;
  try {
    await ensureLanguageData(lang, { corpus: corpusId, force: true });
    renderPracticeMenu();
    showScreen("screen-menu");
  } catch (err) {
    state.corpus = previous;
    $("#corpus-select").val(previous);
    showToast(err.message || String(err));
    try {
      await ensureLanguageData(lang, { corpus: previous, force: true });
      renderPracticeMenu();
      showScreen("screen-menu");
    } catch {
      showScreen("screen-lang-hub");
    }
  }
}

function openFlashcardPracticeMenu(set) {
  if (!set?.words.length) {
    showToast("Add words to this set first.");
    return;
  }
  state.activeFlashcardSet = set;
  state.practiceMode = "flashcard";
  state.levelName = "Flashcards";
  applyCorpusStatsToFiltersUI();
  renderPracticeMenu();
  showScreen("screen-menu");
}

async function openFlashcardEdit(setId) {
  const set = state.flashcardSets.find((s) => s.id === setId);
  if (!set) return;
  state.editingFlashcardSet = set;
  $("#edit-set-heading").text(set.name);
  $("#edit-set-name").val(set.name);
  $("#edit-flag").empty().append(flagEl(state.country, "md"));
  renderFlashcardEditWords();
  showScreen("screen-flashcard-edit");
  ensureFullVocab().catch(() => {});
}

function renderFlashcardEditWords() {
  const set = state.editingFlashcardSet;
  if (!set) return;
  const $list = $("#edit-word-list").empty();
  if (!set.words.length) {
    $list.append(`<li class="text-sm italic py-2" style="color:var(--muted)">No words yet.</li>`);
    return;
  }
  for (const entry of set.words) {
    const $li = $(`
      <li class="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-sm" style="background:color-mix(in srgb,var(--border) 30%,transparent)">
        <span class="edit-word-text"></span>
        <button type="button" class="btn-ghost px-2 py-0.5 text-xs btn-edit-remove-word">Remove</button>
      </li>
    `);
    $li.find(".edit-word-text").text(entry.word);
    $list.append($li);
  }
  $(".btn-edit-remove-word").on("click", async function () {
    const word = $(this).closest("li").find(".edit-word-text").text();
    await removeWordFromSet(set.id, word);
    state.flashcardSets = await getFlashcardSets(state.lang);
    state.editingFlashcardSet = state.flashcardSets.find((s) => s.id === set.id) ?? null;
    if (!state.editingFlashcardSet) {
      showScreen("screen-flashcards");
      renderFlashcardList();
      return;
    }
    renderFlashcardEditWords();
    showToast("Word removed.");
  });
}

function downloadFlashcardSet(set) {
  const blob = new Blob([exportSet(set)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${set.name.replace(/[^\w\s-]/g, "").trim() || "flashcards"}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function flashcardSetMatchesSearch(set, query) {
  return !query || set.name.toLowerCase().includes(query);
}

function appendFlashcardSetRow($parent, set, { builtin = false } = {}) {
  const safeName = $("<span>").text(set.name).html();
  const rounds = Math.min(PRESET_ROUND_GOAL, set.successfulRounds ?? 0);
  const pct = Math.round((rounds / PRESET_ROUND_GOAL) * 100);
  if (builtin) {
    const icon = iconForPreset(set);
    const $card = $(`
      <button type="button" class="preset-map-card card" data-id="${set.id}">
        <span class="preset-map-icon" aria-hidden="true">${icon}</span>
        <span class="preset-map-name"></span>
        <span class="preset-map-meta">${set.words.length} words</span>
        <span class="preset-map-rounds">${rounds}/${PRESET_ROUND_GOAL} rounds</span>
        <span class="preset-map-bar"><span class="preset-map-fill" style="width:${pct}%"></span></span>
      </button>
    `);
    $card.find(".preset-map-name").text(set.name);
    $parent.append($card);
    return;
  }
  const $row = $(`
    <div class="card flashcard-set-row p-4">
      <div class="flex items-center justify-between gap-3">
        <div class="min-w-0 flex-1">
          <p class="font-semibold truncate">${safeName}</p>
          <p class="mt-1 text-xs" style="color:var(--muted)">${set.words.length} word${set.words.length === 1 ? "" : "s"} · Your set</p>
        </div>
        <div class="flex shrink-0 flex-wrap justify-end gap-2">
          <button type="button" class="btn-ghost px-3 py-1.5 text-xs btn-edit-set" data-id="${set.id}">Edit</button>
          <button type="button" class="btn-ghost px-3 py-1.5 text-xs btn-practice-set" data-id="${set.id}">Practice</button>
          <button type="button" class="btn-ghost px-2 py-1 text-xs btn-del-set" data-id="${set.id}">Delete</button>
        </div>
      </div>
    </div>
  `);
  $parent.append($row);
}

function renderFlashcardList() {
  renderFlashcardHeader();
  const query = ($("#flashcard-set-search").val() || "").trim().toLowerCase();
  const tab = state.flashcardListTab || "yours";
  $(".fc-tab").removeClass("is-active");
  $(`.fc-tab[data-fc-tab="${tab}"]`).addClass("is-active");
  $("#flashcard-tab-yours").toggleClass("hidden", tab !== "yours");
  $("#flashcard-tab-presets").toggleClass("hidden", tab !== "presets");

  const userSets = state.flashcardSets.filter((s) => !s.builtinId && flashcardSetMatchesSearch(s, query));
  const builtinSets = state.flashcardSets.filter((s) => s.builtinId && flashcardSetMatchesSearch(s, query));

  const $user = $("#flashcard-user-list").empty();
  $("#flashcard-user-empty").toggleClass("hidden", userSets.length > 0);
  for (const set of userSets) appendFlashcardSetRow($user, set);

  const $builtin = $("#flashcard-builtin-list").empty();
  if (!builtinSets.length) {
    $("#flashcard-builtin-empty")
      .removeClass("hidden")
      .text(query ? "No preset sets match your search." : "No preset sets loaded yet.");
  } else {
    $("#flashcard-builtin-empty").addClass("hidden");
    const $grid = $('<div class="preset-map-grid"></div>');
    for (const set of builtinSets) appendFlashcardSetRow($grid, set, { builtin: true });
    $builtin.append($grid);
  }

  $(".btn-edit-set").off("click").on("click", function () {
    openFlashcardEdit(this.dataset.id).catch((err) => showToast(err.message));
  });
  $(".btn-practice-set").off("click").on("click", function () {
    const set = state.flashcardSets.find((s) => s.id === this.dataset.id);
    openFlashcardPracticeMenu(set);
  });
  $(".preset-map-card").off("click").on("click", function () {
    const set = state.flashcardSets.find((s) => s.id === this.dataset.id);
    openFlashcardPracticeMenu(set);
  });
  $(".btn-del-set").off("click").on("click", async function () {
    if (!confirm("Delete this flashcard set?")) return;
    await deleteFlashcardSet(this.dataset.id);
    state.flashcardSets = await getFlashcardSets(state.lang);
    renderFlashcardList();
  });
}

function renderMenuHeader() {
  $("#menu-flag").empty().append(flagEl(state.country, "md"));
}

function renderPresets() {
  const $grid = $("#preset-grid").empty();
  const lo = state.zipfLo ?? ZIPF_MIN;
  const hi = state.zipfHi ?? 4.0;
  const $custom = $(`
    <div class="preset-tile preset-tile-custom card px-3 py-3 text-left">
      <div class="flex items-center justify-between gap-2">
        <span class="block text-sm font-semibold">Custom</span>
        <button type="button" class="btn-primary btn-custom-start px-3 py-1.5 text-xs">Start</button>
      </div>
      <div class="preset-chip-row mt-3"></div>
      <div class="range-wrap mt-3">
        <div class="range-track"></div>
        <div id="range-fill" class="range-fill"></div>
        <input id="zipf-lo" type="range" min="${ZIPF_MIN}" max="${ZIPF_MAX}" step="0.1" value="${lo}" />
        <input id="zipf-hi" type="range" min="${ZIPF_MIN}" max="${ZIPF_MAX}" step="0.1" value="${hi}" />
      </div>
      <div class="mt-1 flex justify-between text-xs" style="color:var(--muted)">
        <span>${ZIPF_MIN}</span>
        <span id="slider-label" class="font-mono">${(+lo).toFixed(1)} – ${(+hi).toFixed(1)}</span>
        <span>${ZIPF_MAX}</span>
      </div>
    </div>
  `);
  const $chips = $custom.find(".preset-chip-row");
  for (const preset of DIFFICULTY_PRESETS) {
    if (preset.name === "Expert") continue;
    const $chip = $(`<button type="button" class="preset-chip" title="${preset.desc}"></button>`);
    $chip.text(preset.name);
    $chip.on("click", () => {
      $("#zipf-lo").val(preset.lo);
      $("#zipf-hi").val(preset.hi);
      syncSliders();
      $chips.find(".preset-chip").removeClass("is-active");
      $chip.addClass("is-active");
    });
    $chips.append($chip);
  }
  $custom.find(".btn-custom-start").on("click", () => {
    syncSliders();
    state.sentenceFilters = readSentenceFilters();
    if (state.sentenceFilters.enabled && countMatchingSentences(state.corpusStats, state.sentenceFilters) === 0) {
      showToast("No sentences match these filters.");
      return;
    }
    if (state.practiceMode !== "article") state.practiceMode = "zipf";
    const match = DIFFICULTY_PRESETS.find(
      (p) => Math.abs(p.lo - state.zipfLo) < 0.05 && Math.abs(p.hi - state.zipfHi) < 0.05
    );
    startGame(state.zipfLo, state.zipfHi, match?.name || "Custom");
  });
  $custom.find("#zipf-lo, #zipf-hi").on("input", () => {
    syncSliders();
    $chips.find(".preset-chip").removeClass("is-active");
  });
  $grid.append($custom);
  syncSliders();
}

function renderAccentModal() {
  $("#accent-grid").empty();
  const chars = charsFor(state.lang);
  if (!chars.length) {
    $("#accent-grid").html(`<p class="col-span-5 text-sm" style="color:var(--muted)">No extra characters.</p>`);
  } else {
    for (const ch of chars) {
      const $btn = $("<button>", { type: "button", text: ch });
      $btn.on("click", () => { insertChar(ch); closeModal("modal-accents"); });
      $("#accent-grid").append($btn);
    }
  }
  const $grid = $("#command-card-grid").empty();
  for (const [cmd, ch] of ACCENT_COMMANDS) {
    const $card = $(`
      <button type="button" class="accent-cmd-card">
        <span class="accent-cmd-char"></span>
        <code class="accent-cmd-code"></code>
      </button>
    `);
    $card.find(".accent-cmd-char").text(ch);
    $card.find(".accent-cmd-code").text(cmd);
    $card.on("click", () => { insertChar(ch); closeModal("modal-accents"); });
    $grid.append($card);
  }
}

function updateGameProgress() {
  const $header = $("#game-header");
  const $wrap = $("#game-progress");
  if (!state.questionLimit) {
    $header.removeClass("limited");
    $wrap.addClass("hidden");
    return;
  }
  $header.addClass("limited");
  $wrap.removeClass("hidden");
  const done = state.questionsAnswered;
  const total = state.questionLimit;
  const pct = Math.min(100, Math.round((done / total) * 100));
  $("#game-progress-fill").css("width", `${pct}%`);
  $("#game-progress-label").text(`${done} / ${total}`);
}

function isReviewBankSession() {
  return state.practiceMode === "revisit" || state.practiceMode === "browse";
}

function renderGameChrome() {
  const $badge = $("#game-badge").empty();
  $badge.append(flagEl(state.country, "sm"));
  let modeLabel = state.levelName;
  if (state.practiceMode === "flashcard" && state.activeFlashcardSet) {
    modeLabel = state.activeFlashcardSet.name;
  } else if (state.practiceMode === "article" && state.activeArticle) {
    modeLabel = state.activeArticle.title;
  } else if (state.practiceMode === "revisit") {
    modeLabel = "Revisit";
  } else if (state.practiceMode === "browse") {
    modeLabel = "Browse";
  }
  $badge.append($("<span>", { text: `${state.langLabel} · ${modeLabel}` }));
  const isArticle = state.practiceMode === "article";
  $("#article-header").toggleClass("hidden", !isArticle);
  $(".game-actions").toggleClass("hidden", isArticle);
  if (isArticle && state.puzzle) {
    $("#article-title").text(state.puzzle.articleTitle ?? state.activeArticle?.title ?? "");
    $("#article-context").text(state.puzzle.paragraphContext ?? "");
  }
  $("#game-score").text(String(state.sessionPoints));
  updateGameProgress();
  if (isReviewBankSession() && state.revisitQueue.length) {
    const cur = state.revisitQueue[state.revisitIndex];
    if (state.practiceMode === "browse") {
      $("#review-banner").removeClass("hidden").text(
        `Browse ${state.revisitIndex + 1} of ${state.revisitQueue.length} · practice only`
      );
    } else {
      const prog = cur ? ` · ${cur.correctCount ?? 0}/${LEARNED_THRESHOLD} mastered` : "";
      $("#review-banner").removeClass("hidden").text(
        `Revisit ${state.revisitIndex + 1} of ${state.revisitQueue.length}${prog}`
      );
    }
  } else {
    $("#review-banner").toggleClass("hidden", !state.inReview).text(
      state.inReview ? `Review ${state.reviewIndex + 1} of ${state.reviewSessionTotal}` : ""
    );
  }
  if (state.awaitingContinue) {
    if (state.practiceMode === "browse") {
      $("#game-hint-text").text("Press Enter To Continue");
    } else {
      const hintNote = state.lastHintCount ? ` (${state.lastHintCount} hint${state.lastHintCount > 1 ? "s" : ""} used)` : "";
      $("#game-hint-text").text(`${state.lastPoints} pts${hintNote}! Press Enter To Continue`);
    }
  }
  else if (state.revealed) $("#game-hint-text").text("Press Enter To Continue");
  else $("#game-hint-text").text("Press Enter To Check · ? For Hint · Highlight Any Word");
  const $play = $("#btn-play-sentence");
  const $accents = $("#btn-accents");
  const showPlay = state.enableTts && state.puzzle?.sentence;
  if (isMobileUi()) {
    $play.toggleClass("hidden", !showPlay).attr("title", "Pronounce").attr("aria-label", "Pronounce");
    $accents.addClass("hidden");
  } else {
    $play.toggleClass("hidden", !showPlay).attr("title", "Play sentence").attr("aria-label", "Play sentence");
    $accents.removeClass("hidden");
  }
}

function syncFromRaw() {
  if (!state.puzzle) return;
  const remaining = state.puzzle.answer.length - state.revealedLen;
  state.rawTyped = collapseSlashCommands(state.rawTyped);
  state.typed = state.rawTyped;
  if (!hasPendingSlash(state.rawTyped) && state.typed.length > remaining) {
    state.rawTyped = state.rawTyped.slice(0, remaining);
    state.typed = state.rawTyped;
  }
  $("#blank-input").val(state.rawTyped);
  refreshSentence();
}

function updateTypingFeedback($slot, typed, answer, revealedLen) {
  $slot.removeClass("blank-hot blank-cold");
  if (!typed) return;
  const guess = answer.slice(0, revealedLen) + typed;
  $slot.addClass(prefixMatches(guess, answer) ? "blank-hot" : "blank-cold");
}

function isMobileUi() {
  return window.matchMedia("(max-width: 768px)").matches;
}

function fillWordSpans($el, text) {
  $el.empty();
  if (!text) return;
  const parts = text.match(/\S+|\s+/g) || [];
  for (const part of parts) {
    if (/^\s+$/.test(part)) $el.append(document.createTextNode(part));
    else {
      const $span = $("<span>", { class: "word-tap", text: part });
      $el.append($span);
    }
  }
}

function refreshSentence() {
  const puzzle = state.puzzle;
  if (!puzzle) return;
  const { typed, revealedLen, revealed, rawTyped } = state;
  const answer = puzzle.answer;
  const blank = puzzle.tokens[puzzle.blankIndex];
  const $line = $("#sentence-line");
  const before = puzzle.sentence.slice(0, blank.start);
  const after = puzzle.sentence.slice(blank.end);
  if (isMobileUi()) {
    fillWordSpans($("#sent-before"), before);
    fillWordSpans($("#sent-after"), after);
  } else {
    $("#sent-before").text(before);
    $("#sent-after").text(after);
  }
  const $slot = $("#blank-slot");
  const minSlotW = isMobileUi() ? Math.max(measureWordWidth(answer, $line[0]) + 6, 52) : measureWordWidth(answer, $line[0]) + 6;
  $slot.css("width", `${minSlotW}px`);
  const $input = $("#blank-input");
  let $rev = $slot.find(".revealed-answer");
  if (revealed || state.awaitingContinue) {
    $("#hint-part").text("");
    $input.addClass("hidden").val("").prop("disabled", true);
    if (!$rev.length) { $rev = $("<span>", { class: "revealed-answer" }); $slot.append($rev); }
    $rev.text(answer).css("color", state.awaitingContinue ? "var(--hot)" : "#c23b3b");
    if (isMobileUi()) $rev.addClass("word-tap");
    else $rev.removeClass("word-tap");
    $slot.removeClass("blank-hot blank-cold");
  } else {
    $rev.remove();
    const displayText = answer.slice(0, revealedLen) + (typed || "");
    $input.removeClass("hidden").css("width", `${Math.max(measureWordWidth(displayText, $line[0]), 4) + 4}px`).val(rawTyped).prop("disabled", false);
    $("#hint-part").text(answer.slice(0, revealedLen));
    updateTypingFeedback($slot, typed, answer, revealedLen);
    $input[0]?.focus();
  }
}

function insertChar(ch) {
  if (state.revealed || state.awaitingContinue || !state.puzzle) return;
  const maxRaw = maxRawLength(state.puzzle.answer.length - state.revealedLen);
  if (state.rawTyped.length < maxRaw) { state.rawTyped += ch; syncFromRaw(); }
  $("#blank-input").focus();
}

function giveHint() {
  if (state.revealed || state.awaitingContinue || !state.puzzle) return;
  const answer = state.puzzle.answer;
  let locked = state.revealedLen;
  const typed = state.typed;
  if (typed && !prefixMatches(typed, answer.slice(locked))) return;
  locked += typed.length;
  if (locked >= answer.length) return;
  state.hintedAt.push(locked);
  state.revealedLen = locked + 1;
  state.rawTyped = "";
  state.typed = "";
  refreshSentence();
}

async function onCorrect() {
  if (state.awaitingContinue || state.revealed) return;
  state.awaitingContinue = true;
  stopSpeech();

  if (state.practiceMode === "browse") {
    renderGameChrome();
    refreshSentence();
    if (state.enableTts) {
      feedbackCorrect(state.puzzle.sentence, state.lang).catch(() => {});
    }
    return;
  }

  const pts = pointsForAnswer(
    state.puzzle.answer,
    state.levelName,
    state.lang,
    state.zipfDict,
    state.lemmaMap,
    state.hintedAt,
    state.answerTranslation
  );
  state.lastPoints = pts;
  state.lastHintCount = state.hintedAt.length;
  state.sessionPoints += pts;
  bounceScore($("#score-pill")[0]);
  fireConfetti(confettiColors(state.lang));
  state.stats[state.lang] = await recordScore(state.lang, pts);
  const reviewRow = await logSentenceAttempt({
    langCode: state.lang,
    sentence: state.puzzle.sentence,
    lineIndex: state.puzzle.lineIndex,
    answer: state.puzzle.answer,
    typed: state.puzzle.answer,
    correct: true,
    hintCount: state.hintedAt.length,
    lemma: state.puzzle.lemma || "",
    sense: state.puzzle.sense || "",
  });
  if (state.practiceMode === "revisit" && state.revisitQueue[state.revisitIndex] && reviewRow) {
    state.revisitQueue[state.revisitIndex] = reviewRow;
  }
  await refreshBlockedWordKeys();
  renderGameChrome();
  refreshSentence();
  if (state.enableTts) {
    // Speak the completed sentence only; advancing cuts it off via stopSpeech/epoch.
    const sentence = state.puzzle.sentence;
    const lang = state.lang;
    feedbackCorrect(sentence, lang).catch(() => {});
  }
}

async function onWrong() {
  if (state.practiceMode === "browse") {
    state.revealed = true;
    renderGameChrome();
    refreshSentence();
    if (state.enableTts) feedbackWrong();
    return;
  }

  if (
    !state.inReview &&
    !isReviewBankSession() &&
    state.puzzle &&
    !puzzleIsSkipped(state.puzzle, state.skippedSet)
  ) {
    state.wrongQueue.push(clonePuzzle(state.puzzle));
  }
  const guess = state.puzzle.answer.slice(0, state.revealedLen) + state.typed;
  const reviewRow = await logSentenceAttempt({
    langCode: state.lang,
    sentence: state.puzzle.sentence,
    lineIndex: state.puzzle.lineIndex,
    answer: state.puzzle.answer,
    typed: guess,
    correct: false,
    hintCount: state.hintedAt.length,
    lemma: state.puzzle.lemma || "",
    sense: state.puzzle.sense || "",
  });
  if (state.practiceMode === "revisit" && state.revisitQueue[state.revisitIndex]) {
    state.revisitQueue[state.revisitIndex] = reviewRow;
  }
  await refreshBlockedWordKeys();
  state.revealed = true;
  renderGameChrome();
  refreshSentence();
  if (state.enableTts) feedbackWrong();
}

function submitAnswer() {
  if (!state.puzzle) return;
  if (state.awaitingContinue || state.revealed) { advanceQuestion(); return; }
  const guess = state.puzzle.answer.slice(0, state.revealedLen) + state.typed;
  if (wordsMatch(guess, state.puzzle.answer)) onCorrect();
  else onWrong();
}

function shouldStartReview() {
  return !state.inReview && state.questionsSinceReview >= state.reviewInterval && state.wrongQueue.length > 0;
}

function startReviewBatch() {
  state.inReview = true;
  state.reviewItems = state.wrongQueue
    .map(clonePuzzle)
    .filter((p) => !puzzleIsSkipped(p, state.skippedSet));
  state.reviewSessionTotal = state.reviewItems.length;
  state.wrongQueue = [];
  state.reviewIndex = 0;
  state.questionsSinceReview = 0;
  if (!state.reviewItems.length) {
    state.inReview = false;
    startNormalRound();
    return;
  }
  loadReviewPuzzle();
}

function loadReviewPuzzle() {
  while (
    state.reviewIndex < state.reviewItems.length &&
    puzzleIsSkipped(state.reviewItems[state.reviewIndex], state.skippedSet)
  ) {
    state.reviewItems.splice(state.reviewIndex, 1);
    state.reviewSessionTotal = Math.max(state.reviewIndex, state.reviewItems.length);
  }
  if (state.reviewIndex >= state.reviewItems.length) {
    state.inReview = false;
    state.reviewItems = [];
    startNormalRound();
    return;
  }
  resetInput();
  state.puzzle = state.reviewItems[state.reviewIndex];
  trackPuzzleShown(state.puzzle).catch(() => {});
  loadTranslation();
}

function resetInput() {
  stopSpeech();
  state.rawTyped = "";
  state.typed = "";
  state.revealedLen = 0;
  state.hintedAt = [];
  state.revealed = false;
  state.awaitingContinue = false;
  $("#blank-slot").find(".revealed-answer").remove();
  $("#blank-input").removeClass("hidden").val("").prop("disabled", false);
  $("#blank-slot").removeClass("blank-hot blank-cold");
}

async function loadTranslation() {
  state.translation = "…";
  state.answerTranslation = "";
  $("#game-translation").text(state.translation);
  refreshSentence();
  renderGameChrome();
  try {
    const answer = state.puzzle?.answer ?? "";
    const [sentenceTr, wordTr] = await Promise.all([
      translateText(state.puzzle.sentence, state.lang, state.nativeLang, state.translationCache),
      answer
        ? translateText(answer, state.lang, state.nativeLang, state.translationCache).catch(() => "")
        : Promise.resolve(""),
    ]);
    state.translation = sentenceTr;
    state.answerTranslation = wordTr || "";
  } catch {
    state.translation = "(translation unavailable)";
    state.answerTranslation = "";
  }
  $("#game-translation").text(state.translation);
  await updateFavoriteButton();
}

let advancingQuestion = false;

async function advanceQuestion() {
  if (advancingQuestion) return;
  advancingQuestion = true;
  stopSpeech();
  try {
  if (isReviewBankSession()) {
    if (state.awaitingContinue) {
      state.revisitIndex += 1;
      resetInput();
      await loadRevisitPuzzle();
      return;
    }
    if (state.revealed) {
      resetInput();
      loadTranslation();
      return;
    }
    return;
  }
  if (state.inReview) {
    if (state.awaitingContinue) {
      state.reviewIndex += 1;
      loadReviewPuzzle();
      return;
    }
    if (state.revealed) { resetInput(); loadTranslation(); return; }
    return;
  }
  if (state.awaitingContinue || state.revealed) {
    if (state.awaitingContinue) state.questionsAnswered += 1;
    updateGameProgress();
    if (state.questionLimit && state.questionsAnswered >= state.questionLimit) {
      endPracticeSession();
      return;
    }
    resetInput();
    bumpQuestionCount();
  }
  } finally {
    advancingQuestion = false;
  }
}

async function endPracticeSession() {
  showToast(`Session complete — ${state.sessionPoints} points.`);
  if (state.practiceMode === "flashcard" && state.activeFlashcardSet?.id) {
    try {
      const set = state.flashcardSets.find((s) => s.id === state.activeFlashcardSet.id)
        ?? state.activeFlashcardSet;
      const next = Math.min(PRESET_ROUND_GOAL, (set.successfulRounds ?? 0) + 1);
      set.successfulRounds = next;
      set.updatedAt = Date.now();
      await saveFlashcardSet(set);
      state.activeFlashcardSet = set;
      state.flashcardSets = await getFlashcardSets(state.lang);
      if (set.builtinId) {
        showToast(`Round ${next}/${PRESET_ROUND_GOAL} on ${set.name}.`);
      }
    } catch {
      /* ignore */
    }
  }
  if (state.practiceMode === "article") {
    renderArticleList();
    showScreen("screen-articles");
    return;
  }
  if (state.practiceMode === "flashcard") {
    renderFlashcardList();
    showScreen("screen-flashcards");
    return;
  }
  renderPracticeMenu();
  showScreen("screen-menu");
}

function bumpQuestionCount() {
  state.questionsSinceReview += 1;
  if (shouldStartReview()) startReviewBatch();
  else startNormalRound();
}

async function loadRevisitPuzzle() {
  if (state.revisitIndex >= state.revisitQueue.length) {
    showToast(state.practiceMode === "browse" ? "Browse complete." : "Revisit session complete.");
    await refreshBlockedWordKeys();
    await openReviewScreen();
    return;
  }
  while (
    state.revisitIndex < state.revisitQueue.length &&
    puzzleIsSkipped(puzzleFromReview(state.revisitQueue[state.revisitIndex]), state.skippedSet)
  ) {
    state.revisitIndex += 1;
  }
  if (state.revisitIndex >= state.revisitQueue.length) {
    showToast(state.practiceMode === "browse" ? "Browse complete." : "Revisit session complete.");
    await refreshBlockedWordKeys();
    await openReviewScreen();
    return;
  }
  state.puzzle = puzzleFromReview(state.revisitQueue[state.revisitIndex]);
  await trackPuzzleShown(state.puzzle);
  await loadTranslation();
}

function formatReviewDue(nextReviewAt) {
  const now = Date.now();
  const t = nextReviewAt ?? 0;
  if (t <= now) return "Due now";
  const ms = t - now;
  const hours = Math.round(ms / (60 * 60 * 1000));
  if (hours < 48) return `In ${Math.max(1, hours)}h`;
  const days = Math.round(hours / 24);
  return `In ${days}d`;
}

async function openReviewScreen() {
  state.reviewBankTab = state.reviewBankTab || "active";
  const [active, mastered] = await Promise.all([
    getActiveReviews(state.lang, { skippedSet: state.skippedSet }),
    getLearnedReviews(state.lang, { skippedSet: state.skippedSet }),
  ]);
  const now = Date.now();
  const due = active.filter((r) => (r.nextReviewAt ?? 0) <= now);
  $("#review-flag").empty().append(flagEl(state.country, "md"));
  $("#btn-review-due")
    .prop("disabled", due.length === 0)
    .toggleClass("opacity-50", due.length === 0)
    .find(".review-action-count")
    .text(due.length ? `${due.length} due` : "None due");
  $("#btn-review-browse")
    .prop("disabled", active.length === 0)
    .toggleClass("opacity-50", active.length === 0)
    .find(".review-action-count")
    .text(`${active.length} active`);
  $("#btn-review-mastered-practice")
    .prop("disabled", mastered.length === 0)
    .toggleClass("opacity-50", mastered.length === 0)
    .find(".review-action-count")
    .text(`${mastered.length} mastered`);

  $(".review-bank-tab").removeClass("active");
  $(`.review-bank-tab[data-tab="${state.reviewBankTab}"]`).addClass("active");
  renderReviewBankList(state.reviewBankTab === "mastered" ? mastered : active, state.reviewBankTab);
  showScreen("screen-review");
}

function renderReviewBankList(rows, tab) {
  const $list = $("#review-bank-list").empty();
  const now = Date.now();
  $("#review-bank-empty").toggleClass("hidden", rows.length > 0);
  $("#review-bank-empty").text(
    tab === "mastered"
      ? "No mastered sentences yet. Finish review streaks to fill this list."
      : "No sentences in your review bank yet."
  );
  for (const row of rows) {
    const isDue = (row.nextReviewAt ?? 0) <= now;
    const blank = row.answer ? ` (${row.answer})` : "";
    const sense = row.lemma
      ? ` · ${row.lemma}${row.sense ? `/${row.sense}` : ""}`
      : "";
    const $row = $(`
      <div class="saved-row">
        <div class="min-w-0 flex-1">
          <p class="saved-row-text"></p>
          <p class="mt-1 text-xs" style="color:var(--muted)">
            <span class="font-semibold" style="color:${tab === "mastered" ? "var(--hot)" : isDue ? "var(--primary)" : "var(--muted)"}">${
              tab === "mastered" ? "Mastered" : formatReviewDue(row.nextReviewAt)
            }</span>
            · ${row.correctCount ?? 0}/5${blank}${sense}
          </p>
        </div>
        ${
          tab === "mastered"
            ? `<button type="button" class="btn-ghost shrink-0 px-2 py-1 text-xs btn-requeue-review" data-id="${row.id}">Review again</button>`
            : ""
        }
      </div>
    `);
    $row.find(".saved-row-text").text(row.sentence);
    $list.append($row);
  }
  $(".btn-requeue-review").off("click").on("click", async function () {
    try {
      await requeueLearnedReview(this.dataset.id);
      showToast("Moved back to active review.");
      await openReviewScreen();
      await refreshBlockedWordKeys();
    } catch (err) {
      showToast(err.message || "Could not requeue.");
    }
  });
}

async function startMasteredPractice() {
  const mastered = await getLearnedReviews(state.lang, { skippedSet: state.skippedSet });
  if (!mastered.length) return showToast("No mastered sentences yet.");
  state.practiceMode = "browse";
  state.revisitQueue = mastered;
  state.revisitIndex = 0;
  state.sessionPoints = 0;
  state.questionLimit = 0;
  state.questionsAnswered = 0;
  state.wrongQueue = [];
  state.inReview = false;
  state.reviewItems = [];
  state.levelName = "Mastered";
  resetInput();
  applyTheme(state.lang);
  renderGameChrome();
  await loadRevisitPuzzle();
  showScreen("screen-game");
}

async function startRevisitPractice() {
  const due = await getDueReviews(state.lang);
  if (!due.length) return showToast("No sentences due for review.");
  state.practiceMode = "revisit";
  state.revisitQueue = due;
  state.revisitIndex = 0;
  state.sessionPoints = 0;
  state.questionLimit = 0;
  state.questionsAnswered = 0;
  state.wrongQueue = [];
  state.inReview = false;
  state.reviewItems = [];
  state.levelName = "Revisit";
  resetInput();
  applyTheme(state.lang);
  renderGameChrome();
  await loadRevisitPuzzle();
  showScreen("screen-game");
}

async function startBrowsePractice() {
  const all = await getActiveReviews(state.lang, { skippedSet: state.skippedSet });
  if (!all.length) return showToast("No sentences in your review bank.");
  state.practiceMode = "browse";
  state.revisitQueue = all;
  state.revisitIndex = 0;
  state.sessionPoints = 0;
  state.questionLimit = 0;
  state.questionsAnswered = 0;
  state.wrongQueue = [];
  state.inReview = false;
  state.reviewItems = [];
  state.levelName = "Browse";
  resetInput();
  applyTheme(state.lang);
  renderGameChrome();
  await loadRevisitPuzzle();
  showScreen("screen-game");
}

async function startNormalRound() {
  resetInput();
  let puzzle = null;
  if (isReviewBankSession()) {
    await loadRevisitPuzzle();
    return;
  }
  if (state.practiceMode === "flashcard" && state.flashcardPuzzlePool.length) {
    const picked = pickFlashcardPuzzle(state.flashcardPuzzlePool, {
      sequential: state.flashcardSequential,
      wordOrder: state.flashcardWordOrder,
      cycleIndex: state.flashcardCycleIndex,
      ...blankWordOpts(),
    });
    puzzle = picked.puzzle;
    state.flashcardCycleIndex = picked.nextCycleIndex;
    if (picked.nextWordOrder) state.flashcardWordOrder = picked.nextWordOrder;
  } else if (state.practiceMode === "article" && state.activeArticle) {
    puzzle = buildArticlePuzzle(
      state.activeArticle,
      state.articleCursor,
      state.zipfLo,
      state.zipfHi,
      state.lang,
      state.zipfDict,
      state.lemmaMap,
      state.sentenceFilters,
      state.corpusStats,
      blankWordOpts()
    );
    if (!puzzle) {
      showToast(`Finished "${state.activeArticle.title}".`);
      renderArticleList();
      showScreen("screen-articles");
      return;
    }
    state.articleCursor = puzzle.articleIndex + 1;
  } else {
    puzzle = buildPuzzle(
      state.sentences,
      state.zipfLo,
      state.zipfHi,
      state.lang,
      state.zipfDict,
      state.lemmaMap,
      120,
      state.skippedSet,
      state.sentenceFilters,
      state.corpusStats,
      state.puzzlePool,
      state.puzzlePoolUsed,
      blankWordOpts()
    );
    if (puzzle) puzzle = clonePuzzle(puzzle);
    if (!puzzle && state.practiceMode === "zipf") {
      refreshPuzzlePool();
      puzzle = buildPuzzle(
        state.sentences,
        state.zipfLo,
        state.zipfHi,
        state.lang,
        state.zipfDict,
        state.lemmaMap,
        120,
        state.skippedSet,
        state.sentenceFilters,
        state.corpusStats,
        state.puzzlePool,
        state.puzzlePoolUsed,
        blankWordOpts()
      );
      if (puzzle) puzzle = clonePuzzle(puzzle);
    }
  }
  if (!puzzle) {
    showToast(state.practiceMode === "flashcard"
      ? "No matching sentences for this set."
      : "No matching sentences. Try widening zipf or turning off sentence filters.");
    showScreen("screen-menu");
    return;
  }
  state.puzzle = puzzle;
  await trackPuzzleShown(puzzle);
  await loadTranslation();
}

async function startFlashcardPractice() {
  const set = state.activeFlashcardSet;
  if (!set?.words.length) {
    showToast("Add words to this set first.");
    return;
  }
  state.flashcardSequential = $("#flashcard-sequential").is(":checked");
  state.flashcardWordOrder = shuffleArray(set.words.map((w) => w.word));
  state.flashcardCycleIndex = 0;
  state.questionLimit = readQuestionLimit();
  state.questionsAnswered = 0;
  state.sentenceFilters = readSentenceFilters();

  showScreen("screen-loading");
  setLoadProgress(2, "Scanning all sentences…");
  try {
    const url = await resolveDataUrl(state.sourceFile);
    const { lines } = await streamAllSentences(url, setLoadProgress);
    state.flashcardPuzzlePool = indexFlashcardPuzzles(
      lines,
      state.flashcardWordOrder,
      state.skippedSet,
      state.sentenceFilters,
      state.lang,
      state.zipfDict,
      state.lemmaMap,
      state.corpusStats,
      { wordExposure: state.wordExposure }
    );
    if (!state.flashcardPuzzlePool.length) {
      showToast("No sentences found for these words in the corpus.");
      renderPracticeMenu();
      showScreen("screen-menu");
      return;
    }
    setLoadProgress(100, `Found ${state.flashcardPuzzlePool.length} puzzles`);
    await startGame(3, 8, "Flashcards");
  } catch (err) {
    $("#error-message").text(err.message || String(err));
    showScreen("screen-error");
  }
}

async function startGame(lo, hi, name) {
  state.zipfLo = lo;
  state.zipfHi = hi;
  state.levelName = name;
  state.sessionPoints = 0;
  state.wrongQueue = [];
  state.questionsSinceReview = 0;
  state.inReview = false;
  state.reviewItems = [];
  state.reviewSessionTotal = 0;
  state.sessionBlankKeys = new Set();
  state.sentenceFilters = readSentenceFilters();
  if (
    state.practiceMode !== "flashcard" &&
    state.sentenceFilters.enabled &&
    countMatchingSentences(state.corpusStats, state.sentenceFilters) === 0
  ) {
    showToast("No sentences match these filters.");
    return;
  }
  await refreshBlockedWordKeys();
  if (state.practiceMode === "zipf") {
    state.questionLimit = readQuestionLimit();
    state.questionsAnswered = 0;
  } else if (state.practiceMode === "article") {
    state.questionLimit = 0;
    state.questionsAnswered = 0;
    state.articleCursor = 0;
  } else if (state.practiceMode === "flashcard") {
    state.questionLimit = readQuestionLimit();
    state.questionsAnswered = 0;
  }
  resetInput();
  if (state.practiceMode === "zipf" || state.practiceMode === "article") {
    $("#zipf-lo").val(lo);
    $("#zipf-hi").val(hi);
    syncSliders();
  }
  applyTheme(state.lang);

  if (state.practiceMode === "zipf") {
    showScreen("screen-loading");
    setLoadProgress(15, "Finding matching sentences…");
    await new Promise((r) => requestAnimationFrame(r));
    refreshPuzzlePool();
    if (!state.puzzlePool.length) {
      showToast("No matching sentences. Try widening zipf or turning off sentence filters.");
      renderPracticeMenu();
      showScreen("screen-menu");
      return;
    }
    setLoadProgress(100, `${state.puzzlePool.length} matching puzzles`);
  }

  showScreen("screen-game");
  renderAccentModal();
  renderGameChrome();
  startNormalRound();
}

function markSkippedLocal(lineIndex, sentence) {
  if (lineIndex != null) state.skippedSet.indices.add(lineIndex);
  else if (sentence) state.skippedSet.sentences.add(sentence.trim().normalize("NFC"));
  dropPuzzlePoolForSkipped(lineIndex, sentence);
}

async function updateFavoriteButton() {
  const idx = state.puzzle?.lineIndex;
  const $btn = $("#btn-favorite");
  if (idx == null) {
    $btn.removeClass("btn-primary fav-saved").attr("title", "Save").attr("aria-label", "Save");
    if (!isMobileUi()) $btn.find(".fav-label").text("Save");
    return;
  }
  const saved = await isFavorite(state.lang, idx);
  $btn.toggleClass("btn-primary fav-saved", saved);
  $btn.attr("title", saved ? "Saved" : "Save").attr("aria-label", saved ? "Saved" : "Save");
  if (!isMobileUi()) $btn.find(".fav-label").text(saved ? "Saved" : "Save");
}

function bounceFavoriteButton() {
  const el = $("#btn-favorite")[0];
  if (!el) return;
  el.classList.remove("fav-bounce");
  void el.offsetWidth;
  el.classList.add("fav-bounce");
}

async function toggleFavorite() {
  if (!state.puzzle) return;
  const idx = state.puzzle.lineIndex;
  if (idx == null) {
    showToast("Cannot save this sentence.");
    return;
  }
  if (await isFavorite(state.lang, idx)) {
    await removeFavorite(state.lang, idx);
    showToast("Removed from saved.");
  } else {
    await addFavorite(state.lang, idx, state.sourceFile);
    bounceFavoriteButton();
    showToast("Sentence saved.");
  }
  await updateFavoriteButton();
}

async function skipSentence() {
  if (!state.puzzle) return;
  stopSpeech();
  await markSentenceSkipped(state.lang, state.puzzle.lineIndex, state.sourceFile, state.puzzle.sentence);
  markSkippedLocal(state.puzzle.lineIndex, state.puzzle.sentence);
  showToast("Sentence skipped.");
  resetInput();
  startNormalRound();
}

function openReportModal() {
  if (!state.puzzle) return;
  openModal("modal-report");
}

async function confirmReportSentence() {
  if (!state.puzzle) return;
  const reported = clonePuzzle(state.puzzle);
  closeModal("modal-report");
  stopSpeech();
  await markSentenceSkipped(state.lang, reported.lineIndex, state.sourceFile, reported.sentence);
  markSkippedLocal(reported.lineIndex, reported.sentence);
  await deleteSentenceReviewForPuzzle(state.lang, reported.sentence);
  purgeReportedPuzzle(reported);
  showToast("Sentence reported and hidden.");
  resetInput();
  if (state.inReview) {
    loadReviewPuzzle();
    return;
  }
  startNormalRound();
}

async function renderSavedScreen(fromHub = false) {
  state.savedFromHub = fromHub;
  $("#saved-lang-wrap").toggleClass("hidden", fromHub);
  const $pick = $("#saved-lang-pick").empty();
  for (const entry of state.learning) {
    const lang = catalogLang(entry.code) ?? entry;
    $pick.append(`<option value="${entry.code}">${lang.label ?? entry.label}</option>`);
  }
  if (fromHub) {
    state.savedLang = state.lang;
  } else if (!state.savedLang && state.learning.length) {
    state.savedLang = state.learning[0].code;
  }
  if (state.savedLang) $pick.val(state.savedLang);
  enhanceSelectField($pick[0]);
  $(".saved-tab").removeClass("active").filter(`[data-tab="${state.savedTab}"]`).addClass("active");
  await refreshSavedList();
}

function renderArticleList() {
  const $list = $("#article-list").empty();
  $("#articles-empty").toggleClass("hidden", state.articles.length > 0);
  for (let i = 0; i < state.articles.length; i++) {
    const art = state.articles[i];
    const diff = articleDifficultyLabel(art, state.lang, state.zipfDict, state.lemmaMap);
    const $row = $(`
      <button type="button" class="article-row">
        <span class="min-w-0 flex-1">
          <span class="block font-semibold text-sm truncate">${art.title}</span>
          <span class="article-row-meta mt-0.5 block">${art.words ?? "—"} words · ${diff}</span>
        </span>
        <span style="color:var(--muted)">›</span>
      </button>
    `);
    $row.on("click", () => openArticlePracticeMenu(art));
    $list.append($row);
  }
}

async function openArticlesScreen() {
  showScreen("screen-loading");
  setLoadProgress(15, "Loading articles…");
  state.articles = await loadArticles(state.lang);
  $("#articles-flag").empty().append(flagEl(state.country, "md"));
  renderArticleList();
  showScreen("screen-articles");
}

function openArticlePracticeMenu(article) {
  state.activeArticle = article;
  state.practiceMode = "article";
  state.levelName = article.title;
  renderPresets();
  syncSliders();
  renderPracticeMenu();
  showScreen("screen-menu");
}

async function refreshSavedList() {
  const langCode = $("#saved-lang-pick").val() || state.savedLang;
  if (!langCode) return;
  state.savedLang = langCode;
  const lang = catalogLang(langCode) ?? { label: langCode, file: sentenceFilename(langCode, "wiki") };
  const $list = $("#saved-list").empty();
  $("#saved-empty").addClass("hidden");

  const rows = state.savedTab === "favorites"
    ? await getFavorites(langCode)
    : await getSkippedRecords(langCode);

  if (!rows.length) {
    $("#saved-empty").removeClass("hidden").text(
      state.savedTab === "favorites" ? "No saved sentences yet." : "No reported sentences."
    );
    return;
  }

  const wikiFile = lang.file ?? sentenceFilename(langCode, "wiki");
  const legacy = legacyFallbacks(langCode, "wiki");
  for (const row of rows) {
    const lineIndex = row.lineIndex;
    let text = row.sentence ?? null;
    if (!text && lineIndex != null) {
      try {
        text = await fetchSentenceAtIndex(row.sourceFile || wikiFile, lineIndex)
          ?? (legacy.length ? await fetchSentenceAtIndex(legacy[0], lineIndex) : null);
      } catch {
        text = null;
      }
    }
    const display = text ?? `(sentence #${lineIndex ?? "?"})`;
    const $row = $(`<div class="saved-row"><p class="saved-row-text"></p></div>`);
    $row.find(".saved-row-text").text(display);
    const undoIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 10h10a5 5 0 0 1 5 5v2"/><path d="M3 10l4-4"/><path d="M3 10l4 4"/></svg>`;
    if (state.savedTab === "favorites") {
      const $btn = $(`<button type="button" class="btn-icon-trash" title="Remove from saved" aria-label="Remove from saved">${TRASH_ICON}</button>`);
      $btn.on("click", async () => {
        if (lineIndex != null) await removeFavorite(langCode, lineIndex);
        await refreshSavedList();
        showToast("Removed from saved.");
      });
      $row.append($btn);
    } else {
      const $btn = $(`<button type="button" class="btn-icon-trash btn-restore" title="Unreport" aria-label="Unreport">${undoIcon}</button>`);
      $btn.on("click", async () => {
        await unskipSentence(row.id);
        if (lineIndex != null) state.skippedSet.indices?.delete(lineIndex);
        if (state.lang === langCode) {
          state.skippedSet = await getSkippedSet(langCode);
        }
        await refreshSavedList();
        showToast("Sentence unreported.");
      });
      $row.append($btn);
    }
    $list.append($row);
  }
}

function primarySelectedWord(text) {
  const parts = text.trim().split(/\s+/).filter(Boolean);
  return parts.length === 1 ? parts[0] : null;
}

function playSelectedWord(word) {
  if (!word || !state.enableTts) return;
  speakWord(word, state.lang).catch(() => {});
}

function showSelectionTooltip(text, x, y) {
  state.selectedText = text;
  $("#word-tooltip").css({ left: x, top: y - 8, transform: "translate(-50%, -100%)" }).show();
  playSelectedWord(primarySelectedWord(text));
}

function hideWordTooltip() { $("#word-tooltip").hide(); state.selectedText = ""; }

function openLookupPanel() { $("#lookup-overlay, #lookup-panel").addClass("open"); }
function closeLookupPanel() {
  $("#lookup-overlay, #lookup-panel").removeClass("open");
  state.lookupWikiHistory = [];
  $("#btn-wiki-back").addClass("hidden");
}

function updateWikiBackButton() {
  $("#btn-wiki-back").toggleClass("hidden", state.lookupWikiHistory.length <= 1);
}

async function loadLookupWikiContent(word, { pushHistory = false, replaceHistory = false } = {}) {
  const title = word.trim();
  if (!title) return;
  state.lookupWord = title;
  $("#lookup-title").text(title);
  $("#lookup-translation").text("Loading…");
  $("#lookup-wiki").html("");
  $("#lookup-wiki-link").attr("href", wiktionaryUrl(title));
  if (replaceHistory) state.lookupWikiHistory = [title];
  else if (pushHistory) state.lookupWikiHistory.push(title);
  updateWikiBackButton();
  try {
    const result = await lookupWord(title, state.lang, state.nativeLang, state.translationCache);
    state.lookupTranslation = result.translation;
    $("#lookup-translation").text(`Translation: ${result.translation}`);
    if (result.wikiHtml) $("#lookup-wiki").html(result.wikiHtml);
    else $("#lookup-wiki").html(`<p class="text-sm italic" style="color:var(--muted)">No Wiktionary entry found.</p>`);
  } catch {
    $("#lookup-translation").text("(lookup failed)");
    $("#lookup-wiki").html(`<p class="text-sm italic" style="color:var(--muted)">Could not load Wiktionary.</p>`);
  }
}

async function navigateLookupWiki(word) {
  await loadLookupWikiContent(word, { pushHistory: true });
  $("#lookup-wiki-scroll").scrollTop(0);
}

async function lookupWikiBack() {
  if (state.lookupWikiHistory.length <= 1) return;
  state.lookupWikiHistory.pop();
  const word = state.lookupWikiHistory[state.lookupWikiHistory.length - 1];
  await loadLookupWikiContent(word);
  $("#lookup-wiki-scroll").scrollTop(0);
}

function appendChatBubble(role, text, isError = false) {
  $("#lookup-chat-messages").append(`<div class="chat-bubble ${isError ? "error" : role}">${$("<div>").text(text).html()}</div>`);
  const el = $("#lookup-chat-messages")[0];
  el.scrollTop = el.scrollHeight;
}

function resetChatUI() {
  state.chatHistory = [];
  $("#lookup-chat-messages").empty();
  if (state.groqApiKey) {
    appendChatBubble("assistant", "Ask me anything about this word. Type show key to reveal your saved API key.");
  } else {
    appendChatBubble("assistant", "Paste your Groq API key in the input below and press Enter. It should start with gsk_.");
  }
}

function maskApiKey(key) {
  if (!key || key.length < 8) return "••••••••";
  return `${key.slice(0, 4)}••••${key.slice(-4)}`;
}

async function runLookup(word) {
  if (!word?.trim()) return;
  hideWordTooltip();
  openLookupPanel();
  resetChatUI();
  await loadLookupWikiContent(word.trim(), { replaceHistory: true });
}

async function openAddFlashcardModal(word) {
  const w = (word || "").trim();
  if (!w) return;
  hideWordTooltip();
  state.pendingFlashcardWord = w;
  state.flashcardSets = await getFlashcardSets(state.lang);
  $("#flashcard-word-label").text(w);
  $("#flashcard-set-search-pick").val("");
  renderFlashcardSetCombobox("");
  openModal("modal-add-flashcard");
  setTimeout(() => $("#flashcard-set-search-pick").trigger("focus"), 50);
}

function renderFlashcardSetCombobox(query = "", { open = true } = {}) {
  const q = (query || "").trim().toLowerCase();
  const sets = (state.flashcardSets || []).filter((s) => !q || s.name.toLowerCase().includes(q));
  const $menu = $("#flashcard-set-menu").empty();
  const $combo = $("#flashcard-set-combobox");
  const selectedId = $("#flashcard-set-pick").val();

  if (!sets.length) {
    $menu.append(`<p class="px-2 py-2 text-sm" style="color:var(--muted)">${(state.flashcardSets || []).length ? "No sets match." : "No sets yet — create one below."}</p>`);
    if (!(state.flashcardSets || []).length) $("#flashcard-set-pick").val("");
    $combo.toggleClass("open", open);
    return;
  }

  if (!selectedId || !sets.some((s) => s.id === selectedId)) {
    $("#flashcard-set-pick").val(sets[0].id);
  }
  const activeId = $("#flashcard-set-pick").val();

  for (const s of sets) {
    const $opt = $(`<button type="button" class="custom-select-option${s.id === activeId ? " is-selected" : ""}"></button>`);
    $opt.text(`${s.name} (${s.words.length})`);
    $opt.on("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      $("#flashcard-set-pick").val(s.id);
      $("#flashcard-set-search-pick").val(s.name);
      renderFlashcardSetCombobox("", { open: false });
      $combo.removeClass("open");
    });
    $menu.append($opt);
  }
  $combo.toggleClass("open", open);
}

function sentenceCardHtml(text) {
  return $("<div>", { class: "card px-3 py-2.5 text-sm leading-snug" }).text(text);
}

async function openWordLookupScreen() {
  $("#word-lookup-input").val("");
  $("#word-lookup-results").addClass("hidden");
  const options = catalogLang(state.lang)?.corpora ?? CORPUS_OPTIONS;
  const $sel = $("#word-lookup-corpus").empty();
  const $msel = $("#mastery-corpus").empty();
  for (const c of options) {
    $sel.append($("<option>", { value: c.id, text: c.label }));
    $msel.append($("<option>", { value: c.id, text: c.label }));
  }
  $sel.val(state.corpus || "wiki");
  $msel.val(state.corpus || "wiki");
  enhanceSelectField($sel[0]);
  enhanceSelectField($msel[0]);

  const $band = $("#mastery-band").empty();
  for (const preset of DIFFICULTY_PRESETS) {
    $band.append(
      $("<option>", {
        value: `${preset.lo}:${preset.hi}`,
        text: `${preset.name} (${preset.lo}–${preset.hi})`,
      })
    );
  }
  $band.val("6:8");
  enhanceSelectField($band[0]);

  setWordScreenTab(state.wordScreenTab || "lookup");
  showScreen("screen-word-lookup");
  if ((state.wordScreenTab || "lookup") === "lookup") {
    setTimeout(() => $("#word-lookup-input").trigger("focus"), 50);
  } else {
    refreshMasteryPanel().catch(() => {});
  }
}

function setWordScreenTab(tab) {
  state.wordScreenTab = tab === "progress" ? "progress" : "lookup";
  $(".wl-tab").removeClass("is-active");
  $(`.wl-tab[data-wl-tab="${state.wordScreenTab}"]`).addClass("is-active");
  $("#wl-panel-lookup").toggleClass("hidden", state.wordScreenTab !== "lookup");
  $("#wl-panel-progress").toggleClass("hidden", state.wordScreenTab !== "progress");
}

function setFlashcardListTab(tab) {
  state.flashcardListTab = tab === "presets" ? "presets" : "yours";
  renderFlashcardList();
}

async function refreshMasteryPanel({ append = false } = {}) {
  const corpus = $("#mastery-corpus").val() || state.corpus || "wiki";
  const band = ($("#mastery-band").val() || "6:8").split(":");
  const lo = Number(band[0]) || 6;
  const hi = Number(band[1]) || 8;
  const $status = $("#mastery-status").text("Loading tagged Zipf…");
  const $list = $("#mastery-list");
  const $empty = $("#mastery-empty").addClass("hidden");
  const $more = $("#btn-mastery-more").addClass("hidden");

  if (!append) {
    $list.empty();
    state.masteryShown = 0;
    state.masteryItems = [];
  }

  try {
    if (!state.sensesInventory && state.lang) {
      state.sensesInventory = await loadSensesInventory(state.lang);
    }
    const tagged = await ensureLookupTagged(corpus);
    if (!tagged?.senseZipf) {
      $status.text("No tagged corpus for this selection — Zipf progress needs tags.");
      $empty.removeClass("hidden").text("Load a tagged corpus (e.g. Movies) to see sense progress.");
      return;
    }

    const reviews = await getSentenceReviews(state.lang);
    const progressBySense = Object.create(null);
    for (const r of reviews) {
      if (!r.lemma) continue;
      const sk = senseDedupKey(r.lemma, r.sense);
      if (!sk) continue;
      const prev = progressBySense[sk];
      const count = r.learned ? LEARNED_THRESHOLD : r.correctCount ?? 0;
      if (!prev || count > prev.correctCount || r.learned) {
        progressBySense[sk] = {
          correctCount: Math.min(LEARNED_THRESHOLD, count),
          learned: Boolean(r.learned) || count >= LEARNED_THRESHOLD,
        };
      }
    }

    const senseZipf = tagged.senseZipf;
    const senseMeta = tagged.senseMeta || state.senseMeta || {};
    const items = [];
    for (const [sk, z] of Object.entries(senseZipf)) {
      if (!(z >= lo && z <= hi)) continue;
      const meta = senseMeta[sk];
      if (meta?.pos === "PROP") continue;
      const [lemma, sense] = sk.split("::");
      const gloss =
        state.sensesInventory?.[lemma]?.senses?.find((s) => (s.id || "").toLowerCase() === sense)?.gloss ||
        "";
      if (/proper name/i.test(gloss)) continue;
      const prog = progressBySense[sk];
      const seen = state.seenSenseKeys?.has(sk) || Boolean(prog);
      items.push({
        key: sk,
        lemma,
        sense: sense || "s0",
        zipf: z,
        gloss,
        seen,
        correctCount: prog?.correctCount ?? 0,
        learned: Boolean(prog?.learned),
      });
    }
    items.sort((a, b) => b.zipf - a.zipf || a.lemma.localeCompare(b.lemma) || a.sense.localeCompare(b.sense));
    state.masteryItems = items;

    const seenN = items.filter((i) => i.seen).length;
    const masteredN = items.filter((i) => i.learned).length;
    $status.text(
      `${items.length.toLocaleString()} senses · Zipf ${lo}–${hi} · ${seenN.toLocaleString()} seen · ${masteredN.toLocaleString()} mastered`
    );
    renderMasterySlice();
  } catch (err) {
    $status.text(err.message || "Could not load progress.");
    $empty.removeClass("hidden");
  }
}

function renderMasterySlice() {
  const page = 40;
  const items = state.masteryItems || [];
  const start = state.masteryShown || 0;
  const slice = items.slice(start, start + page);
  const $list = $("#mastery-list");
  const $empty = $("#mastery-empty");
  const $more = $("#btn-mastery-more");

  if (!start && !slice.length) {
    $empty.removeClass("hidden");
    $more.addClass("hidden");
    return;
  }
  $empty.addClass("hidden");

  for (const item of slice) {
    const pct = Math.round((Math.min(LEARNED_THRESHOLD, item.correctCount) / LEARNED_THRESHOLD) * 100);
    let status;
    if (item.learned) status = "Mastered";
    else if (item.seen) status = `Seen · ${item.correctCount}/${LEARNED_THRESHOLD} review`;
    else status = "Not seen yet";
    const $row = $(`<div class="card mastery-row"></div>`);
    $row.append(
      $("<div>", { class: "flex items-start justify-between gap-2" }).append(
        $("<div>", { class: "min-w-0" }).append(
          $("<p>", { class: "mastery-lemma" }).text(item.lemma),
          $("<p>", { class: "mastery-meta" }).text(
            `${item.sense} · Zipf ${item.zipf.toFixed(2)}${item.gloss ? ` · ${item.gloss}` : ""}`
          )
        ),
        $("<span>", { class: "shrink-0 text-xs font-medium", style: "color:var(--muted)" }).text(status)
      )
    );
    $row.append($(`<div class="mastery-bar"><span style="width:${pct}%"></span></div>`));
    $row.on("click", () => {
      setWordScreenTab("lookup");
      $("#word-lookup-input").val(item.lemma);
      runWordLookup(item.lemma).catch((e) => showToast(e.message || "Lookup failed."));
    });
    $row.css("cursor", "pointer");
    $list.append($row);
  }
  state.masteryShown = start + slice.length;
  $more.toggleClass("hidden", state.masteryShown >= items.length);
}

async function ensureLookupTagged(corpus) {
  if (state.corpus === corpus && state.taggedData) return state.taggedData;
  const key = `${state.lang}:${corpus}`;
  if (state.lookupTaggedCache[key]) return state.lookupTaggedCache[key];
  if (!(await taggedCorpusAvailable(state.lang, corpus))) return null;
  const tagged = await loadTaggedCorpus(state.lang, corpus);
  if (tagged) state.lookupTaggedCache[key] = tagged;
  return tagged;
}

function renderWordLookupSenses(lemma) {
  const $list = $("#word-lookup-senses").empty();
  const $empty = $("#word-lookup-senses-empty").addClass("hidden");
  const inv = state.sensesInventory?.[lemma] ?? null;
  const senseZipf = state.lookupSenseZipf || state.senseZipf;
  const lemmaZipf = state.lookupLemmaZipf || state.lemmaZipf;
  const lemmaZ = lemmaZipf?.[lemma];
  const senses =
    inv?.senses?.length
      ? inv.senses
      : Object.keys(senseZipf || {})
          .filter((k) => k.startsWith(`${lemma}::`))
          .map((k) => ({ id: k.split("::")[1] || "s0", gloss: "" }));

  if (!senses.length && lemmaZ == null) {
    $empty.removeClass("hidden");
    return;
  }

  if (lemmaZ != null) {
    $list.append(
      $("<div>", { class: "card px-3 py-2.5 text-sm" }).html(
        `<span style="color:var(--muted)">Lemma Zipf</span> · <strong>${lemmaZ.toFixed(2)}</strong>` +
          (inv?.monosemous ? ' · <span style="color:var(--muted)">monosemous</span>' : "")
      )
    );
  }

  for (const s of senses) {
    const sid = s.id || "s0";
    const sk = senseDedupKey(lemma, sid);
    const z = senseZipf?.[sk];
    const seen = state.seenSenseKeys?.has(sk);
    const gloss = s.gloss || "—";
    const zipfLabel = z != null ? `Zipf ${z.toFixed(2)}` : "Zipf —";
    const $row = $("<div>", { class: "card px-3 py-2.5 text-sm space-y-1" });
    $row.append(
      $("<p>").html(
        `<strong>${sid}</strong> · ${zipfLabel}` +
          (seen ? ' · <span style="color:var(--primary)">practiced</span>' : "")
      )
    );
    $row.append($("<p>", { style: "color:var(--muted)" }).text(gloss));
    $list.append($row);
  }
}

async function runWordLookup(rawWord) {
  const word = (rawWord || "").trim();
  if (!word) return showToast("Enter a word to look up.");

  if (!state.sensesInventory && state.lang) {
    state.sensesInventory = await loadSensesInventory(state.lang);
  }

  const corpus = $("#word-lookup-corpus").val() || state.corpus || "wiki";
  const tagged = await ensureLookupTagged(corpus);
  const lemma = resolveLemma(
    word,
    tagged || state.taggedData,
    state.sensesInventory,
    state.lemmaMap
  );
  state.lookupLemma = lemma;
  state.lookupExampleOffset = 0;
  state.lookupSenseZipf = tagged?.senseZipf || state.senseZipf;
  state.lookupLemmaZipf = tagged?.lemmaZipf || state.lemmaZipf;

  const reviews = await getSentenceReviews(state.lang);
  const lemmaReviews = reviews.filter(
    (r) => r.lemma && normalizeForMatch(r.lemma) === lemma
  );
  const active = lemmaReviews.find((r) => !r.learned);
  const mastered = lemmaReviews.some((r) => r.learned);
  const senseZipf = state.lookupSenseZipf || {};
  const senseCount = Object.keys(senseZipf).filter((k) => k.startsWith(`${lemma}::`)).length;
  const lemmaZ = state.lookupLemmaZipf?.[lemma];

  $("#word-lookup-results").removeClass("hidden");
  $("#word-lookup-term").text(lemma === normalizeForMatch(word) ? lemma : `${word} → ${lemma}`);
  const metaParts = [];
  if (lemmaZ != null) metaParts.push(`lemma Zipf ${lemmaZ.toFixed(2)}`);
  if (senseCount) metaParts.push(`${senseCount} sense${senseCount === 1 ? "" : "s"} in corpus`);
  $("#word-lookup-meta").text(metaParts.length ? metaParts.join(" · ") : "No Zipf from tagged corpus yet");
  if (active) {
    $("#word-lookup-review")
      .text(`In review bank · ${active.correctCount ?? 0}/${LEARNED_THRESHOLD} mastered`)
      .css("color", "var(--primary)");
  } else if (mastered) {
    $("#word-lookup-review").text("Previously mastered in review").css("color", "var(--muted)");
  } else {
    $("#word-lookup-review").text("").css("color", "var(--muted)");
  }

  renderWordLookupSenses(lemma);
  $("#word-lookup-examples").empty();
  $("#btn-word-lookup-more").addClass("hidden");
  await loadWordLookupCorpusExamples({ append: false });
}

async function loadWordLookupCorpusExamples({ append = false } = {}) {
  const corpus = $("#word-lookup-corpus").val() || "wiki";
  const lemma = state.lookupLemma || $("#word-lookup-term").text().trim();
  if (!lemma) return;

  if (!append) {
    state.lookupExampleOffset = 0;
    $("#word-lookup-examples").empty();
    const tagged = await ensureLookupTagged(corpus);
    state.lookupSenseZipf = tagged?.senseZipf || (state.corpus === corpus ? state.senseZipf : null);
    state.lookupLemmaZipf = tagged?.lemmaZipf || (state.corpus === corpus ? state.lemmaZipf : null);
    renderWordLookupSenses(lemma);
    const lemmaZ = state.lookupLemmaZipf?.[lemma];
    const senseCount = Object.keys(state.lookupSenseZipf || {}).filter((k) =>
      k.startsWith(`${lemma}::`)
    ).length;
    const metaParts = [];
    if (lemmaZ != null) metaParts.push(`lemma Zipf ${lemmaZ.toFixed(2)}`);
    if (senseCount) metaParts.push(`${senseCount} sense${senseCount === 1 ? "" : "s"} in corpus`);
    if (metaParts.length) $("#word-lookup-meta").text(metaParts.join(" · "));
  }

  const $examples = $("#word-lookup-examples");
  const $empty = $("#word-lookup-examples-empty").addClass("hidden");
  const $more = $("#btn-word-lookup-more").addClass("hidden");
  const $status = $("#word-lookup-corpus-status").text("Searching…");
  const offset = state.lookupExampleOffset || 0;
  const limit = 10;

  try {
    let page = null;
    if (
      state.dataLoaded &&
      state.lang &&
      state.corpus === corpus &&
      state.sentences?.length &&
      state.taggedData
    ) {
      page = sentencesContainingLemma(state.sentences, lemma, { offset, limit });
    } else {
      page = await findSentencesContainingLemma(state.lang, corpus, lemma, {
        offset,
        limit,
        onProgress: (_pct, msg) => $status.text(msg),
      });
      if (!page) {
        // Untagged corpus: surface-form fallback.
        if (state.dataLoaded && state.corpus === corpus && state.sentences?.length) {
          const all = sentencesContainingWord(state.sentences, lemma, offset + limit + 1);
          const slice = all.slice(offset, offset + limit);
          page = {
            matches: slice,
            nextOffset: offset + slice.length,
            hasMore: all.length > offset + limit,
          };
        } else {
          const file = sentenceFilename(state.lang, corpus);
          const url = await resolveDataUrl(file, {
            required: false,
            fallbacks: legacyFallbacks(state.lang, corpus),
          });
          if (!url) {
            $status.text("Corpus file not found for this language.");
            $empty.removeClass("hidden");
            return;
          }
          const matches = await findSentencesContainingWord(url, lemma, {
            limit: offset + limit + 1,
            onProgress: (_pct, msg) => $status.text(msg),
          });
          const slice = matches.slice(offset, offset + limit);
          page = {
            matches: slice,
            nextOffset: offset + slice.length,
            hasMore: matches.length > offset + limit,
          };
        }
      }
    }

    const matches = page.matches || [];
    state.lookupExampleOffset = page.nextOffset ?? offset + matches.length;
    for (const m of matches) $examples.append(sentenceCardHtml(sentenceText(m)));
    const totalShown = $examples.children().length;
    $empty.toggleClass("hidden", totalShown > 0);
    $more.toggleClass("hidden", !page.hasMore);
    $status.text(
      totalShown
        ? `Showing ${totalShown} example${totalShown === 1 ? "" : "s"} for lemma “${lemma}”`
        : `No examples for lemma “${lemma}”`
    );
  } catch (err) {
    $status.text(err.message || "Search failed.");
    $empty.removeClass("hidden");
  }
}

async function sendChatMessage() {
  const question = $("#chat-input").val().trim();
  if (!question) return;
  $("#chat-input").val("");

  if (question.toLowerCase() === "show key") {
    appendChatBubble("user", "show key");
    if (state.groqApiKey) {
      appendChatBubble("assistant", `Your API key: ${maskApiKey(state.groqApiKey)}`);
    } else {
      appendChatBubble("assistant", "No API key saved yet. Paste your Groq key in the chat.");
    }
    return;
  }

  if (/^gsk_/.test(question)) {
    appendChatBubble("user", "••••••••");
    if (!/^gsk_[A-Za-z0-9]{20,}$/.test(question)) {
      appendChatBubble("assistant", "That doesn't look like a valid Groq key. It should start with gsk_ followed by letters and numbers.");
      return;
    }
    state.groqApiKey = question;
    await persistSettings();
    appendChatBubble("assistant", "API key saved. Ask me anything about this word.");
    return;
  }

  if (!state.groqApiKey) {
    appendChatBubble("user", question);
    appendChatBubble("assistant", "Paste your Groq API key in the input below and press Enter (format: gsk_…).");
    return;
  }

  appendChatBubble("user", question);
  state.chatHistory.push({ role: "user", content: question });
  try {
    const system = buildWordContext(state.lookupWord, state.lookupTranslation, state.langLabel);
    const reply = await groqChat(state.groqApiKey, [{ role: "system", content: system }, ...state.chatHistory]);
    state.chatHistory.push({ role: "assistant", content: reply });
    appendChatBubble("assistant", reply);
  } catch (err) {
    appendChatBubble("assistant", err.message || "Could not reach Groq.");
  }
}

function setupLookupResizer() {
  let dragging = false;
  $("#lookup-resizer").on("mousedown", (e) => { dragging = true; e.preventDefault(); });
  $(document).on("mousemove", (e) => {
    if (!dragging) return;
    const w = Math.min(Math.max(window.innerWidth - e.clientX, 300), window.innerWidth * 0.92);
    document.documentElement.style.setProperty("--lookup-width", `${w}px`);
  }).on("mouseup", () => { dragging = false; });
}

async function routeAfterLoad() {
  showScreen("screen-home");
  try {
    await renderHome();
  } catch (err) {
    console.error(err);
    showToast(err?.message || "Could not load your languages.");
  }
}

function syncCustomSelect($sel) {
  const $wrap = $sel.data("customSelect");
  if (!$wrap || $sel.data("syncingCustomSelect")) return;
  $sel.data("syncingCustomSelect", true);
  try {
    const $btn = $wrap.find(".custom-select-btn");
    const $menu = $wrap.find(".custom-select-menu").empty();
    const selected = $sel.find("option:selected");
    $btn.text(selected.text() || "—");
    $sel.find("option").each(function () {
      const val = $(this).attr("value");
      const text = $(this).text();
      const isSelected = $(this).is(":selected");
      const $opt = $(`<button type="button" class="custom-select-option${isSelected ? " is-selected" : ""}"></button>`);
      $opt.text(text);
      $opt.on("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const prev = $sel.val();
        $sel.val(val);
        $wrap.removeClass("open");
        syncCustomSelect($sel);
        if (prev !== val) $sel.trigger("change");
      });
      $menu.append($opt);
    });
  } finally {
    $sel.data("syncingCustomSelect", false);
  }
}

function enhanceSelectField(el) {
  const $sel = $(el);
  if (!$sel.length) return;
  if ($sel.data("enhanced")) {
    syncCustomSelect($sel);
    return;
  }
  $sel.addClass("is-enhanced").data("enhanced", true);
  const $wrap = $(`<div class="custom-select mt-1 w-full"></div>`);
  const $btn = $(`<button type="button" class="custom-select-btn"></button>`);
  const $menu = $(`<div class="custom-select-menu" role="listbox"></div>`);
  $sel.after($wrap);
  $wrap.append($btn, $menu);
  $sel.data("customSelect", $wrap);
  $btn.on("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const wasOpen = $wrap.hasClass("open");
    $(".custom-select").removeClass("open");
    if (!wasOpen) $wrap.addClass("open");
  });
  $sel.on("change.customSelect", () => {
    if (!$sel.data("syncingCustomSelect")) syncCustomSelect($sel);
  });
  syncCustomSelect($sel);
}

function enhanceAllSelects(root = document) {
  $(root).find("select.select-field").each(function () {
    enhanceSelectField(this);
  });
}

async function init() {
  applyTheme(null, true);
  bindModalDismiss();
  setupLookupResizer();
  $(document).on("click", () => $(".custom-select").removeClass("open"));
  showScreen("screen-loading");
  try {
    const res = await fetch(assetUrl("languages.json"));
    if (!res.ok) throw new Error("Could not load languages.json");
    state.catalog = await res.json();
    await refreshAvailability();
    await loadPersistedSettings();
    syncFilterUI({ persist: false });
    setLoadProgress(100, "Ready");
    await routeAfterLoad();
    enhanceAllSelects();
  } catch (err) {
    console.error(err);
    $("#error-message").text(err.message || String(err));
    showScreen("screen-error");
  }
}

// Events
$("#btn-add-language").on("click", () => {
  $("#add-lang-search").val("");
  renderAddLangGrid();
  openModal("modal-add-lang");
  refreshLearningData()
    .then(() => {
      if ($("#modal-add-lang").hasClass("open")) renderAddLangGrid();
    })
    .catch(() => {});
});

$("#add-lang-search").on("input", renderAddLangGrid);

$("#btn-about").on("click", async () => {
  try {
    await loadAboutPage();
    showScreen("screen-about");
  } catch {
    showToast("Could not load about page.");
  }
});

$("#btn-about-back").on("click", () => {
  renderHome();
  showScreen("screen-home");
});

$("#btn-mode-foundations").on("click", () => {
  openFoundationsPage().catch(() => showToast("Could not load foundations."));
});

$("#btn-mode-revisit").on("click", () => {
  openReviewScreen().catch((e) => showToast(e.message || "Could not open review."));
});

$("#btn-review-back").on("click", async () => {
  await renderLangHub();
  showScreen("screen-lang-hub");
});

$("#btn-review-due").on("click", () => {
  startRevisitPractice().catch((e) => showToast(e.message || "Could not start review."));
});

$("#btn-review-browse").on("click", () => {
  startBrowsePractice().catch((e) => showToast(e.message || "Could not start browse."));
});

$("#btn-review-mastered-practice").on("click", () => {
  startMasteredPractice().catch((e) => showToast(e.message || "Could not start mastered quiz."));
});

$(document).on("click", ".review-bank-tab", async function () {
  state.reviewBankTab = this.dataset.tab || "active";
  await openReviewScreen();
});

$("#btn-foundations-back").on("click", () => {
  renderLangHub();
  showScreen("screen-lang-hub");
});

$("#btn-settings").on("click", () => {
  renderTtsLocaleSettings();
  openModal("modal-settings");
});

$("#btn-clear-data").on("click", async () => {
  if (!confirm("Clear all data from this device?")) return;
  await clearAllData();
  state.dataLoaded = false;
  location.reload();
});

$("#btn-hub-back").on("click", async () => { applyTheme(null, true); await renderHome(); showScreen("screen-home"); });
$("#btn-mode-sentences").on("click", () => {
  if (!hubLangAvailable()) return showToast("Sentence practice isn't available for this language yet.");
  state.practiceMode = "zipf";
  state.activeArticle = null;
  renderPresets();
  syncSliders();
  applyCorpusStatsToFiltersUI();
  syncFilterUI();
  renderPracticeMenu();
  showScreen("screen-menu");
});
$("#btn-mode-articles").on("click", () => {
  if (!hubLangAvailable()) return showToast("Article practice isn't available for this language yet.");
  openArticlesScreen().catch((err) => {
    $("#error-message").text(err.message || String(err));
    showScreen("screen-error");
  });
});
$("#btn-articles-back").on("click", () => { renderLangHub(); showScreen("screen-lang-hub"); });
$("#btn-mode-saved").on("click", async () => {
  await renderSavedScreen(true);
  showScreen("screen-saved");
});
$("#btn-mode-word-lookup").on("click", () => {
  openWordLookupScreen().catch((e) => showToast(e.message || "Could not open word lookup."));
});
$("#btn-word-lookup-back").on("click", () => {
  renderLangHub();
  showScreen("screen-lang-hub");
});
$(".wl-tab").on("click", function () {
  const tab = this.dataset.wlTab;
  setWordScreenTab(tab);
  if (tab === "progress") refreshMasteryPanel().catch((e) => showToast(e.message || "Progress failed."));
  else setTimeout(() => $("#word-lookup-input").trigger("focus"), 50);
});
$("#mastery-corpus, #mastery-band").on("change", () => {
  refreshMasteryPanel().catch((e) => showToast(e.message || "Progress failed."));
});
$("#btn-mastery-more").on("click", () => renderMasterySlice());
$("#word-lookup-form").on("submit", (e) => {
  e.preventDefault();
  runWordLookup($("#word-lookup-input").val()).catch((err) => showToast(err.message || "Lookup failed."));
});
$("#word-lookup-corpus").on("change", () => {
  if (!state.lookupLemma || $("#word-lookup-results").hasClass("hidden")) return;
  loadWordLookupCorpusExamples({ append: false }).catch(() => {});
});
$("#btn-word-lookup-more").on("click", () => {
  if (!state.lookupLemma) return;
  loadWordLookupCorpusExamples({ append: true }).catch(() => {});
});
$("#btn-mode-flashcards").on("click", async () => {
  if (!hubLangAvailable()) return showToast("Flashcard practice needs a sentence corpus — coming soon for this language.");
  await seedBuiltinFlashcardSets(state.lang);
  state.flashcardSets = await getFlashcardSets(state.lang);
  state.flashcardListTab = "yours";
  renderFlashcardList();
  showScreen("screen-flashcards");
});
$(".fc-tab").on("click", function () {
  setFlashcardListTab(this.dataset.fcTab);
});
$("#btn-flash-back").on("click", () => { renderLangHub(); showScreen("screen-lang-hub"); });
$("#btn-edit-back").on("click", () => { renderFlashcardList(); showScreen("screen-flashcards"); });
$("#btn-back-hub").on("click", () => {
  if (state.practiceMode === "flashcard") showScreen("screen-flashcards");
  else if (state.practiceMode === "article") { renderArticleList(); showScreen("screen-articles"); }
  else { renderLangHub(); showScreen("screen-lang-hub"); }
});
$("#btn-back-menu").on("click", () => {
  if (isReviewBankSession()) {
    openReviewScreen().catch(() => {
      renderLangHub();
      showScreen("screen-lang-hub");
    });
    return;
  }
  renderPracticeMenu();
  showScreen("screen-menu");
});
$("#btn-flashcard-start").on("click", startFlashcardPractice);
$("#btn-download-set").on("click", () => {
  if (state.editingFlashcardSet) downloadFlashcardSet(state.editingFlashcardSet);
});
$("#btn-edit-add-word").on("click", async () => {
  const set = state.editingFlashcardSet;
  if (!set) return;
  const word = $("#edit-add-word").val().trim();
  if (!word) return;
  try {
    validateFlashcardWord(word);
    await addWordToSet(set.id, word);
    $("#edit-add-word").val("");
    state.flashcardSets = await getFlashcardSets(state.lang);
    state.editingFlashcardSet = state.flashcardSets.find((s) => s.id === set.id) ?? null;
    renderFlashcardEditWords();
    showToast("Word added.");
  } catch (err) {
    showToast(err.message);
  }
});
$("#edit-add-word").on("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); $("#btn-edit-add-word").trigger("click"); }
});
$("#edit-set-name").on("change", async function () {
  const set = state.editingFlashcardSet;
  if (!set) return;
  const name = $(this).val().trim();
  if (!name || name === set.name) {
    $(this).val(set.name);
    return;
  }
  try {
    set.name = name;
    set.updatedAt = Date.now();
    await saveFlashcardSet(set);
    $("#edit-set-heading").text(name);
    state.flashcardSets = await getFlashcardSets(state.lang);
    state.editingFlashcardSet = state.flashcardSets.find((s) => s.id === set.id) ?? null;
    showToast("Set renamed.");
  } catch (err) {
    $(this).val(set.name);
    showToast(err.message);
  }
});

$("#btn-new-set").on("click", () => openFlashcardSetModal("create"));
$("#btn-flashcard-set-save").on("click", saveFlashcardSetModal);
$("#flashcard-set-name-input").on("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    saveFlashcardSetModal();
  }
});

$("#import-set-file").on("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    const parsed = parseImport(text, state.lang);
    for (const entry of parsed.words) validateFlashcardWord(entry.word);
    const sets = await getFlashcardSets(state.lang);
    if (sets.some((s) => s.name.trim().toLowerCase() === parsed.name.toLowerCase())) {
      throw new Error(`A set named "${parsed.name}" already exists.`);
    }
    await saveFlashcardSet({
      id: crypto.randomUUID?.() ?? `set-${Date.now()}`,
      langCode: state.lang,
      name: parsed.name,
      words: parsed.words,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    state.flashcardSets = await getFlashcardSets(state.lang);
    renderFlashcardList();
    showToast("Set imported.");
  } catch (err) { showToast(err.message); }
  e.target.value = "";
});

$("#btn-zipf-help").on("click", () => openModal("modal-zipf-help"));
$("#chart-range").on("change", renderHubChart);
window.addEventListener("resize", () => {
  if ($("#screen-lang-hub").hasClass("active")) renderHubChart();
});
$("#zipf-lo, #zipf-hi").on("input", syncSliders);
$("#review-interval").on("change", async () => {
  state.reviewInterval = Math.max(3, Math.min(30, +$("#review-interval").val() || 10));
  await persistSettings();
});
$("#filter-sentences-enable").on("change", syncFilterUI);
$("#filter-advanced-enable").on("change", syncFilterUI);

async function openConjugatorScreen() {
  if (!conjugationsAvailable(state.lang)) {
    showToast("Conjugator isn't available for this language yet.");
    return;
  }
  const pack = await loadVerbPack(state.lang);
  if (!pack?.verbs?.length) {
    showToast("No verb data found for this language.");
    return;
  }
  state.verbPack = pack;
  $("#conj-flag").empty().append(flagEl(state.country, "md"));
  const tenses = listTenses(pack);
  state.conjTenseFilter = tenses.map((t) => t.id);
  const $grid = $("#conj-tense-grid").empty();
  for (const t of tenses) {
    const id = `conj-tense-${t.id}`;
    const $label = $(`<label for="${id}"></label>`);
    const $cb = $(`<input type="checkbox" id="${id}" value="${t.id}" checked />`);
    $cb.on("change", () => {
      state.conjTenseFilter = [];
      $("#conj-tense-grid input:checked").each(function () {
        state.conjTenseFilter.push(this.value);
      });
    });
    $label.append($cb, document.createTextNode(t.label));
    $grid.append($label);
  }
  showScreen("screen-conjugator");
}

function startConjugatorGame() {
  if (!state.verbPack) return;
  if (!state.conjTenseFilter.length) {
    showToast("Pick at least one tense.");
    return;
  }
  state.conjScore = 0;
  state.conjUsedKeys = new Set();
  state.conjAwaiting = false;
  $("#conj-score").text("0");
  showScreen("screen-conj-game");
  nextConjugationItem();
}

function nextConjugationItem() {
  stopSpeech();
  state.conjAwaiting = false;
  const item = pickConjugationItem(state.verbPack, {
    tenseFilter: state.conjTenseFilter,
    usedKeys: state.conjUsedKeys,
  });
  if (!item) {
    showToast("No conjugations match.");
    showScreen("screen-conjugator");
    return;
  }
  state.conjItem = item;
  $("#conj-infinitive").text(item.infinitive);
  $("#conj-pronoun").text(item.pronounLabel);
  $("#conj-tense").text(item.tenseLabel);
  $("#conj-gloss").text(item.gloss || "");
  $("#conj-feedback").addClass("hidden").text("");
  $("#conj-input").val("").prop("disabled", false).trigger("focus");
}

function checkConjugation() {
  if (!state.conjItem || state.conjAwaiting) return;
  const guess = $("#conj-input").val().trim();
  if (!guess) return;
  if (conjugationCorrect(guess, state.conjItem.answer)) {
    state.conjAwaiting = true;
    state.conjScore += 1;
    $("#conj-score").text(String(state.conjScore));
    $("#conj-feedback").removeClass("hidden").css("color", "var(--hot)").text("Correct");
    if (state.enableTts) feedbackCorrect(state.conjItem.answer, state.lang).catch(() => {});
    setTimeout(() => nextConjugationItem(), 650);
  } else {
    if (state.enableTts) feedbackWrong();
    $("#conj-feedback").removeClass("hidden").css("color", "var(--cold)").text("Try again");
  }
}

function revealConjugation() {
  if (!state.conjItem || state.conjAwaiting) return;
  state.conjAwaiting = true;
  $("#conj-input").val(state.conjItem.answer).prop("disabled", true);
  $("#conj-feedback").removeClass("hidden").css("color", "var(--muted)").text(state.conjItem.answer);
  if (state.enableTts) feedbackWrong();
  setTimeout(() => nextConjugationItem(), 900);
}

$("#btn-mode-conjugator").on("click", () => {
  openConjugatorScreen().catch((e) => showToast(e.message || "Could not open conjugator."));
});
$("#btn-conj-back").on("click", () => {
  renderLangHub();
  showScreen("screen-lang-hub");
});
$("#btn-conj-start").on("click", startConjugatorGame);
$("#btn-conj-exit").on("click", () => {
  stopSpeech();
  showScreen("screen-conjugator");
});
$("#btn-conj-check").on("click", checkConjugation);
$("#btn-conj-hint").on("click", () => {
  if (!state.conjItem || state.conjAwaiting) return;
  const ans = state.conjItem.answer;
  const cur = $("#conj-input").val();
  if (cur.length >= ans.length) return;
  $("#conj-input").val(ans.slice(0, cur.length + 1));
});
$("#btn-conj-skip").on("click", revealConjugation);
$("#conj-input").on("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    if (state.conjAwaiting) nextConjugationItem();
    else checkConjugation();
  }
});
$("#filter-words-lo, #filter-words-hi, #filter-avgzipf-lo, #filter-avgzipf-hi").on("input", syncFilterUI);
$("#corpus-select").on("change", async function () {
  if (!$("#screen-menu").hasClass("active")) return;
  if (!state.dataLoaded) return;
  const next = $(this).val();
  await switchCorpus(next);
});
$("#setting-tts").on("change", async () => {
  state.enableTts = $("#setting-tts").is(":checked");
  await persistSettings();
});
$("#tts-rate").on("input", async () => {
  state.ttsRate = +$("#tts-rate").val();
  $("#tts-rate-label").text(state.ttsRate.toFixed(2));
  applyTtsConfig();
  await persistSettings();
});
$(document).on("change", ".tts-locale-pick", async function () {
  const code = this.dataset.lang;
  state.ttsLocales[code] = this.value;
  applyTtsConfig();
  await persistSettings();
});

$("#blank-input").on("input", (e) => {
  if (state.revealed || state.awaitingContinue || !state.puzzle) return;
  const maxRaw = maxRawLength(state.puzzle.answer.length - state.revealedLen);
  state.rawTyped = e.target.value.slice(0, maxRaw);
  syncFromRaw();
});
$("#blank-input").on("keydown", (e) => {
  if (state.revealed || state.awaitingContinue || !state.puzzle || !e.repeat || e.key.length !== 1) return;
  const pos = state.revealedLen + state.typed.length - 1;
  const accented = accentForHold(e.key, state.puzzle.answer, pos, state.lang);
  if (!accented || !state.typed.length) return;
  e.preventDefault();
  state.typed = state.typed.slice(0, -1) + accented;
  state.rawTyped = hasPendingSlash(state.rawTyped) ? state.rawTyped.slice(0, -1) + accented : state.typed;
  syncFromRaw();
});

$("#btn-hint, #btn-submit, #btn-accents").on("click", function () {
  if (this.id === "btn-hint") giveHint();
  else if (this.id === "btn-submit") submitAnswer();
  else openModal("modal-accents");
});
$("#btn-favorite").on("click", () => toggleFavorite().catch((e) => showToast(e.message)));
$("#btn-skip").on("click", skipSentence);
$("#btn-report").on("click", openReportModal);
$("#btn-confirm-report").on("click", () => confirmReportSentence().catch((e) => showToast(e.message)));
$("#btn-saved-back").on("click", () => {
  if (state.savedFromHub) { renderLangHub(); showScreen("screen-lang-hub"); }
  else { renderHome(); showScreen("screen-home"); }
});
$("#saved-lang-pick").on("change", refreshSavedList);
$(".saved-tab").on("click", function () {
  state.savedTab = this.dataset.tab;
  $(".saved-tab").removeClass("active");
  $(this).addClass("active");
  refreshSavedList();
});

$("#btn-play-sentence").on("click", () => {
  stopSpeech();
  if (state.puzzle?.sentence) speakSentence(state.puzzle.sentence, state.lang).catch(() => {});
});
$("#btn-play-lookup-word").on("click", () => {
  stopSpeech();
  playSelectedWord(state.lookupWord);
});
$("#btn-analyze-word").on("click", () => runLookup(state.selectedText));
$("#flashcard-set-search").on("input", renderFlashcardList);
$("#btn-add-flashcard").on("click", () => openAddFlashcardModal(state.selectedText));
$("#flashcard-set-search-pick").on("input", function () {
  renderFlashcardSetCombobox($(this).val());
}).on("focus", function () {
  renderFlashcardSetCombobox($(this).val());
});
$("#flashcard-set-combobox").on("click", (e) => e.stopPropagation());
$("#btn-confirm-add-word").on("click", async () => {
  const word = (state.pendingFlashcardWord || "").trim();
  const setId = $("#flashcard-set-pick").val();
  if (!word) return showToast("No word selected.");
  if (!setId) return showToast("Create a set first.");
  try {
    try {
      validateFlashcardWord(word);
    } catch {
      await ensureFullVocab();
      validateFlashcardWord(word);
    }
    await addWordToSet(setId, word);
    state.pendingFlashcardWord = null;
    closeModal("modal-add-flashcard");
    showToast("Word added to set.");
  } catch (err) { showToast(err.message); }
});
$("#btn-create-set-inline").on("click", () => {
  state.pendingWordAfterSetCreate = state.pendingFlashcardWord || state.selectedText;
  closeModal("modal-add-flashcard");
  openFlashcardSetModal("create");
});

$("#btn-close-lookup, #lookup-overlay").on("click", closeLookupPanel);
$("#btn-wiki-back").on("click", () => lookupWikiBack().catch(() => {}));
$("#lookup-wiki").on("click", "a", function (e) {
  const href = this.getAttribute("href");
  const title = wiktionaryTitleFromHref(href);
  if (!title) return;
  e.preventDefault();
  navigateLookupWiki(title).catch(() => showToast("Could not load Wiktionary page."));
});
$("#blank-slot").on("click", function (e) {
  if (state.revealed || state.awaitingContinue || !state.puzzle) return;
  if ($(e.target).closest(".revealed-answer").length) return;
  e.stopPropagation();
  const input = $("#blank-input")[0];
  if (input && !input.disabled) input.focus({ preventScroll: true });
});
$("#blank-slot").on("click", ".revealed-answer.word-tap", function (e) {
  if (!isMobileUi()) return;
  e.stopPropagation();
  const word = $(this).text().trim();
  if (word.length >= 2) runLookup(word);
});
$("#chat-input").on("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    sendChatMessage();
  }
});

$(document).on("keydown", (e) => {
  if (!$("#screen-game").hasClass("active")) return;
  if (e.key === "Enter") { e.preventDefault(); submitAnswer(); }
  if (e.key === "?" && !state.revealed && !state.awaitingContinue) { e.preventDefault(); giveHint(); }
});
$("#sentence-line").on("mouseup", (e) => {
  if (isMobileUi()) return;
  const text = window.getSelection()?.toString().trim();
  if (!text || text.length < 2) return hideWordTooltip();
  showSelectionTooltip(text, e.clientX, e.clientY);
});
$("#sentence-line").on("click", ".word-tap", function (e) {
  if (!isMobileUi()) return;
  e.stopPropagation();
  const raw = $(this).text();
  const word = raw.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
  if (word.length < 2) return;
  runLookup(word);
});
$(document).on("mousedown", (e) => {
  if (!$(e.target).closest("#sentence-line, #word-tooltip, #modal-add-flashcard").length) hideWordTooltip();
});

init();
