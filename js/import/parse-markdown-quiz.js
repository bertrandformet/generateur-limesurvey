// Recognizes question/answer-key structure in Markdown text (including text
// converted from PDF/DOCX/XLSX via converters/index.js). This is a
// pattern-matcher, not a general document understanding system — it knows
// the conventions actually seen in this project's source documents:
//
//   ## Question 3 — Titre
//   **Prompt de la question ?**
//   - [ ] **A.** Texte option A
//   - [ ] **B.** Texte option B
//
// ...and, in a separate "corrigé" document:
//
//   ### Question 3 — Réponses A, C et D
//   - **A — Correct.** ...
//
// or inline: "Réponses correctes : B et D"
//
// A document converted from PDF has no bold/heading markup left (pdf.js only
// extracts positioned text runs) — this parser will legitimately find zero
// questions in that case. Callers should treat an empty result as "surface
// the raw text for manual review", not as an error.

const LEVEL_PREFIX_MAP = [
  [/d[ée]couverte/i, "D"],
  [/praticien/i, "P"],
  [/[ée]claireur/i, "E"],
];

function detectLevelPrefix(headingText) {
  for (const [re, prefix] of LEVEL_PREFIX_MAP) {
    if (re.test(headingText)) return prefix;
  }
  return null;
}

const HEADING_RE = /^#{1,6}\s+(.*)$/;
const QUESTION_NUM_RE = /Question\s+(\d+)/i;
const OPTION_RE = /^[-*]\s*\[[ xX]?\]\s*\*\*([A-Za-z])[.)]?\*\*\.?\s*(.+)$/;
// Marks a question as an open, unscored answer field (e.g. "autres attentes,
// à préciser" on a self-assessment form) instead of a checkbox question —
// see js/lss/builders.js buildShortText, already used for custom fields.
const OPEN_TEXT_RE = /^\[(texte|r[ée]ponse)\s+libre\]$/i;

/**
 * @returns {{ questions: {code:string,type:"M"|"T",text:string,options:{code:string,text:string}[],correct:string[]}[], warnings: string[] }}
 */
export function parseMarkdownQuestions(mdText, sourceLabel) {
  const lines = mdText.split(/\r?\n/);
  const questions = [];
  const warnings = [];
  let levelPrefix = null;
  let current = null;

  function flush() {
    if (!current) return;
    const code = (levelPrefix || "Q") + current.num;
    if (current.text && current.openText) {
      questions.push({ code, type: "T", text: current.text, options: [], correct: [], weight: 1 });
    } else if (current.text && current.options.length >= 2) {
      questions.push({ code, type: "M", text: current.text, options: current.options, correct: [], weight: 1 });
    } else {
      warnings.push(`${sourceLabel} : question ${current.num} — structure non reconnue, ignorée.`);
    }
    current = null;
  }

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    const h = line.match(HEADING_RE);
    if (h) {
      const headingText = h[1].replace(/[—-]\s*$/, "").trim();
      if (ANSWER_HEADING_RE.test(headingText)) {
        // A corrigé heading ("Question 1 — Réponse B"), not a new
        // question — flush whatever question was being built (it's
        // complete) but don't start tracking this as one, and don't warn
        // about it below: parseMarkdownAnswerKey is what reads these.
        flush();
        continue;
      }
      const qm = headingText.match(QUESTION_NUM_RE);
      if (qm) {
        flush();
        current = { num: qm[1], text: "", options: [], openText: false };
      } else {
        const prefix = detectLevelPrefix(headingText);
        if (prefix) {
          flush();
          levelPrefix = prefix;
        }
      }
      continue;
    }

    if (!current) continue;

    if (OPEN_TEXT_RE.test(line)) {
      current.openText = true;
      continue;
    }

    const opt = line.match(OPTION_RE);
    if (opt) {
      current.options.push({ code: opt[1].toUpperCase(), text: opt[2].trim() });
      continue;
    }

    if (!current.text && !line.startsWith(">")) {
      current.text = line.replace(/^\*\*|\*\*$/g, "").trim();
    }
  }
  flush();

  return { questions, warnings };
}

// Self-assessment / positioning forms (Word "☐ option" lists) don't use
// "## Question N" headings at all — a bold prompt line is directly followed
// by a run of ☐-prefixed option lines, with no letters and no marked
// correct answer:
//
//   **Concernant le 1er objectif, indiquez votre niveau de maîtrise :**
//   ☐ Maîtrise insuffisante
//   ☐ Maîtrise fragile
//
// These have no "right" answer (it's a self-assessment, not a quiz), so
// every question found here comes back with scored:false — see
// js/lss/quiz-flat.js, which skips these when building the score formula.
// Runs on the same text as parseMarkdownQuestions and never overlaps with
// it: "- [ ] **A.**" bracket options (the scored format) don't match
// IMPLICIT_OPTION_RE, and a heading line ("#...") never starts with "**".
// Matches a line that STARTS with a bold run rather than requiring the
// whole line to be bold, since Word sometimes leaves an annotation like
// "(Plusieurs réponses possibles)" trailing outside the bold markers.
const BOLD_PROMPT_RE = /^\*\*.+/;
const IMPLICIT_OPTION_RE = /^[☐☑☒□]\s*(.+)$/;
const MULTI_SELECT_HINT_RE = /plusieurs\s+(r[ée]ponses|choix)/i;

function sourceCodePrefix(sourceLabel) {
  const base = sourceLabel
    .replace(/\.[a-z0-9]+$/i, "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "")
    .toUpperCase()
    .slice(0, 8);
  return base || "LK";
}

/**
 * @returns {{ questions: {code:string,type:"M"|"L",text:string,options:{code:string,text:string}[],correct:string[],weight:1,scored:false}[] }}
 */
export function parseImplicitChecklists(mdText, sourceLabel) {
  const lines = mdText.split(/\r?\n/);
  const prefix = sourceCodePrefix(sourceLabel);
  const questions = [];
  let counter = 0;
  let pendingPrompt = null;
  let optionsBuffer = [];

  function flush() {
    if (optionsBuffer.length < 2 || !pendingPrompt) {
      optionsBuffer = [];
      return;
    }
    counter += 1;
    questions.push({
      code: `${prefix}_LK${counter}`,
      type: MULTI_SELECT_HINT_RE.test(pendingPrompt) ? "M" : "L",
      text: pendingPrompt,
      options: optionsBuffer,
      correct: [],
      weight: 1,
      scored: false,
    });
    optionsBuffer = [];
  }

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    const opt = line.match(IMPLICIT_OPTION_RE);
    if (opt) {
      const code = String.fromCharCode(65 + optionsBuffer.length);
      optionsBuffer.push({ code, text: opt[1].trim() });
      continue;
    }

    if (BOLD_PROMPT_RE.test(line)) {
      flush();
      pendingPrompt = line.replace(/\*\*/g, "").trim();
      continue;
    }

    // Any other line ends the current option run without starting a new
    // prompt (e.g. a heading, or plain body text between two blocks).
    flush();
  }
  flush();

  return { questions };
}

// The remainder after "Réponses" must be ONLY a letter list (A et D / A, C et D)
// with nothing else, anchored to the end of the heading — otherwise a plain
// question title that happens to contain the word "réponse(s)" (e.g.
// "Fiabilité des réponses", "Évaluer une réponse complexe") gets mistaken
// for a corrigé heading.
const ANSWER_HEADING_RE = /Question\s+(\d+).*?R[ée]ponses?\s*(?:correctes?)?\s*:?\s*([A-F](?:\s*(?:,|et)\s*[A-F])*)\s*$/i;
const ANSWER_INLINE_RE = /R[ée]ponses?\s+correctes?\s*:?\s*(.+)$/i;

function extractLetters(text) {
  // "A, C et D" / "B et D" / "A, B, C" -> ["A","C","D"]
  return Array.from(new Set((text.match(/\b[A-F]\b/g) || []).map((l) => l.toUpperCase())));
}

/**
 * @returns {{ answerKey: Record<string,string[]>, warnings: string[] }}
 *   answerKey maps a question code (e.g. "D3") to its correct option letters.
 */
export function parseMarkdownAnswerKey(mdText, sourceLabel) {
  const lines = mdText.split(/\r?\n/);
  const answerKey = {};
  const warnings = [];
  let levelPrefix = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    const h = line.match(HEADING_RE);
    if (h) {
      const headingText = h[1].trim();
      const am = headingText.match(ANSWER_HEADING_RE);
      if (am) {
        const letters = extractLetters(am[2]);
        if (letters.length > 0) {
          const code = (levelPrefix || "Q") + am[1];
          answerKey[code] = letters;
        } else {
          warnings.push(`${sourceLabel} : question ${am[1]} — aucune bonne réponse détectée dans l'en-tête.`);
        }
        continue;
      }
      const qm = headingText.match(QUESTION_NUM_RE);
      const prefix = detectLevelPrefix(headingText);
      if (prefix) {
        levelPrefix = prefix;
        continue;
      }
      if (qm) {
        // "## Question N" heading without inline answer — look at following lines instead of here.
        var pendingNum = qm[1];
        continue;
      }
      continue;
    }

    const inline = line.match(ANSWER_INLINE_RE);
    if (inline && typeof pendingNum !== "undefined") {
      const letters = extractLetters(inline[1]);
      if (letters.length > 0) {
        const code = (levelPrefix || "Q") + pendingNum;
        answerKey[code] = letters;
      }
      pendingNum = undefined;
    }
  }

  return { answerKey, warnings };
}

// Applies a parsed answer key onto a list of questions (mutates `correct`
// in place), matching by code. Returns codes that had no matching answer.
export function applyAnswerKey(questions, answerKey) {
  const unmatched = [];
  for (const code of Object.keys(answerKey)) {
    const q = questions.find((qq) => qq.code === code);
    if (q) {
      const validCodes = new Set(q.options.map((o) => o.code));
      q.correct = answerKey[code].filter((c) => validCodes.has(c));
      // parseMarkdownQuestions always guesses "M" (checkbox) at parse time,
      // before the corrigé is known — now that we know exactly how many
      // answers are correct, use a radio button (L) for the common
      // single-answer case instead of showing checkboxes that invite
      // picking more than one.
      if (q.type !== "T") q.type = q.correct.length === 1 ? "L" : "M";
    } else {
      unmatched.push(code);
    }
  }
  return unmatched;
}
