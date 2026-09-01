let Papa;

async function loadPapa() {
  if (!Papa) {
    const mod = await import('https://esm.sh/papaparse@5.4.1');
    Papa = mod.default;
  }
  return Papa;
}

function toMdTable(rows) {
  if (!rows.length) return '';
  const headers = rows[0];
  const sep = headers.map(() => '---');
  const lines = [headers, sep, ...rows.slice(1)].map((r) => '| ' + r.join(' | ') + ' |');
  return lines.join('\n');
}

export async function convertCsv(file) {
  const pp = await loadPapa();
  const text = await file.text();
  const result = pp.parse(text.trim(), { skipEmptyLines: true });
  if (!result.data.length) return `# ${file.name}\n\n*Fichier CSV vide*`;
  return `# ${file.name}\n\n${toMdTable(result.data)}`;
}
