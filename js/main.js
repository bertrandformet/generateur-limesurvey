import { parseDelimited } from "./import/parse-tabular.js";
import { normalizeRows } from "./import/normalize.js";
import { convert as convertToMarkdown, getExt } from "./import/converters/index.js";
import { parseMarkdownQuestions, parseMarkdownAnswerKey, applyAnswerKey } from "./import/parse-markdown-quiz.js";
import { createAppState, makeFieldCode } from "./state.js";
import { buildFlatQuiz } from "./lss/quiz-flat.js";
import { buildSequence } from "./sequence.js";

const state = createAppState();
const SID = 100000 + Math.floor(Math.random() * 800000);

const el = (id) => document.getElementById(id);

const fileInput = el("file-input");
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

function currentFieldKind() {
  return Array.from(newFieldKindInputs).find((r) => r.checked)?.value || "field";
}

function updateAddFieldFormVisibility() {
  const isText = currentFieldKind() === "text";
  newFieldLabel.classList.toggle("hidden", isText);
  newFieldText.classList.toggle("hidden", !isText);
  newFieldMandatoryWrap.classList.toggle("hidden", isText);
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
    "Q2;M;Cochez les nombres pairs ;2;3;4;5;\"A,C\";2\n";
  downloadBlob("gabarit_questions.csv", sample, "text/csv;charset=utf-8");
});

templateMdBtn.addEventListener("click", () => {
  const sample =
    "## Question 1 — Capitale de la France\n\n" +
    "**Quelle est la capitale de la France ?**\n\n" +
    "- [ ] **A.** Lyon\n" +
    "- [ ] **B.** Paris\n" +
    "- [ ] **C.** Marseille\n";
  downloadBlob("gabarit_questions.md", sample, "text/markdown;charset=utf-8");
});

pasteToggleBtn.addEventListener("click", () => {
  pasteArea.classList.toggle("hidden");
  parseBtn.classList.toggle("hidden");
});

fileInput.addEventListener("change", async () => {
  const files = Array.from(fileInput.files || []);
  if (files.length === 0) return;
  await importFiles(files);
  fileInput.value = "";
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
    "- [ ] **C.** Marseille</pre>" +
    "<strong>Si vos questions et leur corrigé viennent de deux documents séparés</strong> (chacun affiché " +
    "dans son propre panneau ci-dessous), pas besoin de fusionner leurs textes : réécrivez chacun dans son " +
    "propre format, en validant chacun séparément — le rapprochement entre une question et sa bonne " +
    "réponse se fait ensuite automatiquement par numéro. Le corrigé se réécrit ainsi (le nom de l'option " +
    "suffit, pas besoin de répéter les 4 options) :" +
    "<pre class=\"example-block\">## Question 1 — Réponses A et C\n" +
    "- **A — Correct.** ...\n" +
    "- **B — Incorrect.** ...</pre>" +
    "Une fois validé, chaque texte reconstruit rejoint automatiquement la liste des questions à " +
    "l'étape suivante — inutile de cocher les bonnes réponses à la main si le corrigé est déjà validé.";
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

    actionRow.appendChild(retryBtn);
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

    const codeRow = document.createElement("div");
    codeRow.className = "q-code-row";

    const codeSpan = document.createElement("span");
    codeSpan.className = "q-code";
    codeSpan.textContent = q.type === "L" ? "choix unique" : "cases à cocher";

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

    codeRow.appendChild(codeSpan);
    codeRow.appendChild(weightLabel);

    const textInput = document.createElement("input");
    textInput.type = "text";
    textInput.className = "q-text-input";
    textInput.value = q.text;
    textInput.addEventListener("input", () => {
      q.text = textInput.value;
      renderPreview();
    });

    const optionsWrap = document.createElement("div");
    optionsWrap.className = "q-options";

    q.options.forEach((opt) => {
      const optRow = document.createElement("label");
      optRow.className = "q-option-row" + (q.correct.includes(opt.code) ? " is-correct" : "");

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

      const letter = document.createElement("span");
      letter.className = "q-option-letter";
      letter.textContent = opt.code;

      const optText = document.createElement("input");
      optText.type = "text";
      optText.value = opt.text;
      optText.addEventListener("input", () => {
        opt.text = optText.value;
        renderPreview();
      });

      optRow.appendChild(optToggle);
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

addFieldBtn.addEventListener("click", () => {
  const kind = currentFieldKind();
  const content = kind === "text" ? newFieldText.value.trim() : newFieldLabel.value.trim();
  if (!content) return;
  state.customFields.push({
    code: makeFieldCode(kind === "text" ? "texte" : content),
    kind,
    label: content,
    mandatory: kind === "field" && newFieldMandatory.checked,
    position: positionFromSelectValue(newFieldPosition.value),
  });
  newFieldLabel.value = "";
  newFieldText.value = "";
  newFieldMandatory.checked = false;
  renderFieldsList();
  renderPreview();
  renderSummary();
});

function renderFieldsList() {
  fieldsList.innerHTML = "";
  state.customFields.forEach((f, i) => {
    const row = document.createElement("div");
    row.className = "field-item";

    const label = document.createElement("span");
    label.className = "field-label";
    const kindPrefix = f.kind === "text" ? "[texte] " : "";
    const shortLabel = f.label.length > 60 ? f.label.slice(0, 60) + "…" : f.label;
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
    row.className = "preview-row" + (item.kind === "field" || item.kind === "text" ? " is-field" : "");

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
    } else {
      const tag = document.createElement("span");
      tag.className = "p-tag";
      const weight = item.weight && item.weight > 0 ? item.weight : 1;
      tag.textContent = `${item.type === "L" ? "choix unique" : "cases à cocher"} · ${weight} pt${weight > 1 ? "s" : ""}`;
      body.appendChild(tag);
      body.appendChild(document.createTextNode(item.text));

      const opts = document.createElement("div");
      opts.className = "p-options";
      opts.innerHTML = item.options
        .map((o) => (item.correct.includes(o.code) ? `<strong>${o.code}. ${escapeHtml(o.text)}</strong>` : `${o.code}. ${escapeHtml(o.text)}`))
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
  const totalPoints = selected.reduce((sum, q) => sum + (q.weight && q.weight > 0 ? q.weight : 1), 0);
  const totalLabel = Number.isInteger(totalPoints) ? totalPoints : totalPoints.toFixed(2).replace(/\.?0+$/, "");
  summaryBox.innerHTML = `<strong>${nQ}</strong> question(s) sélectionnée(s) (<strong>${totalLabel}</strong> point(s) au total), <strong>${nF}</strong> champ(s) additionnel(s).`;
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
});
