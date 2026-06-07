#!/usr/bin/env python3
"""
Extract high-quality sentences from a Wikipedia XML dump (multi-language).

Usage:
  python extract_sentences.py --lang es --dump eswiki.xml.bz2
  python extract_sentences.py --lang de --count 1000
"""

from __future__ import annotations

import argparse
import bz2
import hashlib
import html
import math
import sys
import unicodedata
from pathlib import Path

import mwxml
import mwparserfromhell
import regex
import spacy
from langdetect import DetectorFactory, detect
from tqdm import tqdm
from wordfreq import word_frequency, zipf_frequency

from languages import LanguageProfile, get_profile, list_languages

DetectorFactory.seed = 0

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

DEFAULT_DUMP = Path(__file__).resolve().parent / "eswiki-latest-pages-articles.xml.bz2"
DEFAULT_LANG = "es"
TARGET_COUNT: int | None = None

MIN_WORDS = 5
MAX_WORDS = 15
MIN_ALPHA_RATIO = 0.75
MIN_VERB_OR_ADJ_RATIO = 0.15
FIGURE_KEEP_RATE = 0.10
PERCENTAGE_KEEP_RATE = 0.20
MAX_GPE_LOC = 2
MAX_PROPN = 2
LANG_VERIFY_THRESHOLD = 0.80
LANG_VERIFY_SAMPLES = 20
ADD_READABILITY_SCORES = False
MAIN_NAMESPACE = 0
MAX_ARTICLE_CHARS = 30_000

# Language-agnostic patterns
WIKI_ARTIFACT_PATTERN = regex.compile(
    r"(\{\{|\}\}|\[\[|\]\]|<ref|</ref>|<!--|-->|"
    r"\|thumb|\|miniatura|miniaturadeimagen|deimagen|"
    r"File:|Archivo:|Categoría:|Category:|ISBN|ISSN)",
    flags=regex.IGNORECASE,
)
URL_PATTERN = regex.compile(
    r"(https?://|www\.|\b[a-z0-9-]+\.(org|com|net|edu|gov)\b)",
    flags=regex.IGNORECASE,
)
DIGIT_HEAVY_PATTERN = regex.compile(r"\d{5,}")
PAREN_BRACKET_PATTERN = regex.compile(r"[\[\](){}|<>]")
MULTISPACE_PATTERN = regex.compile(r"\s+")
SENTENCE_END_PATTERN = regex.compile(r"[.!?。！？]$")
YEAR_PATTERN = regex.compile(r"\b\d{3,4}\b")
ACRONYM_PATTERN = regex.compile(r"\b[A-Z]{2,}(?:\.[A-Z0-9]+)*\b")
ALL_CAPS_WORD_PATTERN = regex.compile(r"\b[A-ZÁÉÍÓÚÜÑÄÖÜÀ-ÿ]{2,}\b")
TECH_CODE_PATTERN = regex.compile(r"\b[A-Z]{2,}\s+[A-Z]\.?\d|\b[A-Z]{2,}\s+\d{2,}\b")
PERCENTAGE_PATTERN = regex.compile(r"\d+[,.]?\d*\s*%")
GLUED_TOKEN_PATTERN = regex.compile(
    r"[a-záéíóúüñ]\d|\d[a-záéíóúüñ]|[a-záéíóúüñ]{2,}[A-Z]{2,}|\b\w+\d{3,}\w*\b",
    flags=regex.IGNORECASE,
)
BIBLIOGRAPHY_PATTERN = regex.compile(
    r"\b(Ed\.|imp\.|vol\.|pp\.|Universidad|University|Ministerio|Ministry|Revista|Journal|"
    r"sitio digital|Department|Faculty)\b",
    flags=regex.IGNORECASE,
)
FOREIGN_PATTERN = regex.compile(
    r"\b(Etymologie|Étymologie|catalogue|He is|Plant Systematics|sine die)\b|"
    r"\b(the|and|with|from|website)\b",
    flags=regex.IGNORECASE,
)
AWARD_FRAGMENT_PATTERN = regex.compile(
    r"^(Medalla|Medal|Nombrado|Galardón|Premio|Award|Doctor honoris)\b",
    flags=regex.IGNORECASE,
)
NAME_LIST_PATTERN = regex.compile(
    r"\b(de|del|con|y|and|et|und)\s+[A-ZÁÉÍÓÚÜÑÀ-ÿ][a-záéíóúüñà-ÿ]+"
    r"(?:,\s+[A-ZÁÉÍÓÚÜÑÀ-ÿ][a-záéíóúüñà-ÿ]+){3,}",
)
DANGLING_END_PATTERN = regex.compile(
    r"\b(al|del|de|en|a|y|el|la|los|las|un|una|the|and|der|die|das)\s*\.$",
    flags=regex.IGNORECASE,
)
MISSING_CONTENT_PATTERN = regex.compile(
    r"\b(del|de|en|el|la|al|un|una|mediados|the)\s+,",
    flags=regex.IGNORECASE,
)
TABLE_FRAGMENT_PATTERN = regex.compile(
    r"\b(Ene|Feb|Mar|Abr|May|Jun|Jul|Ago|Sep|Oct|Nov|Dic|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\.$"
)
DATE_WORDS = frozenset(
    "enero february january monday lunes década siglo enero febrero marzo april may jun july "
    "agosto september october november december".split()
)
CONTENT_POS = {"VERB", "AUX", "ADJ", "NOUN", "PROPN"}

NOISE_PATTERNS = [
    regex.compile(p, flags=regex.IGNORECASE)
    for p in (
        r"<[^>]+>",
        r"\[\[(?:[^|\]]+\|)?([^\]]+)\]\]",
        r"\{\{[^}]+\}\}",
        r"\[\[Category:[^\]]+\]\]",
        r"\[\[Categoría:[^\]]+\]\]",
        r"\[\[File:[^\]]+\]\]",
        r"\[\[Archivo:[^\]]+\]\]",
        r"<ref[^>]*>.*?</ref>",
        r"<ref[^>]*/>",
        r"<!--.*?-->",
        r"'''+?|''+",
        r"={2,6}\s*([^=]+?)\s*={2,6}",
        r"^\s*[*#:;].*$",
    )
]

# Active profile set at runtime
PROFILE: LanguageProfile = get_profile(DEFAULT_LANG)


def load_spacy_model(profile: LanguageProfile) -> spacy.Language:
    try:
        nlp = spacy.load(profile.spacy_model)
    except OSError:
        from spacy.cli import download

        print(f"Downloading spaCy model {profile.spacy_model} (one-time)...", file=sys.stderr)
        download(profile.spacy_model)
        nlp = spacy.load(profile.spacy_model)
    nlp.select_pipes(disable=["lemmatizer"])
    return nlp


def is_redirect(raw: str, profile: LanguageProfile) -> bool:
    stripped = raw.lstrip()
    upper = stripped.upper()
    return any(upper.startswith(m.upper()) for m in profile.redirect_markers)


def clean_wikitext(raw: str, profile: LanguageProfile) -> str:
    if not raw or is_redirect(raw, profile):
        return ""
    text = html.unescape(raw)
    text = regex.sub(r"(?i)(thumb\||miniaturadeimagen|deimagen\|)[^\n]*", " ", text)
    try:
        parsed = mwparserfromhell.parse(text)
        text = parsed.strip_code(normalize=True, collapse=True)
    except Exception:
        pass
    for pattern in NOISE_PATTERNS:
        text = pattern.sub(" ", text)
    text = WIKI_ARTIFACT_PATTERN.sub(" ", text)
    return MULTISPACE_PATTERN.sub(" ", text).strip()


def normalize_for_dedup(sentence: str) -> str:
    folded = unicodedata.normalize("NFKD", sentence.lower())
    return "".join(c for c in folded if not unicodedata.combining(c)).strip()


def word_tokens(sentence: str, profile: LanguageProfile) -> list[str]:
    return regex.findall(profile.word_pattern, sentence, flags=regex.UNICODE)


def alpha_ratio(sentence: str) -> float:
    letters = sum(1 for c in sentence if c.isalpha())
    total = len(sentence.replace(" ", ""))
    return letters / total if total else 0.0


def stochastic_keep(sentence: str, rate: float = FIGURE_KEEP_RATE, salt: str = "") -> bool:
    key = f"{salt}:{sentence}" if salt else sentence
    bucket = int(hashlib.md5(key.encode("utf-8")).hexdigest()[:8], 16) % 1000
    return bucket < int(rate * 1000)


def has_percentage(sentence: str) -> bool:
    return bool(PERCENTAGE_PATTERN.search(sentence))


def token_entity_label(token, doc_sentence) -> str | None:
    for ent in doc_sentence.ents:
        if ent.start <= token.i < ent.end:
            return ent.label_
    return None


def is_recognized_proper_noun(token, profile: LanguageProfile) -> bool:
    if not token.is_oov:
        return True
    return zipf_frequency(token.text.lower(), profile.code) >= 3.5


def passes_capitalization_rules(doc_sentence, profile: LanguageProfile) -> bool:
    if not profile.uses_capitalization_filter:
        return True
    for token in doc_sentence:
        if not token.is_alpha or len(token.text) < 2:
            continue
        text = token.text
        if text.isupper():
            return False
        if token.i == 0:
            continue
        if not text[0].isupper():
            continue
        ent_label = token_entity_label(token, doc_sentence)
        if ent_label in {"PER", "ORG"}:
            return False
        if ent_label in {"GPE", "LOC"}:
            continue
        if is_recognized_proper_noun(token, profile):
            continue
        if token.pos_ == "PROPN" and token.is_oov:
            return False
        return False
    return True


def compute_readability(sentence: str, doc_sentence, profile: LanguageProfile) -> dict[str, float]:
    words = [t.text.lower() for t in doc_sentence if t.is_alpha and len(t.text) > 1]
    if not words:
        return {"avg_zipf": 0.0, "rare_ratio": 1.0, "pseudo_ppl": 999.0}
    zipfs = [zipf_frequency(w, profile.code) for w in words]
    avg_zipf = sum(zipfs) / len(zipfs)
    rare_ratio = sum(1 for z in zipfs if z < 3.0) / len(zipfs)
    log_probs = [math.log(max(word_frequency(w, profile.code), 1e-10)) for w in words]
    pseudo_ppl = math.exp(-sum(log_probs) / len(log_probs))
    return {
        "avg_zipf": round(avg_zipf, 2),
        "rare_ratio": round(rare_ratio, 2),
        "pseudo_ppl": round(pseudo_ppl, 1),
    }


def format_output_line(sentence: str, doc_sentence, profile: LanguageProfile) -> str:
    if not ADD_READABILITY_SCORES:
        return sentence
    scores = compute_readability(sentence, doc_sentence, profile)
    return f"{sentence}\tzipf={scores['avg_zipf']}\trare={scores['rare_ratio']}\tppl={scores['pseudo_ppl']}"


def is_figure_heavy(sentence: str, tokens: list[str]) -> bool:
    score = sum(
        1
        for t in tokens
        if YEAR_PATTERN.fullmatch(t) or regex.fullmatch(r"\d+[,.]?\d*", t)
    )
    if score >= 3:
        return True
    return bool(tokens) and score / len(tokens) >= 0.25


def has_finite_verb(doc_sentence) -> bool:
    return any(t.pos_ == "VERB" for t in doc_sentence)


def passes_entity_rules(doc_sentence) -> bool:
    gpe_loc = propn = 0
    for ent in doc_sentence.ents:
        if ent.label_ in {"PER", "ORG"}:
            return False
        if ent.label_ in {"GPE", "LOC"}:
            gpe_loc += 1
    for token in doc_sentence:
        if token.pos_ == "PROPN":
            propn += 1
    return gpe_loc <= MAX_GPE_LOC and propn <= MAX_PROPN


def passes_strict_criteria(sentence: str, doc_sentence, profile: LanguageProfile) -> bool:
    sentence = sentence.strip()
    if not sentence:
        return False

    tokens = word_tokens(sentence, profile)
    word_count = len(tokens)
    if word_count < MIN_WORDS or word_count > MAX_WORDS:
        return False

    if not regex.match(profile.sentence_start, sentence):
        return False
    if not SENTENCE_END_PATTERN.search(sentence):
        return False
    if not has_finite_verb(doc_sentence):
        return False

    for token in tokens:
        if GLUED_TOKEN_PATTERN.search(token):
            return False
    if TECH_CODE_PATTERN.search(sentence) or ACRONYM_PATTERN.findall(sentence):
        return False
    if not profile.allowed_char_pattern.match(sentence):
        return False
    if (
        WIKI_ARTIFACT_PATTERN.search(sentence)
        or URL_PATTERN.search(sentence)
        or PAREN_BRACKET_PATTERN.search(sentence)
        or DIGIT_HEAVY_PATTERN.search(sentence)
    ):
        return False
    if alpha_ratio(sentence) < MIN_ALPHA_RATIO:
        return False

    normalized = normalize_for_dedup(sentence)
    if any(normalized.startswith(p.lower()) for p in profile.blocked_prefixes):
        return False
    if (
        BIBLIOGRAPHY_PATTERN.search(sentence)
        or FOREIGN_PATTERN.search(sentence)
        or AWARD_FRAGMENT_PATTERN.search(sentence)
        or NAME_LIST_PATTERN.search(sentence)
    ):
        return False
    if is_figure_heavy(sentence, tokens) and not stochastic_keep(sentence, FIGURE_KEEP_RATE, "figure"):
        return False
    if has_percentage(sentence) and not stochastic_keep(sentence, PERCENTAGE_KEEP_RATE, "percent"):
        return False
    if ALL_CAPS_WORD_PATTERN.search(sentence):
        return False
    if not passes_capitalization_rules(doc_sentence, profile):
        return False
    if len(set(t.lower() for t in tokens)) < 2:
        return False

    content = [t for t in doc_sentence if t.pos_ in CONTENT_POS and not t.is_stop]
    if len(content) < 2 or len(content) / max(word_count, 1) < MIN_VERB_OR_ADJ_RATIO:
        return False
    if not passes_entity_rules(doc_sentence):
        return False
    if DANGLING_END_PATTERN.search(sentence) or MISSING_CONTENT_PATTERN.search(sentence):
        return False
    if TABLE_FRAGMENT_PATTERN.search(sentence):
        return False
    if profile.catalan_markers and profile.catalan_markers.search(sentence):
        return False
    if ":" in sentence or ";" in sentence:
        return False
    return True


def open_dump(path: Path):
    if str(path).endswith(".bz2"):
        return bz2.open(path, "rb")
    return open(path, "rb")


def iter_main_article_texts(dump_path: Path):
    with open_dump(dump_path) as dump_file:
        dump = mwxml.Dump.from_file(dump_file)
        for page in dump:
            if page.namespace != MAIN_NAMESPACE:
                continue
            for revision in page:
                text = revision.text
                if not text or len(text) < 80:
                    break
                if is_redirect(text, PROFILE):
                    break
                yield page.title, text[:MAX_ARTICLE_CHARS]
                break


def detected_matches_profile(detected: str, profile: LanguageProfile) -> bool:
    d = detected.lower().strip()
    if d in profile.langdetect_codes:
        return True
    base = d.split("-")[0]
    return base == profile.code


def verify_dump_language(dump_path: Path, profile: LanguageProfile) -> None:
    """Fail fast if dump language doesn't match --lang (80% threshold)."""
    samples: list[str] = []
    nlp = load_spacy_model(profile)

    for _title, raw in iter_main_article_texts(dump_path):
        plain = clean_wikitext(raw, profile)
        if len(plain) < 60:
            continue
        try:
            doc = nlp(plain[:8000])
        except ValueError:
            continue
        for sent in doc.sents:
            text = MULTISPACE_PATTERN.sub(" ", sent.text.strip())
            if len(text) >= 40:
                samples.append(text)
            if len(samples) >= LANG_VERIFY_SAMPLES:
                break
        if len(samples) >= LANG_VERIFY_SAMPLES:
            break

    if len(samples) < 5:
        print("Warning: too few samples for language verification; skipping check.", file=sys.stderr)
        return

    matches = 0
    counts: dict[str, int] = {}
    for text in samples:
        try:
            detected = detect(text)
        except Exception:
            detected = "unknown"
        counts[detected] = counts.get(detected, 0) + 1
        if detected_matches_profile(detected, profile):
            matches += 1

    ratio = matches / len(samples)
    if ratio < LANG_VERIFY_THRESHOLD:
        dominant = max(counts, key=counts.get)
        print(
            f"\nERROR: Language conflict detected.\n"
            f"  Selected : {profile.code} ({profile.name})\n"
            f"  Detected : {dominant} ({counts[dominant]}/{len(samples)} samples)\n"
            f"  Match ratio: {ratio:.0%} (need ≥{LANG_VERIFY_THRESHOLD:.0%})\n"
            f"  Detection breakdown: {counts}\n"
            f"Use the correct --lang or a dump for {profile.name}.",
            file=sys.stderr,
        )
        sys.exit(3)


def extract_sentences(
    dump_path: Path,
    output_path: Path,
    profile: LanguageProfile,
    target: int | None,
) -> int:
    nlp = load_spacy_model(profile)
    nlp.max_length = 200_000
    seen: set[str] = set()
    count = 0

    output_path.parent.mkdir(parents=True, exist_ok=True)
    pbar = tqdm(total=target, desc=f"Collecting ({profile.code})", unit="sent")

    with output_path.open("w", encoding="utf-8", newline="\n") as out_file:
        out_file.write(f"# lang={profile.code}\n")
        for _title, raw_wikitext in iter_main_article_texts(dump_path):
            if target is not None and count >= target:
                break
            plain = clean_wikitext(raw_wikitext, profile)
            if len(plain) < 40:
                continue
            try:
                doc = nlp(plain)
            except ValueError:
                continue
            for sent in doc.sents:
                if target is not None and count >= target:
                    break
                text = MULTISPACE_PATTERN.sub(" ", sent.text.strip())
                key = normalize_for_dedup(text)
                if not key or key in seen:
                    continue
                if not passes_strict_criteria(text, sent, profile):
                    continue
                seen.add(key)
                out_file.write(format_output_line(text, sent, profile) + "\n")
                count += 1
                pbar.update(1)

    pbar.close()
    return count


def parse_count(value: str) -> int | None:
    if value.lower() in {"none", "all", "unlimited"}:
        return None
    return int(value)


def main() -> None:
    global PROFILE

    parser = argparse.ArgumentParser(
        description="Extract readable sentences from a Wikipedia XML dump.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=f"Supported languages: {list_languages()}",
    )
    parser.add_argument("--dump", type=Path, default=DEFAULT_DUMP)
    parser.add_argument("--lang", default=DEFAULT_LANG, help="Language code (default: es)")
    parser.add_argument(
        "--output",
        type=Path,
        default=None,
        help="Output file (default: sentences_<lang>.txt)",
    )
    parser.add_argument("--count", type=parse_count, default=TARGET_COUNT)
    parser.add_argument(
        "--skip-lang-check",
        action="store_true",
        help="Skip dump language verification",
    )
    args = parser.parse_args()

    PROFILE = get_profile(args.lang)
    output = args.output or Path(__file__).resolve().parent / f"sentences_{PROFILE.code}.txt"

    if not args.dump.exists():
        print(f"Dump not found: {args.dump}", file=sys.stderr)
        sys.exit(1)

    print(f"Language : {PROFILE.name} ({PROFILE.code})", file=sys.stderr)
    print(f"Dump     : {args.dump}", file=sys.stderr)
    print(f"Output   : {output}", file=sys.stderr)

    if not args.skip_lang_check:
        print(f"Verifying dump language (≥{LANG_VERIFY_THRESHOLD:.0%} match)...", file=sys.stderr)
        verify_dump_language(args.dump, PROFILE)

    n = extract_sentences(args.dump, output, PROFILE, target=args.count)
    print(f"Wrote {n} sentences to {output}", file=sys.stderr)

    if args.count is not None and n < args.count:
        sys.exit(2)


if __name__ == "__main__":
    main()
