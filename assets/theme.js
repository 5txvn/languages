/** Apply per-language themes from lang-config. */

import { NEUTRAL, getModule } from "./lang-config.js";

export { NEUTRAL };

/** Set false to restore the original soft rounded UI. */
export const USE_RUGGED_THEME = true;

export function applyRuggedTheme() {
  document.documentElement.classList.toggle("theme-rugged", USE_RUGGED_THEME);
}



export function applyTheme(code, neutral = false) {
  applyRuggedTheme();
  const mod = neutral || !code ? null : getModule(code);

  const t = mod?.theme ?? NEUTRAL;

  const root = document.documentElement;

  root.style.setProperty("--bg", t.bg ?? NEUTRAL.bg);

  root.style.setProperty("--card", t.card ?? NEUTRAL.card);

  root.style.setProperty("--border", t.border ?? NEUTRAL.border);

  root.style.setProperty("--text", t.text ?? NEUTRAL.text);

  root.style.setProperty("--muted", t.muted ?? NEUTRAL.muted);

  root.style.setProperty("--primary", t.primary ?? NEUTRAL.primary);

  root.style.setProperty("--secondary", mod?.theme?.secondary ?? t.primary ?? NEUTRAL.secondary);

  root.style.setProperty("--hot", t.primary ?? NEUTRAL.primary);
  root.style.setProperty("--accent", t.primary ?? NEUTRAL.primary);

  document.body.style.background = t.bg ?? NEUTRAL.bg;

  document.body.style.color = t.text ?? NEUTRAL.text;

}


