// Converts parsed tabular rows into the canonical question shape used
// throughout the app:
//   { code, type: "L"|"M"|"T", text, options: [{code,text}], correct: [codes], weight }
//
// Expected columns (header row, case-insensitive, any of , ; \t as
// delimiter — see parse-tabular.js): code, type, texte, option_a..option_f,
// correct, and an optional coefficient/poids column (defaults to 1).
// "correct" holds one or more option letters separated by ; , or
// whitespace (comma is also accepted here even though it's a common column
// delimiter, since parse-tabular.js has already split columns by then).
//
// Type "T" is an open answer field (no options, not scored) — for things
// like "autres attentes, à préciser" on a self-assessment form. It only
// needs code/texte; option_* / correct / coefficient columns are ignored.

const OPTION_COLUMNS = ["option_a", "option_b", "option_c", "option_d", "option_e", "option_f"];
const OPTION_LETTERS = ["A", "B", "C", "D", "E", "F"];

export function normalizeRows(rows) {
  const questions = [];
  const warnings = [];
  const seenCodes = new Set();

  rows.forEach((row, idx) => {
    const rowNum = idx + 2; // +1 for header, +1 for 1-indexing
    const code = (row.code || "").trim();
    const type = (row.type || "").trim().toUpperCase();
    const text = (row.texte || row.text || row.question || "").trim();

    if (!code || !text) {
      warnings.push(`Ligne ${rowNum} : ignorée (code ou texte manquant).`);
      return;
    }
    if (seenCodes.has(code)) {
      warnings.push(`Ligne ${rowNum} : code "${code}" déjà utilisé — ignorée.`);
      return;
    }
    if (type !== "L" && type !== "M" && type !== "T") {
      warnings.push(`Ligne ${rowNum} ("${code}") : type "${type}" non reconnu (attendu L, M ou T) — ignorée.`);
      return;
    }

    if (type === "T") {
      seenCodes.add(code);
      questions.push({ code, type, text, options: [], correct: [], weight: 1 });
      return;
    }

    const options = [];
    OPTION_COLUMNS.forEach((col, i) => {
      const val = (row[col] || "").trim();
      if (val) options.push({ code: OPTION_LETTERS[i], text: val });
    });
    if (options.length < 2) {
      warnings.push(`Ligne ${rowNum} ("${code}") : moins de 2 options renseignées — ignorée.`);
      return;
    }

    const correctRaw = (row.correct || row.bonnes_reponses || row.reponse || "").trim();
    const correct = correctRaw
      .split(/[;,\s]+/)
      .map((c) => c.trim().toUpperCase())
      .filter(Boolean);
    const validOptionCodes = new Set(options.map((o) => o.code));
    const invalidCorrect = correct.filter((c) => !validOptionCodes.has(c));
    if (correct.length === 0 || invalidCorrect.length > 0) {
      warnings.push(`Ligne ${rowNum} ("${code}") : colonne "correct" invalide (${correctRaw || "vide"}) — ignorée.`);
      return;
    }
    if (type === "L" && correct.length !== 1) {
      warnings.push(`Ligne ${rowNum} ("${code}") : type L doit avoir exactement une bonne réponse — ignorée.`);
      return;
    }

    const weightRaw = (row.coefficient || row.poids || row.weight || "").trim();
    let weight = weightRaw ? Number(weightRaw.replace(",", ".")) : 1;
    if (!Number.isFinite(weight) || weight <= 0) {
      if (weightRaw) warnings.push(`Ligne ${rowNum} ("${code}") : coefficient "${weightRaw}" invalide — 1 utilisé par défaut.`);
      weight = 1;
    }

    seenCodes.add(code);
    questions.push({ code, type, text, options, correct, weight });
  });

  return { questions, warnings };
}
