import { parseDelimited } from "./import/parse-tabular.js";
import { normalizeRows } from "./import/normalize.js";
import { convert as convertToMarkdown, getExt } from "./import/converters/index.js";
import { parseMarkdownQuestions, parseMarkdownAnswerKey, applyAnswerKey, parseImplicitChecklists } from "./import/parse-markdown-quiz.js";
import { createAppState, makeFieldCode } from "./state.js";
import { buildFlatQuiz } from "./lss/quiz-flat.js";
import { buildSequence } from "./sequence.js";

const state = createAppState();
const SID = 100000 + Math.floor(Math.random() * 800000);

const el = (id) => document.getElementById(id);

const fileInput = el("file-input");
const dropzone = el("dropzone");
const pasteBox = el("paste-box");
const pasteToggleBtn = el("btn-paste-toggle");
const pasteArea = el("paste-area");
const parseBtn = el("btn-parse");
const templateBtn = el("btn-template");
const templateMdBtn = el("btn-template-md");
const warningsBox = el("import-warnings");

const stepSelect = el("step-select");
const stepFields = el("step-fields");
const stepPreview = el("step-preview");
const stepGenerate = el("step-generate");

// --- Progress indicator ---------------------------------------------------
// A single dot sliding along a 1..5 line. Deliberately not scroll-driven:
// it only advances on an explicit milestone (import succeeded, or a
// step's own "Valider" button) so it reflects actual engagement with each
// step rather than incidental scrolling — a high-water mark that never
// moves back.

const PROGRESS_STEP_COUNT = 5;
const progressFill = el("progress-fill");
const progressDot = el("progress-dot");
const progressLabelEls = document.querySelectorAll("#progress-labels span");
let progressStep = 0;

function setProgress(step) {
  progressStep = Math.max(progressStep, step);
  const pct = (progressStep / (PROGRESS_STEP_COUNT - 1)) * 100;
  progressFill.style.width = `${pct}%`;
  progressDot.style.left = `${pct}%`;
  progressLabelEls.forEach((span, i) => span.classList.toggle("is-current", i === progressStep));
}

function wireValidateButton(btnId, statusId, step, message) {
  const btn = el(btnId);
  const status = el(statusId);
  btn.addEventListener("click", () => {
    setProgress(step);
    status.textContent = message;
  });
}

wireValidateButton("btn-validate-select", "validate-select-status", 2, "Sélection validée.");
wireValidateButton("btn-validate-fields", "validate-fields-status", 3, "Champs validés.");
wireValidateButton("btn-validate-preview", "validate-preview-status", 4, "Aperçu validé.");

const questionList = el("question-list");
const selectCount = el("select-count");
const selectAllBtn = el("btn-select-all");
const selectNoneBtn = el("btn-select-none");

const unrecognizedBox = el("unrecognized-box");

const fieldsList = el("fields-list");
const newFieldKindInputs = document.getElementsByName("new-field-kind");
const newFieldLabel = el("new-field-label");
const newFieldText = el("new-field-text");
const newFieldPosition = el("new-field-position");
const newFieldMandatory = el("new-field-mandatory");
const newFieldMandatoryWrap = el("new-field-mandatory-wrap");
const addFieldBtn = el("btn-add-field");
const newFieldImageBlock = el("new-field-image-block");
const newFieldImageFile = el("new-field-image-file");
const newFieldImageUrl = el("new-field-image-url");

function currentFieldKind() {
  return Array.from(newFieldKindInputs).find((r) => r.checked)?.value || "field";
}

function updateAddFieldFormVisibility() {
  const kind = currentFieldKind();
  newFieldLabel.classList.toggle("hidden", kind !== "field");
  newFieldText.classList.toggle("hidden", kind !== "text");
  newFieldImageBlock.classList.toggle("hidden", kind !== "image");
  newFieldMandatoryWrap.classList.toggle("hidden", kind !== "field");
}
newFieldKindInputs.forEach((r) => r.addEventListener("change", updateAddFieldFormVisibility));
updateAddFieldFormVisibility();

const previewList = el("preview-list");

const quizTitleInput = el("quiz-title");
const summaryBox = el("generate-summary");
const lintBox = el("lint-report");
const generateBtn = el("btn-generate");

// --- helpers ----------------------------------------------------------------

function downloadBlob(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function selectedQuestionsInOrder() {
  return state.importedQuestions.filter((q) => state.selectedCodes.has(q.code));
}

function renderAll() {
  renderQuestionList();
  renderFieldsList();
  renderFieldPositionOptions();
  renderPreview();
  renderSummary();
}

// --- Import -------------------------------------------------------------------

templateBtn.addEventListener("click", () => {
  const sample =
    "code;type;texte;option_a;option_b;option_c;option_d;correct;coefficient\n" +
    "Q1;L;Quelle est la capitale de la France ?;Lyon;Paris;Marseille;;B;1\n" +
    "Q2;M;Cochez les nombres pairs ;2;3;4;5;\"A,C\";2\n" +
    "Q3;T;Autres remarques (réponse libre, non notée);;;;;;\n";
  downloadBlob("gabarit_questions.csv", sample, "text/csv;charset=utf-8");
});

templateMdBtn.addEventListener("click", () => {
  const sample =
    "## Question 1 — Capitale de la France\n\n" +
    "**Quelle est la capitale de la France ?**\n\n" +
    "- [ ] **A.** Lyon\n" +
    "- [ ] **B.** Paris\n" +
    "- [ ] **C.** Marseille\n\n" +
    "## Question 1 — Réponse B\n\n" +
    "## Question 2 — Autres remarques\n\n" +
    "**Autres remarques ?**\n\n" +
    "[texte libre]\n";
  downloadBlob("gabarit_questions.md", sample, "text/markdown;charset=utf-8");
});

pasteToggleBtn.addEventListener("click", () => {
  pasteArea.classList.toggle("hidden");
  parseBtn.classList.toggle("hidden");
});

// Make the whole card clickable, not just the button inside it — but let
// a direct click on the button itself go through its own handler above
// rather than firing this too (which would immediately toggle back).
pasteBox.addEventListener("click", (e) => {
  if (e.target === pasteToggleBtn) return;
  pasteToggleBtn.click();
});

// Same for the dropzone: click anywhere to open the file picker, except
// on the file input itself (it already opens its own picker natively).
dropzone.addEventListener("click", (e) => {
  if (e.target === fileInput) return;
  fileInput.click();
});

fileInput.addEventListener("change", async () => {
  const files = Array.from(fileInput.files || []);
  if (files.length === 0) return;
  await importFiles(files);
  fileInput.value = "";
});

// Drag-and-drop onto the dropzone — dragCounter avoids the is-dragover
// class flickering as the dragenter/dragleave pair fires for every child
// element the pointer passes over on its way in/out.
let dropzoneDragCounter = 0;
dropzone.addEventListener("dragenter", (e) => {
  e.preventDefault();
  dropzoneDragCounter++;
  dropzone.classList.add("is-dragover");
});
dropzone.addEventListener("dragover", (e) => e.preventDefault());
dropzone.addEventListener("dragleave", () => {
  dropzoneDragCounter = Math.max(0, dropzoneDragCounter - 1);
  if (dropzoneDragCounter === 0) dropzone.classList.remove("is-dragover");
});
dropzone.addEventListener("drop", async (e) => {
  e.preventDefault();
  dropzoneDragCounter = 0;
  dropzone.classList.remove("is-dragover");
  const files = Array.from(e.dataTransfer?.files || []);
  if (files.length === 0) return;
  await importFiles(files);
});

parseBtn.addEventListener("click", async () => {
  const text = pasteArea.value;
  if (!text.trim()) return;
  await importSources([{ label: "texte collé", text, rawExt: "txt" }]);
  pasteArea.value = "";
});

// Reads each file, converting it to Markdown first when it isn't already
// plain delimited text or Markdown (PDF/DOCX/XLSX/... via the vendored
// mdfusion converters — see js/import/converters/), then hands everything
// to importSources() for pattern-matching.
async function importFiles(files) {
  const sources = [];
  for (const file of files) {
    const ext = getExt(file);
    try {
      if (["csv", "tsv", "txt"].includes(ext) || ext === "") {
        sources.push({ label: file.name, text: await file.text(), rawExt: ext || "txt" });
      } else if (ext === "md" || ext === "markdown") {
        sources.push({ label: file.name, text: await file.text(), rawExt: "md" });
      } else {
        const { md } = await convertToMarkdown(file);
        sources.push({ label: file.name, text: md, rawExt: ext, converted: true });
      }
    } catch (e) {
      state.importWarnings = state.importWarnings || [];
      state.importWarnings.push(`[${file.name}] Impossible de lire ce fichier : ${e.message}`);
    }
  }
  await importSources(sources);
}

// Tries one source's text, in order, as: (1) a CSV/TSV template, (2) a
// Markdown question bank (checkbox-style options), (3) a Markdown answer
// key ("corrigé") — a source can match more than one (e.g. a corrigé is
// only an answer key, a quiz file is only questions). Mutates
// state.importedQuestions directly (via appendQuestions) and pushes any
// answer key found into pendingAnswerKeys for the caller to apply once all
// sources of this batch are known. Returns whether anything matched at all.
function processOneSource(src, allWarnings, pendingAnswerKeys) {
  const label = src.label;
  let matched = false;

  if (["csv", "tsv", "txt"].includes(src.rawExt)) {
    const { rows } = parseDelimited(src.text);
    const { questions, warnings } = normalizeRows(rows);
    if (questions.length > 0) {
      matched = appendQuestions(questions, label, allWarnings) || matched;
      allWarnings.push(...warnings.map((w) => `[${label}] ${w}`));
    }
  }

  // Tried before the question parser: a "corrigé" document's headings
  // ("### Question 1 — Réponses B et D") also look like the start of a
  // question to parseMarkdownQuestions, which would otherwise report a
  // confusing "no options found" warning for a source that in fact parsed
  // fine as an answer key.
  const { answerKey, warnings: akWarnings } = parseMarkdownAnswerKey(src.text, label);
  if (Object.keys(answerKey).length > 0) {
    pendingAnswerKeys.push({ label, answerKey });
    matched = true;
  }

  const isAnswerKeySource = Object.keys(answerKey).length > 0;
  const { questions: mdQuestions, warnings: mdWarnings } = parseMarkdownQuestions(src.text, label);
  if (mdQuestions.length > 0) {
    matched = appendQuestions(mdQuestions, label, allWarnings) || matched;
  }
  if (!isAnswerKeySource) {
    allWarnings.push(...mdWarnings.map((w) => `[${label}] ${w}`));
  }
  allWarnings.push(...akWarnings.map((w) => `[${label}] ${w}`));

  // Self-assessment forms (Word "☐ option" lists, no "## Question N"
  // headings) — never overlaps with the two parsers above, see
  // parseImplicitChecklists' own comment for why.
  const { questions: implicitQuestions } = parseImplicitChecklists(src.text, label);
  if (implicitQuestions.length > 0) {
    matched = appendQuestions(implicitQuestions, label, allWarnings) || matched;
  }

  return matched;
}

function applyPendingAnswerKeys(pendingAnswerKeys, allWarnings) {
  // Applied after every source has been scanned, so it doesn't matter
  // whether the quiz or its corrigé was imported/dropped first.
  for (const { label, answerKey } of pendingAnswerKeys) {
    const unmatched = applyAnswerKey(state.importedQuestions, answerKey);
    if (unmatched.length > 0) {
      allWarnings.push(`[${label}] réponses pour ${unmatched.join(", ")} sans question importée correspondante.`);
    }
  }
}

async function importSources(sources) {
  const allWarnings = [...(state.importWarnings || [])];
  const pendingAnswerKeys = [];

  for (const src of sources) {
    const matched = processOneSource(src, allWarnings, pendingAnswerKeys);
    if (!matched) {
      state.unrecognized.push({ label: src.label, text: src.text });
    }
  }

  applyPendingAnswerKeys(pendingAnswerKeys, allWarnings);
  finishImport(allWarnings);
}

// Re-tries one already-shown "unrecognized" item using its (possibly
// hand-edited) textarea content, without requiring a manual copy/paste into
// the main paste area. Removes the item from the list on success.
function retryUnrecognized(item, ta) {
  const text = ta.value;
  const allWarnings = [...(state.importWarnings || [])];
  const pendingAnswerKeys = [];
  const src = { label: item.label, text, rawExt: "txt" };
  const matched = processOneSource(src, allWarnings, pendingAnswerKeys);
  applyPendingAnswerKeys(pendingAnswerKeys, allWarnings);

  if (matched) {
    const idx = state.unrecognized.indexOf(item);
    if (idx !== -1) state.unrecognized.splice(idx, 1);
    finishImport(allWarnings);
    return true;
  }

  item.text = text;
  return false;
}

function appendQuestions(questions, label, warningsOut) {
  const existingCodes = new Set(state.importedQuestions.map((q) => q.code));
  const added = [];
  for (const q of questions) {
    if (existingCodes.has(q.code)) {
      warningsOut.push(`[${label}] code "${q.code}" déjà importé depuis une autre source — ignoré.`);
      continue;
    }
    existingCodes.add(q.code);
    added.push(q);
  }
  state.importedQuestions.push(...added);
  added.forEach((q) => state.selectedCodes.add(q.code));
  return added.length > 0;
}

function finishImport(warnings) {
  state.importWarnings = warnings;
  renderWarnings();
  renderUnrecognized();
  renderAll();

  const has = state.importedQuestions.length > 0;
  stepSelect.style.display = has ? "grid" : "none";
  stepFields.style.display = has ? "grid" : "none";
  stepPreview.style.display = has ? "grid" : "none";
  stepGenerate.style.display = has ? "grid" : "none";
  if (has) setProgress(1);
}

function renderWarnings() {
  warningsBox.innerHTML = "";
  if (state.importWarnings.length === 0) return;
  state.importWarnings.forEach((w) => {
    const div = document.createElement("div");
    div.className = "warn-item";
    div.textContent = w;
    warningsBox.appendChild(div);
  });
}

function renderUnrecognized() {
  const list = state.unrecognized;
  unrecognizedBox.innerHTML = "";
  if (list.length === 0) {
    unrecognizedBox.classList.add("hidden");
    return;
  }
  unrecognizedBox.classList.remove("hidden");

  if (state.importedQuestions.length > 0) {
    const ok = document.createElement("div");
    ok.className = "unrecognized-partial-ok";
    ok.textContent =
      `${state.importedQuestions.length} question(s) déjà importée(s) avec succès depuis les autres ` +
      `documents — seuls ceux ci-dessous n'ont pas été reconnus :`;
    unrecognizedBox.appendChild(ok);
  }

  // Shown once for the whole panel, not repeated per file.
  const hint = document.createElement("div");
  hint.className = "hint unrecognized-shared-hint";
  hint.innerHTML =
    "Le texte a bien été extrait, mais aucune question/réponse n'y a été détectée — un PDF ou Word " +
    "n'a en général plus ni titres ni gras une fois le texte récupéré, tout est à plat. Exemple, tel " +
    "qu'il arrive souvent depuis un PDF :" +
    "<pre class=\"example-block\">Quelle est la capitale de la France ? A Lyon B Paris C Marseille</pre>" +
    "Il faut le réécrire ainsi :" +
    "<pre class=\"example-block\">## Question 1 — Capitale de la France\n" +
    "**Quelle est la capitale de la France ?**\n" +
    "- [ ] **A.** Lyon\n" +
    "- [ ] **B.** Paris\n" +
    "- [ ] **C.** Marseille\n\n" +
    "## Question 1 — Réponse B</pre>" +
    "Pour indiquer la bonne réponse, il suffit de répéter le même numéro de question dans un second " +
    "titre « Réponse(s) » — pas besoin de réexpliquer chaque option. " +
    "<strong>Si vos questions et leur corrigé viennent de deux documents séparés</strong>, pas besoin de " +
    "les fusionner : réécrivez chacun dans son propre format ci-dessous (un panneau par document) et " +
    "validez-les séparément — le rapprochement se fait ensuite automatiquement par numéro de question. " +
    "Une fois validé, chaque texte reconstruit rejoint automatiquement la liste des questions à " +
    "l'étape suivante — inutile de cocher les bonnes réponses à la main si le corrigé est déjà validé. " +
    "Vous pouvez aussi tout regrouper dans un seul des panneaux ci-dessous et ignorer les autres avec " +
    "le bouton « Ignorer ce document ».";
  unrecognizedBox.appendChild(hint);

  list.forEach((item) => {
    const box = document.createElement("div");
    box.className = "unrecognized-item";

    const title = document.createElement("div");
    title.className = "u-title";
    title.textContent = `${item.label} — structure non reconnue automatiquement`;

    const ta = document.createElement("textarea");
    ta.value = item.text;
    ta.readOnly = false;

    const actionRow = document.createElement("div");
    actionRow.className = "unrecognized-actions";

    const status = document.createElement("span");
    status.className = "unrecognized-status";

    const retryBtn = document.createElement("button");
    retryBtn.type = "button";
    retryBtn.className = "secondary-btn";
    retryBtn.textContent = "Valider ce texte";
    retryBtn.addEventListener("click", () => {
      const ok = retryUnrecognized(item, ta);
      if (!ok) {
        status.textContent = "Toujours pas reconnu — vérifiez le format ci-dessus.";
      }
    });

    const dismissBtn = document.createElement("button");
    dismissBtn.type = "button";
    dismissBtn.className = "link-btn";
    dismissBtn.textContent = "Ignorer ce document";
    dismissBtn.title = "Ne pas traiter ce texte (par exemple si vous l'avez déjà recopié dans un autre panneau)";
    dismissBtn.addEventListener("click", () => {
      const idx = state.unrecognized.indexOf(item);
      if (idx !== -1) state.unrecognized.splice(idx, 1);
      renderUnrecognized();
    });

    actionRow.appendChild(retryBtn);
    actionRow.appendChild(dismissBtn);
    actionRow.appendChild(status);

    box.appendChild(title);
    box.appendChild(ta);
    box.appendChild(actionRow);
    unrecognizedBox.appendChild(box);
  });
}

// --- Selection + inline editing ----------------------------------------------

let dragCode = null;

function reorderQuestion(draggedCode, targetCode, after) {
  const list = state.importedQuestions;
  const fromIdx = list.findIndex((q) => q.code === draggedCode);
  if (fromIdx === -1) return;
  const [moved] = list.splice(fromIdx, 1);
  let toIdx = list.findIndex((q) => q.code === targetCode);
  if (toIdx === -1) toIdx = list.length;
  else if (after) toIdx += 1;
  list.splice(toIdx, 0, moved);
}

// Question/option text can run long (real quiz content, not just labels) —
// a single-line <input> silently truncates it with no way to see the rest
// without focusing and scrolling character-by-character. A textarea that
// grows with its content shows everything at a glance instead.
function autosizeTextarea(ta) {
  ta.style.height = "auto";
  ta.style.height = `${ta.scrollHeight}px`;
}

function createAutosizeTextarea(className, value, onInput) {
  const ta = document.createElement("textarea");
  if (className) ta.className = className;
  ta.rows = 1;
  ta.value = value;
  ta.addEventListener("input", () => {
    onInput(ta.value);
    autosizeTextarea(ta);
  });
  requestAnimationFrame(() => autosizeTextarea(ta));
  return ta;
}

function renderQuestionList() {
  questionList.innerHTML = "";
  state.importedQuestions.forEach((q) => {
    const row = document.createElement("div");
    row.className = "question-item";
    row.dataset.code = q.code;

    const handle = document.createElement("span");
    handle.className = "q-drag-handle";
    handle.title = "Glisser pour réordonner";
    handle.textContent = "⠿";
    handle.draggable = true;

    handle.addEventListener("dragstart", (e) => {
      dragCode = q.code;
      row.classList.add("is-dragging");
      e.dataTransfer.effectAllowed = "move";
    });
    handle.addEventListener("dragend", () => {
      dragCode = null;
      row.classList.remove("is-dragging");
      questionList.querySelectorAll(".drop-before, .drop-after").forEach((el) => el.classList.remove("drop-before", "drop-after"));
    });
    row.addEventListener("dragover", (e) => {
      e.preventDefault();
      if (dragCode === null || dragCode === q.code) return;
      const rect = row.getBoundingClientRect();
      const after = e.clientY - rect.top > rect.height / 2;
      row.classList.toggle("drop-after", after);
      row.classList.toggle("drop-before", !after);
    });
    row.addEventListener("dragleave", () => {
      row.classList.remove("drop-before", "drop-after");
    });
    row.addEventListener("drop", (e) => {
      e.preventDefault();
      row.classList.remove("drop-before", "drop-after");
      if (dragCode === null || dragCode === q.code) return;
      const rect = row.getBoundingClientRect();
      const after = e.clientY - rect.top > rect.height / 2;
      reorderQuestion(dragCode, q.code, after);
      renderQuestionList();
      renderPreview();
    });

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = state.selectedCodes.has(q.code);
    cb.addEventListener("change", () => {
      if (cb.checked) state.selectedCodes.add(q.code);
      else state.selectedCodes.delete(q.code);
      renderFieldPositionOptions();
      renderPreview();
      renderSummary();
      updateSelectCount();
    });

    const body = document.createElement("div");
    body.className = "q-body";

    if (!(q.weight > 0)) q.weight = 1;
    const scored = q.type !== "T" && q.scored !== false;

    const codeRow = document.createElement("div");
    codeRow.className = "q-code-row";

    const codeSpan = document.createElement("span");
    codeSpan.className = "q-code";
    const kindLabel = q.type === "T" ? "réponse libre" : q.type === "L" ? "choix unique" : "cases à cocher";
    codeSpan.textContent = scored ? kindLabel : `${kindLabel} (non notée)`;

    codeRow.appendChild(codeSpan);

    if (scored) {
      const weightLabel = document.createElement("label");
      weightLabel.className = "q-weight-label";
      weightLabel.textContent = "Coefficient";
      const weightInput = document.createElement("input");
      weightInput.type = "number";
      weightInput.className = "q-weight-input";
      weightInput.min = "0.25";
      weightInput.step = "0.25";
      weightInput.value = q.weight;
      weightInput.addEventListener("input", () => {
        const v = Number(weightInput.value);
        q.weight = v > 0 ? v : 1;
        renderPreview();
        renderSummary();
      });
      weightLabel.appendChild(weightInput);
      codeRow.appendChild(weightLabel);
    }

    const textInput = createAutosizeTextarea("q-text-input", q.text, (value) => {
      q.text = value;
      renderPreview();
    });

    const optionsWrap = document.createElement("div");
    optionsWrap.className = "q-options";

    q.options.forEach((opt) => {
      const optRow = document.createElement("label");
      optRow.className = "q-option-row" + (q.correct.includes(opt.code) ? " is-correct" : "");

      if (scored) {
        const optToggle = document.createElement("input");
        optToggle.type = q.type === "L" ? "radio" : "checkbox";
        if (q.type === "L") optToggle.name = `correct-${q.code}`;
        optToggle.checked = q.correct.includes(opt.code);
        optToggle.addEventListener("change", () => {
          if (q.type === "L") {
            q.correct = [opt.code];
          } else if (optToggle.checked) {
            if (!q.correct.includes(opt.code)) q.correct.push(opt.code);
          } else {
            q.correct = q.correct.filter((c) => c !== opt.code);
          }
          renderQuestionList();
          renderPreview();
        });
        optRow.appendChild(optToggle);
      }

      const letter = document.createElement("span");
      letter.className = "q-option-letter";
      letter.textContent = opt.code;

      const optText = createAutosizeTextarea(null, opt.text, (value) => {
        opt.text = value;
        renderPreview();
      });

      optRow.appendChild(letter);
      optRow.appendChild(optText);
      optionsWrap.appendChild(optRow);
    });

    body.appendChild(codeRow);
    body.appendChild(textInput);
    body.appendChild(optionsWrap);

    row.appendChild(handle);
    row.appendChild(cb);
    row.appendChild(body);
    questionList.appendChild(row);
  });
  updateSelectCount();
}

function updateSelectCount() {
  selectCount.textContent = `${state.selectedCodes.size} / ${state.importedQuestions.length} sélectionnée(s)`;
}

selectAllBtn.addEventListener("click", () => {
  state.selectedCodes = new Set(state.importedQuestions.map((q) => q.code));
  renderQuestionList();
  renderFieldPositionOptions();
  renderPreview();
  renderSummary();
});
selectNoneBtn.addEventListener("click", () => {
  state.selectedCodes = new Set();
  renderQuestionList();
  renderFieldPositionOptions();
  renderPreview();
  renderSummary();
});

// --- Custom fields + position -------------------------------------------------

function renderFieldPositionOptions() {
  const current = newFieldPosition.value;
  newFieldPosition.innerHTML = "";

  const optStart = document.createElement("option");
  optStart.value = "start";
  optStart.textContent = "Au début du questionnaire";
  newFieldPosition.appendChild(optStart);

  selectedQuestionsInOrder().forEach((q) => {
    const opt = document.createElement("option");
    opt.value = `after:${q.code}`;
    opt.textContent = `Après ${q.code}`;
    newFieldPosition.appendChild(opt);
  });

  const optEnd = document.createElement("option");
  optEnd.value = "end";
  optEnd.textContent = "À la fin du questionnaire";
  newFieldPosition.appendChild(optEnd);

  if (current && Array.from(newFieldPosition.options).some((o) => o.value === current)) {
    newFieldPosition.value = current;
  }
}

function positionFromSelectValue(value) {
  if (value === "start") return { mode: "start" };
  if (value === "end") return { mode: "end" };
  const [, code] = value.split(":");
  return { mode: "after", afterCode: code };
}

function positionLabel(position) {
  if (position.mode === "start") return "Début";
  if (position.mode === "end") return "Fin";
  return `Après ${position.afterCode}`;
}

function pushField(field) {
  state.customFields.push({
    mandatory: false,
    ...field,
    position: positionFromSelectValue(newFieldPosition.value),
  });
  newFieldLabel.value = "";
  newFieldText.value = "";
  newFieldImageUrl.value = "";
  newFieldImageFile.value = "";
  newFieldMandatory.checked = false;
  renderFieldsList();
  renderPreview();
  renderSummary();
}

addFieldBtn.addEventListener("click", () => {
  const kind = currentFieldKind();

  if (kind === "image") {
    const file = newFieldImageFile.files[0];
    const url = newFieldImageUrl.value.trim();
    if (file) {
      const reader = new FileReader();
      reader.onload = () => {
        pushField({
          code: makeFieldCode("image"),
          kind: "image",
          label: `<img src="${reader.result}" alt="" style="max-width:100%;height:auto;">`,
          displayName: file.name,
        });
      };
      reader.readAsDataURL(file);
    } else if (url) {
      pushField({
        code: makeFieldCode("image"),
        kind: "image",
        label: `<img src="${escapeHtml(url)}" alt="" style="max-width:100%;height:auto;">`,
        displayName: url,
      });
    }
    return;
  }

  const content = kind === "text" ? newFieldText.value.trim() : newFieldLabel.value.trim();
  if (!content) return;
  pushField({
    code: makeFieldCode(kind === "text" ? "texte" : content),
    kind,
    label: content,
    mandatory: kind === "field" && newFieldMandatory.checked,
  });
});

function renderFieldsList() {
  fieldsList.innerHTML = "";
  state.customFields.forEach((f, i) => {
    const row = document.createElement("div");
    row.className = "field-item";

    const label = document.createElement("span");
    label.className = "field-label";
    const kindPrefix = f.kind === "text" ? "[texte] " : f.kind === "image" ? "[image] " : "";
    const displayText = f.kind === "image" ? f.displayName || "image" : f.label;
    const shortLabel = displayText.length > 60 ? displayText.slice(0, 60) + "…" : displayText;
    label.textContent = kindPrefix + shortLabel + (f.mandatory ? " *" : "");

    const posTag = document.createElement("span");
    posTag.className = "field-position";
    posTag.textContent = positionLabel(f.position);

    const tag = document.createElement("span");
    tag.className = "field-tag";
    tag.textContent = f.code;

    const removeBtn = document.createElement("button");
    removeBtn.className = "remove-field";
    removeBtn.textContent = "Retirer";
    removeBtn.addEventListener("click", () => {
      state.customFields.splice(i, 1);
      renderFieldsList();
      renderPreview();
      renderSummary();
    });

    row.appendChild(label);
    row.appendChild(posTag);
    row.appendChild(tag);
    row.appendChild(removeBtn);
    fieldsList.appendChild(row);
  });
}

// --- Preview -------------------------------------------------------------------

function renderPreview() {
  previewList.innerHTML = "";
  const sequence = buildSequence(selectedQuestionsInOrder(), state.customFields);

  if (sequence.length === 0) {
    const empty = document.createElement("div");
    empty.className = "preview-row";
    empty.textContent = "Rien à afficher — sélectionnez des questions ou ajoutez un champ.";
    previewList.appendChild(empty);
    return;
  }

  sequence.forEach((item, i) => {
    const row = document.createElement("div");
    row.className = "preview-row" + (item.kind === "field" || item.kind === "text" || item.kind === "image" ? " is-field" : "");

    const index = document.createElement("div");
    index.className = "p-index";
    index.textContent = String(i + 1);

    const body = document.createElement("div");
    body.className = "p-body";

    if (item.kind === "field") {
      const tag = document.createElement("span");
      tag.className = "p-tag";
      tag.textContent = "champ";
      body.appendChild(tag);
      body.appendChild(document.createTextNode(item.label + (item.mandatory ? " (obligatoire)" : " (optionnel)")));
    } else if (item.kind === "text") {
      const tag = document.createElement("span");
      tag.className = "p-tag";
      tag.textContent = "texte";
      body.appendChild(tag);
      body.appendChild(document.createTextNode(item.label));
    } else if (item.kind === "image") {
      const tag = document.createElement("span");
      tag.className = "p-tag";
      tag.textContent = "image";
      body.appendChild(tag);
      body.appendChild(document.createTextNode(item.displayName || ""));
      const thumb = document.createElement("div");
      thumb.className = "p-image-thumb";
      thumb.innerHTML = item.label;
      body.appendChild(thumb);
    } else if (item.type === "T") {
      const tag = document.createElement("span");
      tag.className = "p-tag";
      tag.textContent = "réponse libre (non notée)";
      body.appendChild(tag);
      body.appendChild(document.createTextNode(item.text));
    } else {
      const scored = item.scored !== false;
      const tag = document.createElement("span");
      tag.className = "p-tag";
      const kindLabel = item.type === "L" ? "choix unique" : "cases à cocher";
      const weight = item.weight && item.weight > 0 ? item.weight : 1;
      tag.textContent = scored ? `${kindLabel} · ${weight} pt${weight > 1 ? "s" : ""}` : `${kindLabel} (non notée)`;
      body.appendChild(tag);
      body.appendChild(document.createTextNode(item.text));

      const opts = document.createElement("div");
      opts.className = "p-options";
      opts.innerHTML = item.options
        .map((o) => (scored && item.correct.includes(o.code) ? `<strong>${o.code}. ${escapeHtml(o.text)}</strong>` : `${o.code}. ${escapeHtml(o.text)}`))
        .join(" &nbsp;·&nbsp; ");
      body.appendChild(opts);
    }

    row.appendChild(index);
    row.appendChild(body);
    previewList.appendChild(row);
  });
}

function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// --- Generate -----------------------------------------------------------------

function renderSummary() {
  const selected = selectedQuestionsInOrder();
  const nQ = selected.length;
  const nF = state.customFields.length;
  const isScored = (q) => q.type !== "T" && q.scored !== false;
  const nOpen = selected.filter((q) => !isScored(q)).length;
  const totalPoints = selected.reduce((sum, q) => sum + (isScored(q) ? (q.weight && q.weight > 0 ? q.weight : 1) : 0), 0);
  const totalLabel = Number.isInteger(totalPoints) ? totalPoints : totalPoints.toFixed(2).replace(/\.?0+$/, "");
  const openLabel = nOpen > 0 ? `, dont <strong>${nOpen}</strong> non notée(s)` : "";
  summaryBox.innerHTML = `<strong>${nQ}</strong> question(s) sélectionnée(s) (<strong>${totalLabel}</strong> point(s) au total${openLabel}), <strong>${nF}</strong> champ(s) additionnel(s).`;
  lintBox.innerHTML = "";
}

generateBtn.addEventListener("click", () => {
  const selectedQuestions = selectedQuestionsInOrder();
  if (selectedQuestions.length === 0) {
    lintBox.innerHTML = `<div class="lint-err">Sélectionnez au moins une question.</div>`;
    return;
  }

  const title = quizTitleInput.value.trim() || "Questionnaire";
  const { xml, errors } = buildFlatQuiz({
    sid: SID,
    title,
    customFields: state.customFields,
    questions: selectedQuestions,
  });

  lintBox.innerHTML = "";
  if (errors.length > 0) {
    errors.forEach((e) => {
      const div = document.createElement("div");
      div.className = "lint-err";
      div.textContent = e;
      lintBox.appendChild(div);
    });
    return;
  }

  const ok = document.createElement("div");
  ok.className = "lint-ok";
  ok.textContent = "Vérification automatique : aucune erreur détectée.";
  lintBox.appendChild(ok);

  const filename = title.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "questionnaire";
  downloadBlob(`${filename}.lss`, xml, "application/xml;charset=utf-8");
  setProgress(4);
});

setProgress(0);
