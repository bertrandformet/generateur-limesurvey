// In-memory app state. A fresh object per session/tab — nothing persisted,
// nothing shared across users (this is a client-side-only tool).

export function createAppState() {
  return {
    importedQuestions: [], // canonical shape from normalize.js
    importWarnings: [],
    unrecognized: [], // [{ label, text }] — sources that matched no known format
    selectedCodes: new Set(),
    customFields: [], // { code, label, mandatory }
  };
}

let fieldCodeCounter = 1;

export function makeFieldCode(label) {
  const base =
    label
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "") // strip accents
      .replace(/[^a-zA-Z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .toUpperCase()
      .slice(0, 16) || "CHAMP";
  return `${base}_${fieldCodeCounter++}`;
}
