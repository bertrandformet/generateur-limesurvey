// Builders for the four question types this generator supports (V1, no
// levels/branching): L (single choice), M (checkbox), S (short free text —
// used for custom identity fields like nom/prénom), * (equation, hidden
// score computation), X (boilerplate, visible result text).
//
// Every builder here exists to encode one or more of the 11 checklist rules
// found the hard way in the reference project (see gen_lss.py / the
// "Générer un LSS valide" checklist). Read the comments before changing
// anything — most of them are not obvious from the LimeSurvey docs.

import { IdGen } from "./ids.js";

const QUESTION_THEME_BY_TYPE = {
  L: "listradio",
  M: "multiplechoice",
  S: "shortfreetext", // UNVERIFIED empirically this session — see README "État des lieux"
  "*": "equation",
  X: "boilerplate",
};

export function createState(sid) {
  return {
    sid,
    qidGen: new IdGen(1),
    aidGen: new IdGen(1),
    qattrGen: new IdGen(1),
    rowsQuestions: [],
    rowsSubquestions: [],
    rowsQuestionL10ns: [],
    rowsAnswers: [],
    rowsAnswerL10ns: [],
    rowsQuestionAttributes: [],
    qcodeToQid: {},
  };
}

// Rule 3: every question AND subquestion needs >=1 question_attributes row,
// even a no-op one, or LimeSurvey's internal per-qid attribute cache can be
// null instead of an empty array — the first formula referencing that
// question then crashes with a PHP array_key_exists() 500 error.
function addDefaultAttribute(state, qid) {
  const qaid = state.qattrGen.next();
  state.rowsQuestionAttributes.push({
    qaid,
    qid,
    attribute: "hidden",
    value: "0",
    language: "",
  });
}

function baseQuestionRow({ qid, sid, gid, type, code, mandatory, order }) {
  return {
    qid,
    parent_qid: 0,
    sid,
    gid,
    type,
    title: code,
    mandatory,
    other: "N",
    question_order: order,
    scale_id: 0,
    same_default: 0,
    relevance: "1",
    question_theme_name: QUESTION_THEME_BY_TYPE[type],
  };
}

// Type L — single choice. options: [{code, text}, ...]. Returns a
// tout-ou-rien EM formula fragment for this question, consistent with the M
// builder below, so a flat quiz can sum L and M scores through the exact
// same proven mechanism rather than mixing in LimeSurvey's native
// assessment_value aggregation (which would need `.NAOK`-safe access to a
// running total we haven't verified is reachable from a hand-written
// formula — not worth the unverified risk for a first release).
export function buildListRadio(state, { gid, code, text, options, correctCode, order, mandatory = "N" }) {
  const qid = state.qidGen.next();
  state.qcodeToQid[code] = qid;
  state.rowsQuestions.push(baseQuestionRow({ qid, sid: state.sid, gid, type: "L", code, mandatory, order }));
  state.rowsQuestionL10ns.push({ qid, question: text, help: "", language: "fr" });
  addDefaultAttribute(state, qid);

  options.forEach((opt, i) => {
    const aid = state.aidGen.next();
    state.rowsAnswers.push({
      aid,
      qid,
      code: opt.code,
      sortorder: i + 1,
      assessment_value: 0,
      scale_id: 0,
    });
    state.rowsAnswerL10ns.push({ aid, answer: opt.text, language: "fr" });
  });

  const formula = `if(${code}.NAOK=="${correctCode}",1,0)`;
  return { qid, formula };
}

// Type M — checkboxes. Rule 2/4 (structural): options are SUBQUESTIONS,
// living in their own top-level <subquestions> block (handled in
// assemble.js) — not in `answers`, and not merged into <questions>.
// Response variable per option is `{code}_{optionCode}` (rule 10), used
// below to build the "exactly the correct set is checked" formula.
export function buildMultipleChoice(state, { gid, code, text, options, correctCodes, order }) {
  const qid = state.qidGen.next();
  state.qcodeToQid[code] = qid;
  state.rowsQuestions.push(baseQuestionRow({ qid, sid: state.sid, gid, type: "M", code, mandatory: "N", order }));
  state.rowsQuestionL10ns.push({ qid, question: text, help: "", language: "fr" });
  addDefaultAttribute(state, qid);

  const correctSet = new Set(correctCodes);
  const parts = [];
  options.forEach((opt, i) => {
    const subQid = state.qidGen.next();
    state.rowsSubquestions.push(
      baseQuestionRow({ qid: subQid, sid: state.sid, gid, type: "M", code: opt.code, mandatory: "N", order: i + 1 })
    );
    state.rowsSubquestions[state.rowsSubquestions.length - 1].parent_qid = qid;
    state.rowsQuestionL10ns.push({ qid: subQid, question: opt.text, help: "", language: "fr" });
    addDefaultAttribute(state, subQid);

    // Rule 5: cross-reference with .NAOK — safe even though V1 has no
    // branching, since an unanswered optional checkbox is the same hazard
    // in miniature.
    const varName = `${code}_${opt.code}.NAOK`;
    parts.push(correctSet.has(opt.code) ? `${varName}=="Y"` : `${varName}!="Y"`);
  });

  const formula = `if(${parts.join(" && ")},1,0)`;
  return { qid, formula };
}

// Type S — short free text, for custom identity fields (nom, prénom...).
// UNVERIFIED this session: question_theme_name "shortfreetext" is the
// expected LimeSurvey 6.x convention but has not been confirmed against a
// live import. Flag any issue here first if a generated survey blanks on
// a page containing a custom field.
export function buildShortText(state, { gid, code, text, order, mandatory = "N" }) {
  const qid = state.qidGen.next();
  state.qcodeToQid[code] = qid;
  state.rowsQuestions.push(baseQuestionRow({ qid, sid: state.sid, gid, type: "S", code, mandatory, order }));
  state.rowsQuestionL10ns.push({ qid, question: text, help: "", language: "fr" });
  addDefaultAttribute(state, qid);
  return qid;
}

// Type * — equation. Rule 4: the formula MUST be wrapped in {...} — the
// "question" field is still a plain text field; without braces the raw
// formula text becomes the stored "value", and numeric comparisons on it
// silently coerce to 0.
export function buildEquation(state, { gid, code, formula, order, hidden = true }) {
  const qid = state.qidGen.next();
  state.qcodeToQid[code] = qid;
  state.rowsQuestions.push(baseQuestionRow({ qid, sid: state.sid, gid, type: "*", code, mandatory: "N", order }));
  state.rowsQuestionL10ns.push({ qid, question: `{${formula}}`, help: "", language: "fr" });
  if (hidden) {
    const qaid = state.qattrGen.next();
    state.rowsQuestionAttributes.push({ qaid, qid, attribute: "hidden", value: "1", language: "" });
  } else {
    addDefaultAttribute(state, qid);
  }
  return qid;
}

// Type X — boilerplate / free text display. htmlText may itself contain
// {} EM expressions. Rule 7: don't let an outer wrapper tag and an inner
// branch's own tag both be <p> — checked by validate.js, not enforced here,
// since callers control the exact markup.
export function buildBoilerplate(state, { gid, code, html, order }) {
  const qid = state.qidGen.next();
  state.qcodeToQid[code] = qid;
  state.rowsQuestions.push(baseQuestionRow({ qid, sid: state.sid, gid, type: "X", code, mandatory: "N", order }));
  state.rowsQuestionL10ns.push({ qid, question: html, help: "", language: "fr" });
  addDefaultAttribute(state, qid);
  return qid;
}

export { QUESTION_THEME_BY_TYPE };
