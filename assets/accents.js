/** Accent characters, slash commands, and hold-to-accent helpers. */

export const ACCENT_CHARS = {
  es: ["á", "é", "í", "ó", "ú", "ü", "ñ", "¿", "¡"],
  en: [],
  de: ["ä", "ö", "ü", "ß"],
  fr: ["à", "â", "æ", "ç", "é", "è", "ê", "ë", "î", "ï", "ô", "œ", "ù", "û", "ü", "ÿ"],
  it: ["à", "è", "é", "ì", "ò", "ù"],
  pt: ["á", "â", "ã", "à", "ç", "é", "ê", "í", "ó", "ô", "õ", "ú"],
  nl: ["á", "ä", "é", "ë", "í", "ï", "ó", "ö", "ú", "ü"],
  pl: ["ą", "ć", "ę", "ł", "ń", "ó", "ś", "ź", "ż"],
  ru: ["ё", "й", "ъ", "ы", "ь", "э", "ю", "я"],
};

/** Default hold-to-accent for each base letter (most common form in that language). */
export const HOLD_DEFAULTS = {
  es: { a: "á", e: "é", i: "í", o: "ó", u: "ú", n: "ñ" },
  pt: { a: "á", e: "é", i: "í", o: "ó", u: "ú", c: "ç", n: "ã" },
  fr: { a: "à", e: "é", i: "î", o: "ô", u: "ù", c: "ç" },
  de: { a: "ä", o: "ö", u: "ü", s: "ß" },
  it: { a: "à", e: "è", i: "ì", o: "ò", u: "ù" },
  pl: { a: "ą", c: "ć", e: "ę", l: "ł", n: "ń", o: "ó", s: "ś", z: "ź" },
  nl: { a: "á", e: "é", i: "í", o: "ó", u: "ú" },
  ru: { e: "ё", u: "ю", y: "ы" },
};

/** Longest commands first. */
export const ACCENT_COMMANDS = [
  ["/aa", "á"], ["/ag", "à"],
  ["/ee", "é"], ["/ea", "é"], ["/eg", "è"], ["/ec", "ê"], ["/ed", "ë"],
  ["/ii", "í"], ["/ia", "í"], ["/ig", "ì"], ["/ic", "î"], ["/id", "ï"],
  ["/oo", "ó"], ["/oa", "ó"], ["/og", "ò"], ["/oc", "ô"], ["/od", "ö"],
  ["/uu", "ú"], ["/ua", "ú"], ["/ug", "ù"], ["/uc", "û"], ["/ud", "ü"],
  ["/nn", "ñ"], ["/n~", "ñ"],
  ["/a~", "ã"], ["/at", "ã"], ["/ac", "â"],
  ["/o~", "õ"], ["/ot", "õ"],
  ["/cc", "ç"], ["/ss", "ß"],
  ["/ae", "æ"], ["/oe", "œ"],
  ["/??", "¿"], ["/!!", "¡"],
  ["/yo", "ё"], ["/yu", "ю"], ["/ya", "я"],
].sort((a, b) => b[0].length - a[0].length);

export const COMMAND_HELP = [
  { cmd: "/ea, /ee, /ec", result: "é, è, ê" },
  { cmd: "/ia, /ig", result: "í, ì" },
  { cmd: "/oa, /og", result: "ó, ò" },
  { cmd: "/ua, /ug", result: "ú, ù" },
  { cmd: "/aa", result: "á" },
  { cmd: "/nn", result: "ñ" },
  { cmd: "/a~, /at", result: "ã" },
  { cmd: "/o~, /ot", result: "õ" },
  { cmd: "/ac", result: "â" },
  { cmd: "/cc", result: "ç" },
  { cmd: "/ss", result: "ß" },
];

export const HOLD_ACCENT_HELP = [
  { keys: "a, e, i, o, u", detail: "Hold for the most common accented form in this language (or the answer letter if the word needs it)" },
  { keys: "n", detail: "Hold for ñ in Spanish, ń in Polish, etc." },
  { keys: "Other letters", detail: "Hold for language-specific accents (ç, ß, ą, …)" },
];

const MAX_SLASH_EXTRA = 8;

export function charsFor(lang) {
  return ACCENT_CHARS[lang] ?? [];
}

export function resolveSlashInput(text) {
  let out = text;
  let changed = true;
  while (changed) {
    changed = false;
    for (const [cmd, ch] of ACCENT_COMMANDS) {
      if (out.includes(cmd)) {
        out = out.split(cmd).join(ch);
        changed = true;
      }
    }
  }
  return out;
}

export function hasPendingSlash(raw) {
  const idx = raw.lastIndexOf("/");
  if (idx === -1) return false;
  const tail = raw.slice(idx);
  if (ACCENT_COMMANDS.some(([cmd]) => cmd === tail)) return false;
  return /^\/[a-z?!]{0,3}$/i.test(tail);
}

export function collapseSlashCommands(raw) {
  if (!raw || hasPendingSlash(raw)) return raw;
  return resolveSlashInput(raw);
}

export function maxRawLength(remainingChars) {
  return remainingChars + MAX_SLASH_EXTRA;
}

/** Match answer at position, else use the language's default accented form. */
export function accentForHold(baseChar, answer, position, lang) {
  if (answer && position >= 0 && position < answer.length) {
    const target = answer[position];
    const base = baseChar.normalize("NFD")[0]?.toLowerCase();
    const targetBase = target.normalize("NFD")[0]?.toLowerCase();
    if (base && targetBase === base) return target;
  }
  const base = baseChar.normalize("NFD")[0]?.toLowerCase();
  if (!base) return null;
  return HOLD_DEFAULTS[lang]?.[base] ?? null;
}

