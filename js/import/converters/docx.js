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

// Word embarque volontiers un logo/en-tête dans les modèles de document ; mammoth
// le convertit par défaut en <img> avec les données de l'image encodées en base64
// directement dans le src. Une fois passé par turndown, ça donne un pâté de
// plusieurs milliers de caractères illisibles en tête du texte à relire, qui
// masque la vraie structure (titres, questions...) sans apporter d'information
// utile au parseur. On le remplace par un simple repère textuel.
function stripEmbeddedImages(md) {
  return md.replace(/!\[[^\]]*\]\(data:[^)]+\)/g, "[image]");
}

export async function convertDocx(file) {
  await loadLibs();
  const buf = await file.arrayBuffer();
  const result = await mammoth.convertToHtml({ arrayBuffer: buf });
  const td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
  const md = stripEmbeddedImages(td.turndown(result.value));
  return md || `# ${file.name}\n\n*Document vide*`;
}
