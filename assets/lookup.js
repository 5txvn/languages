/** Word lookup — Wiktionary HTML via API + translation. */

import { translateText } from "./game.js";

const WIKI_API = "https://en.wiktionary.org/w/api.php";

const WIKI_SECTION = {
  es: "Spanish",
  pt: "Portuguese",
  fr: "French",
  it: "Italian",
  de: "German",
  en: "English",
  ja: "Japanese",
  ko: "Korean",
  zh: "Chinese",
};

export function wiktionaryUrl(word) {
  const title = word.trim().replace(/ /g, "_");
  return `https://en.wiktionary.org/wiki/${encodeURIComponent(title)}`;
}

function headingText(el) {
  return (el.querySelector(".mw-headline")?.textContent ?? el.textContent).trim();
}

function extractLanguageSection(div, sectionTitle) {
  if (!sectionTitle) return div;
  const h2s = [...div.querySelectorAll("h2")];
  const startIdx = h2s.findIndex((h) => headingText(h) === sectionTitle);
  if (startIdx < 0) return div;

  const out = document.createElement("div");
  out.className = div.className;

  const first = h2s[startIdx];
  let prev = first.previousElementSibling;
  const prefix = [];
  while (prev) {
    if (prev.tagName === "H2") break;
    if (prev.classList?.contains("hatnote") || prev.classList?.contains("sister-wikipedia")) {
      prefix.unshift(prev);
    }
    prev = prev.previousElementSibling;
  }
  prefix.forEach((n) => out.appendChild(n.cloneNode(true)));
  out.appendChild(first.cloneNode(true));

  let el = first.nextElementSibling;
  while (el && el.tagName !== "H2") {
    out.appendChild(el.cloneNode(true));
    el = el.nextElementSibling;
  }
  return out;
}

export async function fetchWiktionaryHtml(word, langCode) {
  const title = word.trim().replace(/ /g, "_");
  const params = new URLSearchParams({
    action: "parse",
    page: title,
    prop: "text",
    format: "json",
    origin: "*",
    disablelimitreport: "1",
  });
  const res = await fetch(`${WIKI_API}?${params}`);
  if (!res.ok) throw new Error("Wiktionary request failed");
  const data = await res.json();
  if (data.error) throw new Error(data.error.info || "No Wiktionary entry");
  const raw = data.parse?.text?.["*"] ?? "";
  const div = document.createElement("div");
  div.className = "wiki-content mw-parser-output";
  div.innerHTML = raw;

  div.querySelectorAll(
    "script, style, .mw-editsection, .navbox, table.navbox, .metadata, .toc, .mw-jump-link, .interlanguage-link, .mw-empty-elt"
  ).forEach((el) => el.remove());

  div.querySelectorAll("a[href^='/']").forEach((a) => {
    a.setAttribute("href", `https://en.wiktionary.org${a.getAttribute("href")}`);
    a.setAttribute("target", "_blank");
    a.setAttribute("rel", "noopener");
  });

  div.querySelectorAll(".mw-heading").forEach((h) => {
    const level = h.querySelector("h1,h2,h3,h4,h5");
    if (level) h.replaceWith(level);
  });

  const section = WIKI_SECTION[langCode];
  const trimmed = extractLanguageSection(div, section);
  return trimmed.innerHTML;
}

export async function lookupWord(word, fromLang, toLang, cache) {
  const [translation, wikiHtml] = await Promise.all([
    translateText(word, fromLang, toLang, cache).catch(() => "(translation unavailable)"),
    fetchWiktionaryHtml(word, fromLang).catch(() => null),
  ]);
  return { word, translation, wikiHtml, url: wiktionaryUrl(word) };
}
