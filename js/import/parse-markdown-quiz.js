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

/**
 * @returns {{ questions: {code:string,type:"M",text:string,options:{code:string,text:string}[],correct:string[]}[], warnings: string[] }}
 */
export function parseMarkdownQuestions(mdText, sourceLabel) {
  const lines = mdText.split(/\r?\n/);
  const questions = [];
  const warnings = [];
  let levelPrefix = null;
  let current = null;

  function flush() {
    if (!current) return;
    if (current.text && current.options.length >= 2) {
      const code = (levelPrefix || "Q") + current.num;
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
      const qm = headingText.match(QUESTION_NUM_RE);
      if (qm) {
        flush();
        current = { num: qm[1], text: "", options: [] };
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
    } else {
      unmatched.push(code);
    }
  }
  return unmatched;
}
