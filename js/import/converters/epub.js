let JSZip, TurndownService;

async function loadLibs() {
  if (!JSZip) {
    const [z, t] = await Promise.all([
      import('https://esm.sh/jszip@3.10.1'),
      import('https://esm.sh/turndown@7.2.0'),
    ]);
    JSZip = z.default;
    TurndownService = t.default;
  }
}

export async function convertEpub(file) {
  await loadLibs();
  const buf = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(buf);

  const containerXml = await zip.file('META-INF/container.xml')?.async('text');
  if (!containerXml) throw new Error('EPUB invalide : pas de container.xml');

  const rootMatch = containerXml.match(/full-path="([^"]+)"/);
  if (!rootMatch) throw new Error('EPUB invalide : rootfile introuvable');

  const opfText = await zip.file(rootMatch[1])?.async('text');
  if (!opfText) throw new Error('EPUB invalide : OPF introuvable');

  const opfDir = rootMatch[1].includes('/') ? rootMatch[1].replace(/\/[^/]+$/, '/') : '';

  const itemMatches = [...opfText.matchAll(/<item[^>]+id="([^"]+)"[^>]+href="([^"]+)"[^>]+media-type="([^"]+)"[^>]*\/?>/g)];
  const xhtmlItems = itemMatches.filter((m) => m[3].includes('html')).map((m) => ({ id: m[1], href: m[2] }));

  const spineMatches = [...opfText.matchAll(/<itemref[^>]+idref="([^"]+)"[^>]*\/?>/g)];
  const spineIds = spineMatches.map((m) => m[1]);

  const ordered = spineIds.map((id) => xhtmlItems.find((it) => it.id === id)).filter(Boolean);
  if (!ordered.length) {
    return `# ${file.name}\n\n*Aucun contenu XHTML trouvé dans l'EPUB*`;
  }

  const td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
  const parts = [];

  for (const item of ordered) {
    const path = opfDir + item.href;
    const html = await zip.file(path)?.async('text');
    if (!html) continue;
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    const content = bodyMatch ? bodyMatch[1] : html;
    const md = td.turndown(content).trim();
    if (md) parts.push(md);
  }

  if (!parts.length) return `# ${file.name}\n\n*Contenu EPUB vide*`;
  return parts.join('\n\n---\n\n');
}
