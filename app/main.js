import {
  DIFFICULTY_PRESETS,
  TARGET_COUNT,
  assetUrl,
  resolveDataUrl,
  LEGACY_SENTENCE_FILES,
  DEFAULT_SENTENCE_FILTERS,
  wordsMatch,
  prefixMatches,
  loadZipfDict,
  loadLemmaMap,
  streamSentences,
  streamAllSentences,
  buildPuzzle,
  indexFlashcardPuzzles,
  pickFlashcardPuzzle,
  shuffleArray,
  translateText,
  buildVocabSet,
  isKnownWord,
  fetchSentenceAtIndex,
  sentenceText,
} from "./game.js";
import { loadArticles, buildArticlePuzzle, articleDifficultyLabel } from "./articles.js";
import { feedbackCorrect, feedbackWrong, speakWord, speakSentence, stopSpeech } from "./tts.js";
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
import { lookupWord } from "./lookup.js";
import { groqChat, buildWordContext } from "./groq.js";
import { pointsForAnswer } from "./score.js";
import { exportSet, parseImport } from "./flashcards-io.js";
import { seedBuiltinFlashcardSets } from "./flashcard-presets.js";
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
} from "./db.js";
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
  nativeLang: NATIVE_LANG,
  nativeLabel: NATIVE_LABEL,
  nativeCountry: "gb",
  groqApiKey: "",
  zipfDict: {},
  lemmaMap: {},
  sentences: [],
  vocabSet: new Set(),
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
  rawTyped: "",
  typed: "",
  revealedLen: 0,
  hintedAt: [],
  revealed: false,
  awaitingContinue: false,
  flashcardSetModalMode: "create",
  editingSetId: null,
  pendingWordAfterSetCreate: null,
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
  selectedText: "",
  lookupWord: "",
  lookupTranslation: "",
  chatHistory: [],
  selectedSetId: null,
  savedTab: "favorites",
  savedLang: null,
  savedFromHub: false,
  sentenceFilters: { ...DEFAULT_SENTENCE_FILTERS },
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

function setLoadProgress(pct, msg) {
  $("#load-bar").css("width", `${Math.min(100, pct)}%`);
  $("#load-status").text(msg);
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
}

async function persistSettings() {
  await saveSettings({
    nativeCode: NATIVE_LANG,
    nativeLabel: NATIVE_LABEL,
    nativeCountry: "gb",
    reviewInterval: state.reviewInterval,
    groqApiKey: state.groqApiKey,
    enableTts: state.enableTts,
  });
}

function syncDualRange(loSel, hiSel, fillSel, labelSel, formatLabel) {
  const $lo = $(loSel);
  const $hi = $(hiSel);
  let lo = +$lo.val();
  let hi = +$hi.val();
  if (lo >= hi) {
    if (document.activeElement === $lo[0]) hi = lo + (+$lo.attr("step") || 1);
    else lo = hi - (+$hi.attr("step") || 1);
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
  if (!enabled) return { ...DEFAULT_SENTENCE_FILTERS, enabled: false };
  const words = syncDualRange(
    "#filter-words-lo",
    "#filter-words-hi",
    "#filter-words-fill",
    "#filter-words-label",
    (lo, hi) => `${lo} – ${hi}`
  );
  const zipf = syncDualRange(
    "#filter-avgzipf-lo",
    "#filter-avgzipf-hi",
    "#filter-avgzipf-fill",
    "#filter-avgzipf-label",
    (lo, hi) => `${lo.toFixed(1)} – ${hi.toFixed(1)}`
  );
  return {
    enabled: true,
    minWords: words.lo,
    maxWords: words.hi,
    minAvgZipf: zipf.lo,
    maxAvgZipf: zipf.hi,
  };
}

function syncFilterUI() {
  const enabled = $("#filter-sentences-enable").is(":checked");
  $("#filter-sentences-fields").toggleClass("disabled", !enabled);
  state.sentenceFilters = readSentenceFilters();
}

const TRASH_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>`;

function syncSliders() {
  const $lo = $("#zipf-lo");
  const $hi = $("#zipf-hi");
  let lo = +$lo.val();
  let hi = +$hi.val();
  if (lo >= hi) {
    if (document.activeElement === $lo[0]) hi = lo + 0.1;
    else lo = hi - 0.1;
  }
  $lo.val(lo);
  $hi.val(hi);
  state.zipfLo = lo;
  state.zipfHi = hi;
  $("#slider-label").text(`${lo.toFixed(1)} – ${hi.toFixed(1)}`);
  updateRangeFill($lo[0], $hi[0], $("#range-fill")[0]);
}

function clonePuzzle(puzzle) {
  return { ...puzzle, tokens: puzzle.tokens.map((t) => ({ ...t })) };
}

async function refreshAvailability() {
  await Promise.all(
    state.catalog.map(async (lang) => {
      try {
        const fallbacks = LEGACY_SENTENCE_FILES[lang.code] ? [LEGACY_SENTENCE_FILES[lang.code]] : [];
        await resolveDataUrl(lang.file, { fallbacks });
        lang.available = true;
      } catch {
        lang.available = false;
      }
    })
  );
}

async function refreshLearningData() {
  state.learning = await getLearningLanguages();
  const allStats = await getAllStats();
  state.stats = Object.fromEntries(allStats.map((s) => [s.code, s]));
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
  const dueCount = await countDueReviews(state.lang);
  $("#hub-title").text(state.langLabel);
  $("#hub-flag").empty().append(flagEl(state.country, "md"));
  $("#hub-score").text(st.totalScore ?? 0);
  $("#hub-streak").text(st.streak ?? 0);
  $("#hub-coming-soon").toggleClass("hidden", available);
  $(".hub-tile").not("#btn-mode-foundations, #btn-mode-saved, #btn-mode-revisit").toggleClass("disabled", !available);
  $("#btn-mode-revisit").toggleClass("disabled", dueCount === 0);
  $("#revisit-due-desc").text(
    dueCount ? `${dueCount} sentence${dueCount === 1 ? "" : "s"} due · mastered after ${LEARNED_THRESHOLD} correct` : "Play sentences to build your review queue"
  );
  if (available) scheduleHubChart();
}

async function ensureLanguageData(lang) {
  if (state.dataLoaded && state.lang === lang.code) return;
  showScreen("screen-loading");
  setLoadProgress(5, `Loading ${lang.label}…`);
  const [zipfDict, lemmaMap, sentResult, skipped, sets] = await Promise.all([
    loadZipfDict(lang.code),
    loadLemmaMap(lang.code),
    resolveDataUrl(lang.file, { fallbacks: LEGACY_SENTENCE_FILES[lang.code] ? [LEGACY_SENTENCE_FILES[lang.code]] : [] })
      .then((url) => streamSentences(url, TARGET_COUNT, setLoadProgress)),
    getSkippedSet(lang.code),
    getFlashcardSets(lang.code),
  ]);
  const { lines, lang: detected } = sentResult;
  if (!lines.length) throw new Error(`No sentences in ${lang.file}`);
  state.langLabel = lang.label;
  state.country = lang.country;
  state.lang = detected ?? lang.code;
  state.sourceFile = lang.file;
  state.zipfDict = zipfDict;
  state.lemmaMap = lemmaMap;
  state.sentences = lines;
  state.vocabSet = buildVocabSet(lines);
  state.skippedSet = skipped;
  state.flashcardSets = sets;
  state.dataLoaded = true;
  setLoadProgress(100, "Ready");
}

async function openLanguageHub(lang) {
  const catalog = catalogLang(lang.code) ?? lang;
  state.lang = catalog.code;
  state.langLabel = catalog.label;
  state.country = catalog.country;
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
        const newSet = [...state.flashcardSets].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))[0];
        if (newSet) {
          validateFlashcardWord(word);
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

function renderPracticeMenu() {
  renderMenuHeader();
  const mode = state.practiceMode;
  const isFlashcard = mode === "flashcard";
  const isArticle = mode === "article";
  $("#menu-zipf-section").toggleClass("hidden", isFlashcard);
  $("#menu-sentence-filters").toggleClass("hidden", isFlashcard || isArticle);
  $("#menu-flashcard-section").toggleClass("hidden", !isFlashcard);
  $("#menu-article-pick").toggleClass("hidden", !isArticle);
  $("#question-limit").closest(".card").toggleClass("hidden", isArticle);
  $("#menu-presets-heading").text(isArticle ? "Blank word difficulty" : "Word difficulty");
  if (isFlashcard && state.activeFlashcardSet) {
    $("#flashcard-set-title").text(state.activeFlashcardSet.name);
  }
  if (isArticle && state.activeArticle) {
    $("#menu-article-title").text(state.activeArticle.title);
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
  const $row = $(`
    <div class="card flashcard-set-row p-4${builtin ? " builtin" : ""}">
      <div class="flex items-center justify-between gap-3">
        <div class="min-w-0 flex-1">
          <p class="font-semibold truncate">${safeName}</p>
          <p class="mt-1 text-xs" style="color:var(--muted)">${set.words.length} word${set.words.length === 1 ? "" : "s"}${builtin ? " · Wikora preset" : " · Your set"}</p>
        </div>
        <div class="flex shrink-0 flex-wrap justify-end gap-2">
          <button type="button" class="btn-ghost px-3 py-1.5 text-xs btn-edit-set" data-id="${set.id}">Edit</button>
          <button type="button" class="btn-ghost px-3 py-1.5 text-xs btn-practice-set" data-id="${set.id}">Practice</button>
          ${builtin ? "" : '<button type="button" class="btn-ghost px-2 py-1 text-xs btn-del-set" data-id="' + set.id + '">Delete</button>'}
        </div>
      </div>
    </div>
  `);
  $parent.append($row);
}

function renderFlashcardList() {
  renderFlashcardHeader();
  const query = ($("#flashcard-set-search").val() || "").trim().toLowerCase();
  const userSets = state.flashcardSets.filter((s) => !s.builtinId && flashcardSetMatchesSearch(s, query));
  const builtinSets = state.flashcardSets.filter((s) => s.builtinId && flashcardSetMatchesSearch(s, query));

  const $user = $("#flashcard-user-list").empty();
  $("#flashcard-user-label").toggleClass("hidden", userSets.length === 0);
  $("#flashcard-user-empty").toggleClass("hidden", userSets.length > 0);
  for (const set of userSets) appendFlashcardSetRow($user, set);

  const $builtin = $("#flashcard-builtin-list").empty();
  $("#flashcard-builtin-summary").text(
    builtinSets.length
      ? `Wikora preset sets (${builtinSets.length}${query ? ` matching` : ""})`
      : "Wikora preset sets"
  );
  if (!builtinSets.length) {
    $builtin.append(`<p class="text-sm text-center py-2" style="color:var(--muted)">${query ? "No preset sets match your search." : "No preset sets loaded yet."}</p>`);
  } else {
    for (const set of builtinSets) appendFlashcardSetRow($builtin, set, { builtin: true });
  }

  $(".btn-edit-set").off("click").on("click", function () {
    openFlashcardEdit(this.dataset.id).catch((err) => showToast(err.message));
  });
  $(".btn-practice-set").off("click").on("click", function () {
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
  for (const preset of DIFFICULTY_PRESETS) {
    const $btn = $(`
      <button type="button" class="preset-tile card px-3 py-2 text-left" title="${preset.desc}">
        <span class="block text-sm font-semibold">${preset.name}</span>
        <span class="preset-range mt-0.5 block">${preset.lo}–${preset.hi}</span>
        <span class="preset-desc text-xs" style="color:var(--muted)">${preset.desc}</span>
      </button>
    `);
    $btn.on("click", () => {
      state.sentenceFilters = readSentenceFilters();
      startGame(preset.lo, preset.hi, preset.name);
    });
    $grid.append($btn);
  }
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
  if (state.practiceMode === "revisit" && state.revisitQueue.length) {
    const cur = state.revisitQueue[state.revisitIndex];
    const prog = cur ? ` · ${cur.correctCount ?? 0}/${LEARNED_THRESHOLD} mastered` : "";
    $("#review-banner").removeClass("hidden").text(
      `Revisit ${state.revisitIndex + 1} of ${state.revisitQueue.length}${prog}`
    );
  } else {
    $("#review-banner").toggleClass("hidden", !state.inReview).text(
      state.inReview ? `Review ${state.reviewIndex + 1} of ${state.reviewItems.length}` : ""
    );
  }
  if (state.awaitingContinue) {
    const hintNote = state.lastHintCount ? ` (${state.lastHintCount} hint${state.lastHintCount > 1 ? "s" : ""} used)` : "";
    $("#game-hint-text").text(`${state.lastPoints} pts${hintNote}! Press Enter To Continue`);
  }
  else if (state.revealed) $("#game-hint-text").text("Press Enter To Continue");
  else $("#game-hint-text").text("Press Enter To Check · ? For Hint · Highlight Any Word");
  $("#btn-play-sentence").toggleClass("hidden", !(state.enableTts && state.puzzle?.sentence));
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

function refreshSentence() {
  const puzzle = state.puzzle;
  if (!puzzle) return;
  const { typed, revealedLen, revealed, rawTyped } = state;
  const answer = puzzle.answer;
  const blank = puzzle.tokens[puzzle.blankIndex];
  const $line = $("#sentence-line");
  $("#sent-before").text(puzzle.sentence.slice(0, blank.start));
  $("#sent-after").text(puzzle.sentence.slice(blank.end));
  const $slot = $("#blank-slot");
  const displayText = answer.slice(0, revealedLen) + (typed || "");
  $slot.css("width", `${measureWordWidth(answer, $line[0]) + 6}px`);
  const $input = $("#blank-input");
  let $rev = $slot.find(".revealed-answer");
  if (revealed || state.awaitingContinue) {
    $("#hint-part").text("");
    $input.addClass("hidden").val("").prop("disabled", true);
    if (!$rev.length) { $rev = $("<span>", { class: "revealed-answer" }); $slot.append($rev); }
    $rev.text(answer).css("color", state.awaitingContinue ? "var(--hot)" : "#c23b3b");
    $slot.removeClass("blank-hot blank-cold");
  } else {
    $rev.remove();
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
  const pts = pointsForAnswer(
    state.puzzle.answer,
    state.levelName,
    state.lang,
    state.zipfDict,
    state.lemmaMap,
    state.hintedAt
  );
  state.lastPoints = pts;
  state.lastHintCount = state.hintedAt.length;
  state.sessionPoints += pts;
  state.awaitingContinue = true;
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
  });
  if (state.practiceMode === "revisit" && state.revisitQueue[state.revisitIndex]) {
    state.revisitQueue[state.revisitIndex] = reviewRow;
  }
  renderGameChrome();
  refreshSentence();
  if (state.enableTts) {
    feedbackCorrect(state.puzzle.sentence, state.lang).catch(() => {});
  }
}

async function onWrong() {
  if (!state.inReview && state.practiceMode !== "revisit") {
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
  });
  if (state.practiceMode === "revisit" && state.revisitQueue[state.revisitIndex]) {
    state.revisitQueue[state.revisitIndex] = reviewRow;
  }
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
  state.reviewItems = state.wrongQueue.map(clonePuzzle);
  state.wrongQueue = [];
  state.reviewIndex = 0;
  state.questionsSinceReview = 0;
  loadReviewPuzzle();
}

function loadReviewPuzzle() {
  if (state.reviewIndex >= state.reviewItems.length) {
    state.inReview = false;
    state.reviewItems = [];
    startNormalRound();
    return;
  }
  resetInput();
  state.puzzle = state.reviewItems[state.reviewIndex];
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
  $("#game-translation").text(state.translation);
  refreshSentence();
  renderGameChrome();
  try {
    state.translation = await translateText(state.puzzle.sentence, state.lang, state.nativeLang, state.translationCache);
  } catch {
    state.translation = "(translation unavailable)";
  }
  $("#game-translation").text(state.translation);
  await updateFavoriteButton();
}

async function advanceQuestion() {
  stopSpeech();
  if (state.practiceMode === "revisit") {
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
    if (state.awaitingContinue) { state.reviewItems.splice(state.reviewIndex, 1); loadReviewPuzzle(); return; }
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
}

function endPracticeSession() {
  showToast(`Session complete — ${state.sessionPoints} points.`);
  if (state.practiceMode === "article") {
    renderArticleList();
    showScreen("screen-articles");
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
    showToast("Revisit session complete.");
    await renderLangHub();
    showScreen("screen-lang-hub");
    return;
  }
  state.puzzle = puzzleFromReview(state.revisitQueue[state.revisitIndex]);
  await loadTranslation();
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

async function startNormalRound() {
  resetInput();
  let puzzle = null;
  if (state.practiceMode === "revisit") {
    await loadRevisitPuzzle();
    return;
  }
  if (state.practiceMode === "flashcard" && state.flashcardPuzzlePool.length) {
    const picked = pickFlashcardPuzzle(state.flashcardPuzzlePool, {
      sequential: state.flashcardSequential,
      wordOrder: state.flashcardWordOrder,
      cycleIndex: state.flashcardCycleIndex,
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
      state.sentenceFilters
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
      state.sentenceFilters
    );
  }
  if (!puzzle) {
    showToast(state.practiceMode === "flashcard"
      ? "No matching sentences for this set."
      : "No matching sentences. Try widening zipf or turning off sentence filters.");
    showScreen("screen-menu");
    return;
  }
  state.puzzle = puzzle;
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

  showScreen("screen-loading");
  setLoadProgress(2, "Scanning all sentences…");
  try {
    const url = await resolveDataUrl(state.sourceFile);
    const { lines } = await streamAllSentences(url, setLoadProgress);
    state.flashcardPuzzlePool = indexFlashcardPuzzles(
      lines,
      state.flashcardWordOrder,
      state.skippedSet
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
  if (state.practiceMode === "zipf") {
    state.questionLimit = readQuestionLimit();
    state.questionsAnswered = 0;
  } else if (state.practiceMode === "article") {
    state.questionLimit = 0;
    state.questionsAnswered = 0;
    state.articleCursor = 0;
  }
  resetInput();
  if (state.practiceMode === "zipf" || state.practiceMode === "article") {
    $("#zipf-lo").val(lo);
    $("#zipf-hi").val(hi);
    syncSliders();
  }
  applyTheme(state.lang);
  showScreen("screen-game");
  renderAccentModal();
  renderGameChrome();
  startNormalRound();
}

function markSkippedLocal(lineIndex, sentence) {
  if (lineIndex != null) state.skippedSet.indices.add(lineIndex);
  else if (sentence) state.skippedSet.sentences.add(sentence.trim().normalize("NFC"));
}

async function updateFavoriteButton() {
  const idx = state.puzzle?.lineIndex;
  if (idx == null) {
    $("#btn-favorite").text("Save").removeClass("btn-primary");
    return;
  }
  const saved = await isFavorite(state.lang, idx);
  $("#btn-favorite").text(saved ? "Saved" : "Save").toggleClass("btn-primary", saved);
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
  closeModal("modal-report");
  await markSentenceSkipped(state.lang, state.puzzle.lineIndex, state.sourceFile, state.puzzle.sentence);
  markSkippedLocal(state.puzzle.lineIndex, state.puzzle.sentence);
  showToast("Sentence reported and hidden.");
  resetInput();
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
  const lang = catalogLang(langCode) ?? { label: langCode, file: `${langCode}_sentences.txt` };
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

  const legacy = LEGACY_SENTENCE_FILES[langCode];
  const sourceFile = lang.file ?? `${langCode}_sentences.txt`;
  for (const row of rows) {
    const lineIndex = row.lineIndex;
    let text = row.sentence ?? null;
    if (!text && lineIndex != null) {
      try {
        text = await fetchSentenceAtIndex(sourceFile, lineIndex)
          ?? (legacy ? await fetchSentenceAtIndex(legacy, lineIndex) : null);
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
function closeLookupPanel() { $("#lookup-overlay, #lookup-panel").removeClass("open"); }

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
  const title = word.trim();
  state.lookupWord = title;
  $("#lookup-title").text(title);
  $("#lookup-translation").text("Loading…");
  $("#lookup-wiki").html("");
  resetChatUI();
  try {
    const result = await lookupWord(title, state.lang, state.nativeLang, state.translationCache);
    state.lookupTranslation = result.translation;
    $("#lookup-translation").text(`Translation: ${result.translation}`);
    $("#lookup-wiki-link").attr("href", result.url);
    if (result.wikiHtml) $("#lookup-wiki").html(result.wikiHtml);
    else $("#lookup-wiki").html(`<p class="text-sm italic" style="color:var(--muted)">No Wiktionary entry found.</p>`);
  } catch {
    $("#lookup-translation").text("(lookup failed)");
  }
}

async function openAddFlashcardModal(word) {
  hideWordTooltip();
  state.flashcardSets = await getFlashcardSets(state.lang);
  $("#flashcard-word-label").text(`"${word}"`);
  const $sel = $("#flashcard-set-pick").empty();
  if (!state.flashcardSets.length) {
    $sel.append(`<option value="">No sets yet</option>`);
  } else {
    for (const s of state.flashcardSets) $sel.append(`<option value="${s.id}">${s.name} (${s.words.length})</option>`);
  }
  openModal("modal-add-flashcard");
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
  await renderHome();
  showScreen("screen-home");
}

async function init() {
  applyTheme(null, true);
  bindModalDismiss();
  setupLookupResizer();
  showScreen("screen-loading");
  try {
    const res = await fetch(assetUrl("languages.json"));
    if (!res.ok) throw new Error("Could not load languages.json");
    state.catalog = await res.json();
    await refreshAvailability();
    await loadPersistedSettings();
    syncFilterUI();
    setLoadProgress(100, "Ready");
    await routeAfterLoad();
  } catch (err) {
    $("#error-message").text(err.message || String(err));
    showScreen("screen-error");
  }
}

// Events
$("#btn-add-language").on("click", async () => {
  await refreshLearningData();
  $("#add-lang-search").val("");
  renderAddLangGrid();
  openModal("modal-add-lang");
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
  startRevisitPractice().catch((e) => showToast(e.message || "Could not start revisit."));
});

$("#btn-foundations-back").on("click", () => {
  renderLangHub();
  showScreen("screen-lang-hub");
});

$("#btn-settings").on("click", () => {
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
$("#btn-mode-flashcards").on("click", async () => {
  if (!hubLangAvailable()) return showToast("Flashcard practice needs a sentence corpus — coming soon for this language.");
  await seedBuiltinFlashcardSets(state.lang);
  state.flashcardSets = await getFlashcardSets(state.lang);
  renderFlashcardList();
  showScreen("screen-flashcards");
});
$("#btn-flash-back").on("click", () => { renderLangHub(); showScreen("screen-lang-hub"); });
$("#btn-edit-back").on("click", () => { renderFlashcardList(); showScreen("screen-flashcards"); });
$("#btn-back-hub").on("click", () => {
  if (state.practiceMode === "flashcard") showScreen("screen-flashcards");
  else if (state.practiceMode === "article") { renderArticleList(); showScreen("screen-articles"); }
  else { renderLangHub(); showScreen("screen-lang-hub"); }
});
$("#btn-back-menu").on("click", () => {
  if (state.practiceMode === "flashcard") {
    renderPracticeMenu();
    showScreen("screen-menu");
  } else {
    renderPracticeMenu();
    showScreen("screen-menu");
  }
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
$("#btn-custom-start").on("click", () => {
  syncSliders();
  state.sentenceFilters = readSentenceFilters();
  if (state.practiceMode !== "article") state.practiceMode = "zipf";
  startGame(state.zipfLo, state.zipfHi, "Custom");
});
$("#filter-sentences-enable").on("change", syncFilterUI);
$("#filter-words-lo, #filter-words-hi, #filter-avgzipf-lo, #filter-avgzipf-hi").on("input", syncFilterUI);
$("#setting-tts").on("change", async () => {
  state.enableTts = $("#setting-tts").is(":checked");
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
$("#btn-confirm-add-word").on("click", async () => {
  const setId = $("#flashcard-set-pick").val();
  if (!setId) return showToast("Create a set first.");
  try {
    validateFlashcardWord(state.selectedText);
    await addWordToSet(setId, state.selectedText);
    closeModal("modal-add-flashcard");
    showToast("Word added to set.");
  } catch (err) { showToast(err.message); }
});
$("#btn-create-set-inline").on("click", () => {
  state.pendingWordAfterSetCreate = state.selectedText;
  closeModal("modal-add-flashcard");
  openFlashcardSetModal("create");
});

$("#btn-close-lookup, #lookup-overlay").on("click", closeLookupPanel);
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
  const text = window.getSelection()?.toString().trim();
  if (!text || text.length < 2) return hideWordTooltip();
  showSelectionTooltip(text, e.clientX, e.clientY);
});
$(document).on("mousedown", (e) => {
  if (!$(e.target).closest("#sentence-line, #word-tooltip, #modal-add-flashcard").length) hideWordTooltip();
});

init();
