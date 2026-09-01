let mammoth, TurndownService;

async function loadLibs() {
  if (!mammoth) {
    const [m, t] = await Promise.all([
      import('https://esm.sh/mammoth@1.8.0'),
      import('https://esm.sh/turndown@7.2.0'),
    ]);
    mammoth = m.default || m;
    TurndownService = t.default;
  }
}

export async function convertDocx(file) {
  await loadLibs();
  const buf = await file.arrayBuffer();
  const result = await mammoth.convertToHtml({ arrayBuffer: buf });
  const td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
  const md = td.turndown(result.value);
  return md || `# ${file.name}\n\n*Document vide*`;
}
