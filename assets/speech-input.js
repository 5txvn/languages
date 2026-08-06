/** Browser speech recognition for hands-free fill-in-the-blank answers. */

const SpeechRecognitionAPI =
  typeof window !== "undefined"
    ? window.SpeechRecognition || window.webkitSpeechRecognition
    : null;

const DEFAULT_LOCALE = {
  es: "es-ES",
  pt: "pt-BR",
  fr: "fr-FR",
  it: "it-IT",
  de: "de-DE",
  en: "en-US",
  nl: "nl-NL",
  pl: "pl-PL",
  ru: "ru-RU",
};

export function speechRecognitionSupported() {
  return Boolean(SpeechRecognitionAPI);
}

/** Last whitespace-separated token from a transcript, letters only. */
export function lastSpokenWord(transcript) {
  const parts = String(transcript || "")
    .normalize("NFC")
    .trim()
    .split(/\s+/)
    .map((p) => p.replace(/^[^\p{L}\p{M}']+|[^\p{L}\p{M}']+$/gu, ""))
    .filter(Boolean);
  return parts.length ? parts[parts.length - 1] : "";
}

/**
 * Continuous listener that reports the most recent spoken word.
 * Chrome often ends sessions after silence — auto-restarts while enabled.
 */
export function createSpeechListener({ onWord, onError, getLang } = {}) {
  if (!SpeechRecognitionAPI) {
    return {
      supported: false,
      start() {},
      stop() {},
      pause() {},
      resume() {},
      setLang() {},
      get listening() {
        return false;
      },
    };
  }

  let recognition = null;
  let wanted = false;
  let paused = false;
  let restartTimer = null;
  let lastEmitted = "";
  let lastEmitAt = 0;

  function localeFor(lang) {
    const code = (typeof getLang === "function" ? getLang() : lang) || "en";
    if (code.includes("-")) return code;
    return DEFAULT_LOCALE[code] || `${code}-${String(code).toUpperCase()}`;
  }

  function clearRestart() {
    if (restartTimer) {
      clearTimeout(restartTimer);
      restartTimer = null;
    }
  }

  function emitWord(transcript, isFinal) {
    const word = lastSpokenWord(transcript);
    if (!word) return;
    const now = Date.now();
    // Ignore duplicate interim spam for the same token.
    if (!isFinal && word === lastEmitted && now - lastEmitAt < 400) return;
    lastEmitted = word;
    lastEmitAt = now;
    onWord?.(word, { isFinal });
  }

  function ensure() {
    if (recognition) return recognition;
    const rec = new SpeechRecognitionAPI();
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.lang = localeFor();

    rec.onresult = (event) => {
      if (paused || !wanted) return;
      let interim = "";
      let finalChunk = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const res = event.results[i];
        const text = res?.[0]?.transcript || "";
        if (res.isFinal) finalChunk += ` ${text}`;
        else interim += ` ${text}`;
      }
      if (finalChunk.trim()) emitWord(finalChunk, true);
      else if (interim.trim()) emitWord(interim, false);
    };

    rec.onerror = (event) => {
      const err = event?.error || "error";
      // Benign / expected — no toast spam.
      if (err === "no-speech" || err === "aborted" || err === "audio-capture") return;
      if (err === "not-allowed" || err === "service-not-allowed") {
        wanted = false;
        onError?.(err);
      }
    };

    rec.onend = () => {
      recognition = null;
      if (!wanted || paused) return;
      clearRestart();
      restartTimer = setTimeout(() => {
        restartTimer = null;
        if (wanted && !paused) startInternal();
      }, 180);
    };

    recognition = rec;
    return rec;
  }

  function startInternal() {
    if (!wanted || paused) return;
    try {
      const rec = ensure();
      rec.lang = localeFor();
      rec.start();
    } catch (err) {
      // InvalidStateError if already started — ignore.
      if (String(err?.name || err).includes("InvalidState")) return;
    }
  }

  return {
    supported: true,
    get listening() {
      return wanted && !paused;
    },
    setLang(lang) {
      if (recognition) recognition.lang = localeFor(lang);
    },
    start() {
      wanted = true;
      paused = false;
      lastEmitted = "";
      startInternal();
    },
    stop() {
      wanted = false;
      paused = false;
      clearRestart();
      lastEmitted = "";
      try {
        recognition?.abort();
      } catch {
        /* ignore */
      }
      recognition = null;
    },
    pause() {
      paused = true;
      clearRestart();
      try {
        recognition?.stop();
      } catch {
        /* ignore */
      }
    },
    resume() {
      if (!wanted) return;
      paused = false;
      startInternal();
    },
  };
}
