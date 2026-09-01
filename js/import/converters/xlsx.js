let XLSX;

async function loadXlsx() {
  if (!XLSX) {
    const mod = await import('https://esm.sh/xlsx@0.18.5');
    XLSX = mod;
  }
  return XLSX;
}

function sheetToMdTable(sheet, xlsx) {
  const data = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  if (!data.length) return '*Feuille vide*';
  const headers = data[0].map(String);
  const sep = headers.map(() => '---');
  const rows = data.slice(1).map((r) => r.map(String));
  const lines = [headers, sep, ...rows].map((r) => '| ' + r.join(' | ') + ' |');
  return lines.join('\n');
}

export async function convertXlsx(file) {
  const xlsx = await loadXlsx();
  const buf = await file.arrayBuffer();
  const wb = xlsx.read(buf, { type: 'array' });
  const parts = wb.SheetNames.map((name) => {
    const table = sheetToMdTable(wb.Sheets[name], xlsx);
    return wb.SheetNames.length > 1 ? `## ${name}\n\n${table}` : table;
  });
  return `# ${file.name}\n\n${parts.join('\n\n')}`;
}
