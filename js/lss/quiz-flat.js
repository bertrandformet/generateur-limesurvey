// Orchestrates a V1 "flat" quiz (no levels/branching) from an ordered
// sequence of questions + custom fields into a full LSS document + lint
// report. Fields can be positioned anywhere in that sequence (start, end,
// or right after a given question) — see js/sequence.js, which builds the
// same ordering used here so the preview matches the generated file exactly.

import { createState, buildShortText, buildListRadio, buildMultipleChoice, buildEquation, buildBoilerplate } from "./builders.js";
import { assembleDocument } from "./assemble.js";
import { validateDocument } from "./validate.js";
import { buildSequence } from "../sequence.js";

const GID_QUESTIONS = 1;
const GID_RESULTAT = 2;

/**
 * @param {object} opts
 * @param {number} opts.sid
 * @param {string} opts.title
 * @param {{code:string,label:string,mandatory:boolean,position:object}[]} opts.customFields
 * @param {{code:string,type:"L"|"M",text:string,options:{code:string,text:string}[],correct:string[]}[]} opts.questions
 */
export function buildFlatQuiz({ sid, title, customFields, questions }) {
  const state = createState(sid);
  const sequence = buildSequence(questions, customFields);

  const groups = [
    {
      gid: GID_QUESTIONS,
      order: 1,
      grelevance: "1",
      name: "Questionnaire",
      description: "Chaque question à cases à cocher admet une ou plusieurs bonnes réponses : cochez toutes les affirmations exactes.",
    },
  ];

  const formulaParts = [];
  let order = 1;
  let totalPoints = 0;

  for (const item of sequence) {
    if (item.kind === "field") {
      buildShortText(state, {
        gid: GID_QUESTIONS,
        code: item.code,
        text: item.label,
        order: order++,
        mandatory: item.mandatory ? "Y" : "N",
      });
      continue;
    }

    const weight = item.weight && item.weight > 0 ? item.weight : 1;
    totalPoints += weight;

    let rawFormula;
    if (item.type === "L") {
      ({ formula: rawFormula } = buildListRadio(state, {
        gid: GID_QUESTIONS,
        code: item.code,
        text: item.text,
        options: item.options,
        correctCode: item.correct[0],
        order: order++,
      }));
    } else {
      ({ formula: rawFormula } = buildMultipleChoice(state, {
        gid: GID_QUESTIONS,
        code: item.code,
        text: item.text,
        options: item.options,
        correctCodes: item.correct,
        order: order++,
      }));
    }
    // rawFormula is if(...,1,0) — scale by this question's coefficient so the
    // score reflects weighted points rather than a plain correct-answer count.
    formulaParts.push(weight === 1 ? rawFormula : `(${rawFormula})*${weight}`);
  }

  const scoreFormula = formulaParts.length > 0 ? formulaParts.join(" + ") : "0";
  buildEquation(state, { gid: GID_QUESTIONS, code: "SCORE", formula: scoreFormula, order: order++, hidden: true });

  groups.push({ gid: GID_RESULTAT, order: 2, grelevance: "1", name: "Résultat", description: "" });
  const totalLabel = Number.isInteger(totalPoints) ? String(totalPoints) : totalPoints.toFixed(2).replace(/\.?0+$/, "");
  const feedbackHtml = `<p><strong>Votre résultat : {SCORE.NAOK} / ${totalLabel}</strong></p>`;
  buildBoilerplate(state, { gid: GID_RESULTAT, code: "FB", html: feedbackHtml, order: 1 });

  const meta = {
    title,
    welcomeHtml: "<p>Merci de répondre à ce questionnaire.</p>",
    endTextHtml: "<p>Merci d'avoir complété ce questionnaire.</p>",
    groups,
  };

  const xml = assembleDocument(state, meta);
  const errors = validateDocument(state, xml);

  return { xml, errors, state };
}
