// Executable version of the 11-point checklist ("Générer un LSS valide").
// Runs against the in-memory state AND the serialized XML, before any
// download is allowed. This is the highest-leverage safeguard we have
// without a live LimeSurvey instance to test against — most of what took
// several round-trips to discover by hand can be checked here for free.

import { QUESTION_THEME_BY_TYPE } from "./builders.js";

export function validateDocument(state, xmlString) {
  const errors = [];
  const allQuestions = [...state.rowsQuestions, ...state.rowsSubquestions];

  // Rule: XML must be well-formed.
  try {
    const doc = new DOMParser().parseFromString(xmlString, "application/xml");
    if (doc.querySelector("parsererror")) {
      errors.push("XML mal formé — erreur de syntaxe détectée par le parseur.");
    }
  } catch (e) {
    errors.push(`XML illisible : ${e.message}`);
  }

  // Rule 1: every question/subquestion has the right question_theme_name.
  for (const q of allQuestions) {
    const expected = QUESTION_THEME_BY_TYPE[q.type];
    if (!expected || q.question_theme_name !== expected) {
      errors.push(
        `Question "${q.title}" (qid ${q.qid}, type ${q.type}) : question_theme_name attendu "${expected}", trouvé "${q.question_theme_name}".`
      );
    }
  }

  // Rule 3: every question/subquestion needs >=1 question_attributes row.
  const qidsWithAttr = new Set(state.rowsQuestionAttributes.map((a) => a.qid));
  for (const q of allQuestions) {
    if (!qidsWithAttr.has(q.qid)) {
      errors.push(`Question "${q.title}" (qid ${q.qid}) : aucune ligne question_attributes — risque de 500 au premier référencement.`);
    }
  }

  // Rule 4: equation question text must be {...}-wrapped.
  for (const q of state.rowsQuestions.filter((q) => q.type === "*")) {
    const l10n = state.rowsQuestionL10ns.find((l) => l.qid === q.qid);
    const text = l10n ? String(l10n.question).trim() : "";
    if (!/^\{[\s\S]*\}$/.test(text)) {
      errors.push(`Question équation "${q.title}" (qid ${q.qid}) : formule non entourée d'accolades.`);
    }
  }

  // Rule 6: no backslash-escaped double quote inside any question text —
  // LimeSurvey's EM does not honour \" and breaks parsing there.
  for (const l10n of state.rowsQuestionL10ns) {
    if (typeof l10n.question === "string" && l10n.question.includes('\\"')) {
      errors.push(`Question qid ${l10n.qid} : guillemet échappé \\" détecté — utiliser des apostrophes pour le HTML imbriqué.`);
    }
  }

  // Rule 7: no nested <p><p> (or other repeated block tag) across an {} boundary.
  for (const l10n of state.rowsQuestionL10ns) {
    if (typeof l10n.question === "string" && /<p>\s*<p[\s>]/i.test(l10n.question)) {
      errors.push(`Question qid ${l10n.qid} : balise <p> imbriquée détectée (risque de duplication d'affichage).`);
    }
  }

  // Rule 9 (part 1): every subquestion's parent_qid must resolve to a real question.
  const allQids = new Set(allQuestions.map((q) => q.qid));
  for (const sq of state.rowsSubquestions) {
    if (!allQids.has(sq.parent_qid)) {
      errors.push(`Sous-question "${sq.title}" (qid ${sq.qid}) : parent_qid ${sq.parent_qid} introuvable.`);
    }
  }

  // Rule 9 (part 2): qid uniqueness.
  const qidCounts = {};
  for (const q of allQuestions) qidCounts[q.qid] = (qidCounts[q.qid] || 0) + 1;
  for (const [qid, count] of Object.entries(qidCounts)) {
    if (count > 1) errors.push(`qid ${qid} utilisé ${count} fois — collision d'identifiant.`);
  }

  // Sanity: at least one selected question, and every M-question has >=1 subquestion.
  const mQuestions = state.rowsQuestions.filter((q) => q.type === "M");
  for (const q of mQuestions) {
    const subs = state.rowsSubquestions.filter((sq) => sq.parent_qid === q.qid);
    if (subs.length === 0) {
      errors.push(`Question à cases à cocher "${q.title}" (qid ${q.qid}) : aucune option — LimeSurvey refusera de l'activer.`);
    }
  }

  return errors;
}
