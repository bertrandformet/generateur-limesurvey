let JSZip;

async function loadJSZip() {
  if (!JSZip) {
    const mod = await import('https://esm.sh/jszip@3.10.1');
    JSZip = mod.default;
  }
  return JSZip;
}

function extractTexts(node) {
  const texts = [];
  if (!node || typeof node !== 'object') return texts;
  if (node['a:t']) {
    const t = node['a:t'];
    texts.push(typeof t === 'string' ? t : (t['#text'] || ''));
  }
  for (const key of Object.keys(node)) {
    const child = node[key];
    if (Array.isArray(child)) {
      child.forEach((item) => texts.push(...extractTexts(item)));
    } else if (typeof child === 'object' && child !== null) {
      texts.push(...extractTexts(child));
    }
  }
  return texts;
}

function parseXml(xmlStr) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlStr, 'application/xml');
  return doc;
}

function getSlideTexts(xmlStr) {
  const doc = parseXml(xmlStr);
  const blocks = [];

  const spTree = doc.getElementsByTagName('p:spTree')[0];
  if (!spTree) return blocks;

  const shapes = spTree.getElementsByTagName('p:sp');
  for (const sp of shapes) {
    const txBody = sp.getElementsByTagName('p:txBody')[0];
    if (!txBody) continue;

    const paragraphs = txBody.getElementsByTagName('a:p');
    for (const p of paragraphs) {
      const runs = p.getElementsByTagName('a:t');
      let line = '';
      for (const r of runs) {
        line += r.textContent || '';
      }
      if (line.trim()) blocks.push(line.trim());
    }
  }

  return blocks;
}

export async function convertPptx(file) {
  const Zip = await loadJSZip();
  const buf = await file.arrayBuffer();
  const zip = await Zip.loadAsync(buf);

  const slideFiles = Object.keys(zip.files)
    .filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f))
    .sort((a, b) => {
      const na = parseInt(a.match(/slide(\d+)/)[1]);
      const nb = parseInt(b.match(/slide(\d+)/)[1]);
      return na - nb;
    });

  if (slideFiles.length === 0) {
    return `# ${file.name}\n\n*Aucune slide trouvée dans le fichier.*`;
  }

  const parts = [];
  parts.push(`> **Note :** seul le contenu textuel a été extrait. Les images, formes et mises en page ne sont pas conservées.\n`);

  for (let i = 0; i < slideFiles.length; i++) {
    const xmlStr = await zip.files[slideFiles[i]].async('text');
    const texts = getSlideTexts(xmlStr);

    parts.push(`## Slide ${i + 1}`);
    if (texts.length > 0) {
      parts.push(texts.join('\n\n'));
    } else {
      parts.push('*Slide sans texte*');
    }
  }

  return parts.join('\n\n');
}
