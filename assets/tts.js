/** Browser speech synthesis + short feedback tones for practice. */

const DEFAULT_LOCALE = {
  es: "es-ES",
  pt: "pt-PT",
  fr: "fr-FR",
  it: "it-IT",
  de: "de-DE",
  en: "en-GB",
  nl: "nl-NL",
  pl: "pl-PL",
  ru: "ru-RU",
};

export const TTS_VARIANTS = {
  pt: [
    { locale: "pt-PT", label: "Portugal" },
    { locale: "pt-BR", label: "Brazil" },
  ],
  es: [
    { locale: "es-ES", label: "Spain" },
    { locale: "es-MX", label: "Mexico" },
    { locale: "es-419", label: "Latin America" },
  ],
  en: [
    { locale: "en-GB", label: "United Kingdom" },
    { locale: "en-US", label: "United States" },
  ],
  fr: [
    { locale: "fr-FR", label: "France" },
    { locale: "fr-CA", label: "Canada" },
  ],
  de: [
    { locale: "de-DE", label: "Germany" },
    { locale: "de-AT", label: "Austria" },
    { locale: "de-CH", label: "Switzerland" },
  ],
  it: [{ locale: "it-IT", label: "Italy" }],
  nl: [{ locale: "nl-NL", label: "Netherlands" }],
  pl: [{ locale: "pl-PL", label: "Poland" }],
  ru: [{ locale: "ru-RU", label: "Russia" }],
};

let ttsLocales = {};
let ttsRate = 0.92;

let audioCtx = null;
let speechEpoch = 0;

export function configureTts({ locales = {}, rate } = {}) {
  if (locales && typeof locales === "object") ttsLocales = { ...locales };
  if (rate != null && !Number.isNaN(+rate)) ttsRate = +rate;
}

export function localeForLang(langCode) {
  return ttsLocales[langCode] || DEFAULT_LOCALE[langCode] || langCode;
}

export function speechRate() {
  return ttsRate;
}

function getAudioCtx() {
  if (!audioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (Ctx) audioCtx = new Ctx();
  }
  return audioCtx;
}

function resumeAudio() {
  const ctx = getAudioCtx();
  if (ctx?.state === "suspended") ctx.resume();
}

function playTone(frequency, durationSec, delaySec = 0) {
  const ctx = getAudioCtx();
  if (!ctx) return;
  resumeAudio();
  const t0 = ctx.currentTime + delaySec;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.frequency.value = frequency;
  osc.type = "sine";
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(0.12, t0 + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + durationSec);
  osc.start(t0);
  osc.stop(t0 + durationSec + 0.05);
}

export function playCorrectSound() {
  playTone(523.25, 0.1, 0);
  playTone(659.25, 0.14, 0.11);
}

export function playWrongSound() {
  playTone(220, 0.18, 0);
  playTone(165, 0.22, 0.14);
}

/** Invalidate in-flight speech (e.g. when advancing to the next sentence). */
export function stopSpeech() {
  speechEpoch += 1;
  if (!window.speechSynthesis) return;
  try {
    window.speechSynthesis.cancel();
    // Chrome sometimes ignores a single cancel while an utterance is queued.
    window.speechSynthesis.pause();
    window.speechSynthesis.cancel();
  } catch {
    /* ignore */
  }
}

function pickVoice(locale) {
  if (!window.speechSynthesis) return null;
  const voices = window.speechSynthesis.getVoices();
  const exact = voices.find((v) => v.lang === locale);
  if (exact) return exact;
  const prefix = locale.slice(0, 2);
  const regional = voices.find((v) => v.lang.replace("_", "-").startsWith(locale));
  if (regional) return regional;
  return voices.find((v) => v.lang.startsWith(prefix)) ?? null;
}

export function speakText(text, langCode, { rate } = {}) {
  if (!text || !window.speechSynthesis) return Promise.resolve();
  resumeAudio();
  const epoch = speechEpoch;
  const locale = localeForLang(langCode);
  const utterRate = rate ?? ttsRate;
  return new Promise((resolve) => {
    if (epoch !== speechEpoch) {
      resolve();
      return;
    }
    try {
      window.speechSynthesis.cancel();
    } catch {
      /* ignore */
    }
    if (epoch !== speechEpoch) {
      resolve();
      return;
    }
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = locale;
    utter.rate = utterRate;
    const voice = pickVoice(locale);
    if (voice) utter.voice = voice;
    const done = () => {
      if (epoch === speechEpoch) resolve();
      else resolve();
    };
    utter.onend = done;
    utter.onerror = done;
    // Defer speak so a cancel from navigation wins the race.
    queueTimeout(() => {
      if (epoch !== speechEpoch) {
        resolve();
        return;
      }
      try {
        window.speechSynthesis.speak(utter);
      } catch {
        resolve();
      }
    }, 0);
  });
}

export function speakSentence(text, langCode) {
  return speakText(text, langCode, { rate: Math.min(1.05, ttsRate + 0.03) });
}

export function speakWord(word, langCode) {
  const w = word?.trim();
  if (!w) return Promise.resolve();
  return speakText(w, langCode, { rate: ttsRate });
}

export async function feedbackCorrect(sentence, langCode) {
  const epoch = speechEpoch;
  playCorrectSound();
  await new Promise((r) => setTimeout(r, 180));
  if (epoch !== speechEpoch) return;
  await speakSentence(sentence, langCode);
}

export function feedbackWrong() {
  playWrongSound();
}

if (typeof window !== "undefined" && window.speechSynthesis) {
  window.speechSynthesis.onvoiceschanged = () => {};
}
