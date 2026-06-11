/** Browser speech synthesis + short feedback tones for practice. */

const SPEECH_LOCALE = {
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

let audioCtx = null;

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

export function stopSpeech() {
  if (window.speechSynthesis) window.speechSynthesis.cancel();
}

export function speakText(text, langCode, { rate = 0.92 } = {}) {
  if (!text || !window.speechSynthesis) return Promise.resolve();
  resumeAudio();
  return new Promise((resolve) => {
    stopSpeech();
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = SPEECH_LOCALE[langCode] || langCode;
    utter.rate = rate;
    utter.onend = () => resolve();
    utter.onerror = () => resolve();
    window.speechSynthesis.speak(utter);
  });
}

export function speakSentence(text, langCode) {
  return speakText(text, langCode, { rate: 0.92 });
}

export function speakWord(word, langCode) {
  const w = word?.trim();
  if (!w) return Promise.resolve();
  return speakText(w, langCode, { rate: 0.88 });
}

export async function feedbackCorrect(sentence, langCode) {
  playCorrectSound();
  await new Promise((r) => setTimeout(r, 320));
  await speakSentence(sentence, langCode);
}

export function feedbackWrong() {
  playWrongSound();
}
