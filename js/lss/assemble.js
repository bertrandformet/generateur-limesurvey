// Assembles the row arrays built by builders.js into the final <document>
// XML string LimeSurvey expects on import.

import { cdata, escapeAttr } from "./xml-escape.js";

const CDATA_FIELDS = new Set(["question", "help", "answer", "group_name", "description"]);

function rowsXml(tableName, rows, fieldOrder) {
  const out = [`<${tableName}>`, "<rows>"];
  for (const r of rows) {
    out.push("<row>");
    for (const f of fieldOrder) {
      const v = r[f] === undefined || r[f] === null ? "" : r[f];
      if (CDATA_FIELDS.has(f)) {
        out.push(`<${f}>${cdata(v)}</${f}>`);
      } else {
        out.push(`<${f}>${escapeAttr(v)}</${f}>`);
      }
    }
    out.push("</row>");
  }
  out.push("</rows>", `</${tableName}>`);
  return out.join("\n");
}

const QUESTION_FIELDS = [
  "qid", "parent_qid", "sid", "gid", "type", "title", "mandatory",
  "other", "question_order", "scale_id", "same_default", "relevance",
  "question_theme_name",
];

/**
 * @param {object} state - from builders.createState(), populated by the builder calls.
 * @param {object} meta - { title, welcomeHtml, endTextHtml, groups: [{gid, order, grelevance, name, description}] }
 */
export function assembleDocument(state, meta) {
  const questionsXml = rowsXml("questions", state.rowsQuestions, QUESTION_FIELDS);
  const subquestionsXml = rowsXml("subquestions", state.rowsSubquestions, QUESTION_FIELDS);
  const questionL10nsXml = rowsXml("question_l10ns", state.rowsQuestionL10ns, ["qid", "question", "help", "language"]);
  const answersXml = rowsXml("answers", state.rowsAnswers, ["aid", "qid", "code", "sortorder", "assessment_value", "scale_id"]);
  const answerL10nsXml = rowsXml("answer_l10ns", state.rowsAnswerL10ns, ["aid", "answer", "language"]);
  const attrXml = rowsXml("question_attributes", state.rowsQuestionAttributes, ["qaid", "qid", "attribute", "value", "language"]);

  const groupsXml = [
    "<groups>", "<rows>",
    ...meta.groups.map(
      (g) =>
        `<row><gid>${g.gid}</gid><sid>${state.sid}</sid><group_order>${g.order}</group_order>` +
        `<grelevance>${escapeAttr(g.grelevance)}</grelevance></row>`
    ),
    "</rows>", "</groups>",
  ].join("\n");

  const groupL10nsXml = [
    "<group_l10ns>", "<rows>",
    ...meta.groups.map(
      (g) =>
        `<row><gid>${g.gid}</gid><group_name>${cdata(g.name)}</group_name>` +
        `<description>${cdata(g.description || "")}</description><language>fr</language></row>`
    ),
    "</rows>", "</group_l10ns>",
  ].join("\n");

  const surveysXml = `<surveys>
<rows>
<row>
<sid>${state.sid}</sid>
<admin>Admin</admin>
<active>N</active>
<format>G</format>
<template>fruity</template>
<language>fr</language>
<assessments>Y</assessments>
<showwelcome>Y</showwelcome>
<showprogress>Y</showprogress>
<allowprev>Y</allowprev>
</row>
</rows>
</surveys>`;

  const langSettingsXml = `<surveys_languagesettings>
<rows>
<row>
<surveyls_survey_id>${state.sid}</surveyls_survey_id>
<surveyls_language>fr</surveyls_language>
<surveyls_title>${cdata(meta.title)}</surveyls_title>
<surveyls_welcometext>${cdata(meta.welcomeHtml || "")}</surveyls_welcometext>
<surveyls_endtext>${cdata(meta.endTextHtml || "")}</surveyls_endtext>
<surveyls_dateformat>1</surveyls_dateformat>
</row>
</rows>
</surveys_languagesettings>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<document>
<LimeSurveyDocType>Survey</LimeSurveyDocType>
<DBVersion>445</DBVersion>
<languages>
<language>fr</language>
</languages>
${surveysXml}
${langSettingsXml}
${groupsXml}
${groupL10nsXml}
${questionsXml}
${subquestionsXml}
${questionL10nsXml}
${attrXml}
${answersXml}
${answerL10nsXml}
</document>
`;
}
