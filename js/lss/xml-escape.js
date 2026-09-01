// Single source of truth for how text lands in the LSS XML — see checklist
// rule 6: HTML embedded as an EM string literal must use single quotes for
// its own attributes, never backslash-escaped double quotes, since
// LimeSurvey's Expression Manager does not treat \" as an escaped quote.

export function cdata(text) {
  const s = text === null || text === undefined ? "" : String(text);
  // an actual "]]>" inside the content would terminate the CDATA section early
  return `<![CDATA[${s.replace(/]]>/g, "]]]]><![CDATA[>")}]]>`;
}

// Matches Python's html.escape(text, quote=False): escapes & < > only,
// leaves quotes alone. Used for plain attribute-like fields (grelevance,
// mandatory, etc.) — never for text meant to be read as HTML.
export function escapeAttr(text) {
  const s = text === null || text === undefined ? "" : String(text);
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
