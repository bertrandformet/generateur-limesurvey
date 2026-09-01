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

  afterFields.forEach((f) => {
    const idx = seq.findIndex((item) => item.kind === "question" && item.code === f.position.afterCode);
    const insertAt = idx === -1 ? seq.length : idx + 1;
    seq.splice(insertAt, 0, { kind: "field", ...f });
  });

  return [
    ...startFields.map((f) => ({ kind: "field", ...f })),
    ...seq,
    ...endFields.map((f) => ({ kind: "field", ...f })),
  ];
}
