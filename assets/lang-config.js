/** Per-language module config — theme, flags, confetti, accents. */

export const NEUTRAL = {
  bg: "#f0f0f2",
  card: "#ffffff",
  border: "#d8d8dc",
  text: "#1c1c1e",
  muted: "#6b6b70",
  primary: "#3a3a40",
  secondary: "#5c5c63",
  confetti: ["#3a3a40", "#6b6b70", "#9ca3af", "#d1d5db"],
};

export const LANG_MODULES = {
  es: {
    label: "Spanish",
    country: "es",
    theme: {
      primary: "#e8a317",
      secondary: "#c45c26",
      bg: "#fff9ed",
      card: "#ffffff",
      border: "#e8d4a8",
      text: "#2a2218",
      muted: "#7a6a50",
    },
    confetti: ["#e8a317", "#c45c26", "#c23b3b", "#ffc400", "#f4d03f"],
  },
  pt: {
    label: "Portuguese",
    country: "pt",
    theme: {
      primary: "#1f7a3f",
      secondary: "#c0392b",
      bg: "#f2faf4",
      card: "#ffffff",
      border: "#a8d4b8",
      text: "#142818",
      muted: "#4a6a52",
    },
    confetti: ["#1f7a3f", "#c0392b", "#f4d03f", "#006600"],
  },
  fr: {
    label: "French",
    country: "fr",
    theme: {
      primary: "#2b5ea8",
      secondary: "#c23b3b",
      bg: "#f4f7fc",
      card: "#ffffff",
      border: "#b8c8e8",
      text: "#1a2438",
      muted: "#5a6a82",
    },
    confetti: ["#2b5ea8", "#c23b3b", "#ffffff", "#1e3a8a"],
  },
  it: {
    label: "Italian",
    country: "it",
    theme: {
      primary: "#2d8a4e",
      secondary: "#c23b3b",
      bg: "#f4faf6",
      card: "#ffffff",
      border: "#b0d8be",
      text: "#1a2820",
      muted: "#4a6a54",
    },
    confetti: ["#2d8a4e", "#c23b3b", "#ffffff", "#f4d03f"],
  },
  de: {
    label: "German",
    country: "de",
    theme: {
      primary: "#1a1a1a",
      secondary: "#c23b3b",
      bg: "#f6f6f6",
      card: "#ffffff",
      border: "#c8c8c8",
      text: "#1a1a1a",
      muted: "#5a5a5a",
    },
    confetti: ["#1a1a1a", "#c23b3b", "#f4d03f", "#888888"],
  },
  en: {
    label: "English",
    country: "gb",
    theme: {
      primary: "#2b4a8a",
      secondary: "#c23b3b",
      bg: "#f4f6fa",
      card: "#ffffff",
      border: "#b8c4dc",
      text: "#1a2030",
      muted: "#5a6478",
    },
    confetti: ["#2b4a8a", "#c23b3b", "#ffffff", "#1e3a8a"],
  },
  nl: {
    label: "Dutch",
    country: "nl",
    theme: {
      primary: "#c45c26",
      secondary: "#2b5ea8",
      bg: "#fff8f4",
      card: "#ffffff",
      border: "#e8c8b0",
      text: "#2a2018",
      muted: "#7a6050",
    },
    confetti: ["#c45c26", "#2b5ea8", "#ffffff", "#e8a317"],
  },
  pl: {
    label: "Polish",
    country: "pl",
    theme: {
      primary: "#c23b3b",
      secondary: "#2b5ea8",
      bg: "#fdf4f4",
      card: "#ffffff",
      border: "#e8b8b8",
      text: "#2a1818",
      muted: "#7a5050",
    },
    confetti: ["#c23b3b", "#ffffff", "#2b5ea8", "#e8a317"],
  },
  ru: {
    label: "Russian",
    country: "ru",
    theme: {
      primary: "#2b5ea8",
      secondary: "#c23b3b",
      bg: "#f4f6fc",
      card: "#ffffff",
      border: "#b8c8e8",
      text: "#1a2030",
      muted: "#5a6478",
    },
    confetti: ["#2b5ea8", "#c23b3b", "#ffffff", "#1e3a8a"],
  },
};

export function getModule(code) {
  return LANG_MODULES[code] ?? null;
}

export function confettiColors(code) {
  const mod = getModule(code);
  return mod?.confetti ?? NEUTRAL.confetti;
}
