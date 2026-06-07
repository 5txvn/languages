#!/usr/bin/env node
/**
 * Full-screen CLI fill-in-the-blank language practice.
 */

import fs from "fs";
import path from "path";
import readline from "readline";
import { fileURLToPath } from "url";
import chalk from "chalk";
import { translate } from "@vitalets/google-translate-api";
import { zipfFrequency, loadZipfDict, readLangFromFile } from "./zipf.js";

process.noDeprecation = true;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_SENTENCES = path.join(__dirname, "sentences.txt");
const TARGET_LANG = "en";
const WORD_PATTERN = /\b[\wáéíóúüñÁÉÍÓÚÜÑàèéìòùäöüß'-]+\b/gu;

const DIFFICULTY_LEVELS = [
  { name: "Beginner", lo: 5.0, hi: 5.5 },
  { name: "Easy", lo: 4.5, hi: 5.0 },
  { name: "Medium", lo: 4.0, hi: 4.5 },
  { name: "Challenging", lo: 3.5, hi: 4.0 },
  { name: "Hard", lo: 3.0, hi: 3.5 },
  { name: "Expert", lo: 2.5, hi: 3.0 },
];

function clearScreen() {
  process.stdout.write("\x1Bc");
}

function normalizeWord(s) {
  return s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

function wordsMatch(guess, answer) {
  return normalizeWord(guess) === normalizeWord(answer);
}

function formatRange(lo, hi) {
  return `zipf ${lo.toFixed(1)} – ${hi.toFixed(1)}`;
}

function tokenize(sentence) {
  return sentence.match(WORD_PATTERN) ?? [];
}

function sentenceOnly(line) {
  if (line.startsWith("#")) return null;
  return line.split("\t", 1)[0].trim();
}

function zipfInRange(word, lo, hi, lang) {
  const z = zipfFrequency(word.toLowerCase(), lang);
  return z >= lo && z < hi;
}

function eligibleBlankIndices(tokens, lo, hi, lang) {
  const indices = [];
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok.length < 3 || !/^\p{L}+$/u.test(tok)) continue;
    if (zipfInRange(tok, lo, hi, lang)) indices.push(i);
  }
  return indices;
}

function randomLine(filePath) {
  const stat = fs.statSync(filePath);
  if (stat.size === 0) throw new Error(`${filePath} is empty`);
  const fd = fs.openSync(filePath, "r");
  const buf = Buffer.alloc(4096);
  try {
    for (let attempt = 0; attempt < 100; attempt++) {
      const pos = Math.floor(Math.random() * stat.size);
      fs.readSync(fd, buf, 0, buf.length, pos);
      const lines = buf
        .toString("utf8")
        .split("\n")
        .map(sentenceOnly)
        .filter(Boolean);
      if (lines.length > 0) return lines[Math.floor(Math.random() * lines.length)];
    }
  } finally {
    fs.closeSync(fd);
  }
  throw new Error("Could not read a sentence from file");
}

function buildPuzzle(filePath, lo, hi, lang, maxTries = 120) {
  for (let i = 0; i < maxTries; i++) {
    const sentence = randomLine(filePath);
    const tokens = tokenize(sentence);
    if (tokens.length < 5) continue;
    const candidates = eligibleBlankIndices(tokens, lo, hi, lang);
    if (candidates.length === 0) continue;
    const blankIndex = candidates[Math.floor(Math.random() * candidates.length)];
    return { sentence, tokens, blankIndex, answer: tokens[blankIndex] };
  }
  return null;
}

function combinedGuess(answer, typed, hintChars) {
  return answer.slice(0, hintChars) + typed;
}

function renderBlank(tokens, blankIndex, answer, typed, hintChars, reveal = false) {
  return tokens
    .map((tok, i) => {
      if (i !== blankIndex) return chalk.white(tok);
      if (reveal) return chalk.red.bold(answer);

      const combined = combinedGuess(answer, typed, hintChars);
      const target = normalizeWord(answer);
      const current = normalizeWord(combined);
      const match = combined.length > 0 && (current === target || target.startsWith(current));
      const fillColor = match ? chalk.green.bold : chalk.red.bold;
      const underscores = "_".repeat(Math.max(0, answer.length - combined.length));
      return fillColor(combined) + chalk.dim(underscores);
    })
    .join(chalk.dim(" "));
}

async function translateSentence(text, sourceLang, cache) {
  const key = `${sourceLang}:${text}`;
  if (cache.has(key)) return cache.get(key);
  const { text: result } = await translate(text, { from: sourceLang, to: TARGET_LANG });
  cache.set(key, result);
  return result;
}

function drawHeader(points, levelName) {
  const titlePlain = `Language Practice (${levelName})`;
  const scorePlain = `Score: ${points}`;
  const pad = Math.max(1, 64 - titlePlain.length - scorePlain.length);
  console.log(chalk.bold.black(titlePlain) + " ".repeat(pad) + chalk.bold.green(scorePlain));
  console.log(chalk.dim("─".repeat(64)));
}

function drawGameScreen({ puzzle, translation, typed, hintChars, points, levelName, reveal, footer }) {
  clearScreen();
  drawHeader(points, levelName);
  console.log();
  console.log(renderBlank(puzzle.tokens, puzzle.blankIndex, puzzle.answer, typed, hintChars, reveal));
  console.log();
  console.log(chalk.underline(translation));
  console.log();
  console.log(chalk.dim(footer));
}

function drawMenuScreen() {
  clearScreen();
  console.log(chalk.bold.black("Language Practice"));
  console.log(chalk.dim("─".repeat(64)));
  console.log();
  console.log(chalk.white.bold("Choose word difficulty\n"));
  for (let i = 0; i < DIFFICULTY_LEVELS.length; i++) {
    const { name, lo, hi } = DIFFICULTY_LEVELS[i];
    console.log(
      `  ${chalk.cyan.bold(String(i + 1))}. ${chalk.white(name.padEnd(14))} ${chalk.dim(`(${formatRange(lo, hi)})`)}`
    );
  }
  console.log();
  console.log(chalk.dim("Enter a number to start"));
}

function waitForMenuChoice() {
  return new Promise((resolve, reject) => {
    readline.emitKeypressEvents(process.stdin);
    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    process.stdin.resume();

    const onKeypress = (str, key) => {
      if (key.ctrl && key.name === "c") {
        cleanup();
        reject(new Error("SIGINT"));
        return;
      }
      if (/^[1-6]$/.test(str)) {
        cleanup();
        resolve(Number(str) - 1);
      }
    };

    const cleanup = () => {
      if (process.stdin.isTTY) process.stdin.setRawMode(false);
      process.stdin.removeListener("keypress", onKeypress);
    };

    process.stdin.on("keypress", onKeypress);
  });
}

function readAnswer({ puzzle, translation, points, levelName }) {
  return new Promise((resolve, reject) => {
    let typed = "";
    let hintChars = 0;
    let revealed = false;

    const playingFooter = "? hint · Enter show answer · Backspace edit · Ctrl+C quit";
    const skipFooter = "Enter — next question";

    const refresh = () => {
      drawGameScreen({
        puzzle,
        translation,
        typed,
        hintChars,
        points,
        levelName,
        reveal: revealed,
        footer: revealed ? skipFooter : playingFooter,
      });
    };

    readline.emitKeypressEvents(process.stdin);
    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    process.stdin.resume();

    const cleanup = () => {
      if (process.stdin.isTTY) process.stdin.setRawMode(false);
      process.stdin.removeListener("keypress", onKeypress);
    };

    const tryAutoCorrect = () => {
      const guess = combinedGuess(puzzle.answer, typed, hintChars);
      if (guess.length === puzzle.answer.length && wordsMatch(guess, puzzle.answer)) {
        cleanup();
        resolve({ correct: true });
      }
    };

    const onKeypress = (str, key) => {
      if (key.ctrl && key.name === "c") {
        cleanup();
        reject(new Error("SIGINT"));
        return;
      }

      if (key.name === "return") {
        if (revealed) {
          cleanup();
          resolve({ correct: false });
          return;
        }
        revealed = true;
        refresh();
        return;
      }

      if (revealed) return;

      if (key.name === "backspace") {
        if (typed.length > 0) {
          typed = typed.slice(0, -1);
        } else if (hintChars > 0) {
          hintChars -= 1;
        }
        refresh();
        return;
      }

      if (str === "?") {
        if (hintChars < puzzle.answer.length) {
          hintChars += 1;
          refresh();
          tryAutoCorrect();
        }
        return;
      }

      if (str && !key.ctrl && !key.meta && !key.name?.startsWith("f")) {
        const remaining = puzzle.answer.length - hintChars;
        if (typed.length < remaining) {
          typed += str;
          refresh();
          tryAutoCorrect();
        }
      }
    };

    refresh();
    process.stdin.on("keypress", onKeypress);
  });
}

async function runSession(sentencesPath, sourceLang, level) {
  const cache = new Map();
  let points = 0;
  const { lo, hi, name: levelName } = level;

  while (true) {
    const puzzle = buildPuzzle(sentencesPath, lo, hi, sourceLang);
    if (!puzzle) {
      clearScreen();
      console.log(chalk.red("No matching sentences found. Try another difficulty."));
      return;
    }

    let translation;
    try {
      translation = await translateSentence(puzzle.sentence, sourceLang, cache);
    } catch {
      translation = "(translation unavailable)";
    }

    try {
      const { correct } = await readAnswer({ puzzle, translation, points, levelName });
      if (correct) points += 1;
    } catch {
      break;
    }
  }

  clearScreen();
  drawHeader(points, levelName);
  console.log();
  console.log(chalk.white.bold("Session over"));
  console.log(chalk.green.bold(`Final score: ${points}`));
  console.log();
}

function resolveSentencesPath() {
  const argIdx = process.argv.indexOf("--sentences");
  if (argIdx !== -1) return process.argv[argIdx + 1];
  const esFile = path.join(__dirname, "sentences_es.txt");
  if (fs.existsSync(esFile)) return esFile;
  return DEFAULT_SENTENCES;
}

async function main() {
  const sentencesPath = resolveSentencesPath();

  if (!fs.existsSync(sentencesPath)) {
    console.error(`Sentences file not found: ${sentencesPath}`);
    process.exit(1);
  }

  const sourceLang = readLangFromFile(sentencesPath);
  loadZipfDict(sourceLang);
  drawMenuScreen();

  let levelIndex;
  try {
    levelIndex = await waitForMenuChoice();
  } catch {
    clearScreen();
    return;
  }

  await runSession(sentencesPath, sourceLang, DIFFICULTY_LEVELS[levelIndex]);
}

main().catch((err) => {
  if (err.message !== "SIGINT") console.error(err);
  process.exit(1);
});
