let TurndownService;

async function loadTurndown() {
  if (!TurndownService) {
    const mod = await import('https://esm.sh/turndown@7.2.0');
    TurndownService = mod.default;
  }
  return TurndownService;
}

export async function convertHtml(file) {
  const Td = await loadTurndown();
  const text = await file.text();
  const td = new Td({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
  const md = td.turndown(text);
  return md || `# ${file.name}\n\n*Contenu HTML vide*`;
}
