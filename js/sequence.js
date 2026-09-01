// Builds one ordered list mixing selected questions and custom fields,
// honoring each field's chosen position — shared between the live preview
// (ui) and the actual generator (lss/quiz-flat.js) so what you see is
// exactly what gets built.
//
// field.position: { mode: "start" | "end" | "after", afterCode?: string }

export function buildSequence(questions, fields) {
  const seq = questions.map((q) => ({ kind: "question", ...q }));

  const startFields = fields.filter((f) => f.position.mode === "start");
  const endFields = fields.filter((f) => f.position.mode === "end");
  const afterFields = fields.filter((f) => f.position.mode === "after");

  // Two fields both positioned "after Q1" must keep their creation order.
  // Re-finding Q1's index on every iteration and always inserting right
  // after it would instead reverse them (the second field lands between
  // Q1 and the first) — afterOffsets tracks how many fields already
  // landed after a given code so each new one goes after those, not
  // between them and the question.
  const afterOffsets = new Map();
  afterFields.forEach((f) => {
    const afterCode = f.position.afterCode;
    const idx = seq.findIndex((item) => item.kind === "question" && item.code === afterCode);
    const offset = afterOffsets.get(afterCode) || 0;
    const insertAt = idx === -1 ? seq.length : idx + 1 + offset;
    seq.splice(insertAt, 0, { kind: "field", ...f });
    afterOffsets.set(afterCode, offset + 1);
  });

  return [
    ...startFields.map((f) => ({ kind: "field", ...f })),
    ...seq,
    ...endFields.map((f) => ({ kind: "field", ...f })),
  ];
}
