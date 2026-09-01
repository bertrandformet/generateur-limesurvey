import { convertText } from './text.js';
import { convertJson } from './json.js';
import { convertImage } from './image.js';

function getExt(file) {
  const name = file.name || '';
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' o';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1).replace('.', ',') + ' Ko';
  return (bytes / (1024 * 1024)).toFixed(1).replace('.', ',') + ' Mo';
}

const UNSUPPORTED = new Set(['ppt']);

const LAZY = {
  csv: () => import('./csv.js').then((m) => m.convertCsv),
  html: () => import('./html.js').then((m) => m.convertHtml),
  htm: () => import('./html.js').then((m) => m.convertHtml),
  xml: () => import('./xml.js').then((m) => m.convertXml),
  docx: () => import('./docx.js').then((m) => m.convertDocx),
  xlsx: () => import('./xlsx.js').then((m) => m.convertXlsx),
  xls: () => import('./xlsx.js').then((m) => m.convertXlsx),
  pdf: () => import('./pdf.js').then((m) => m.convertPdf),
  epub: () => import('./epub.js').then((m) => m.convertEpub),
  pptx: () => import('./pptx.js').then((m) => m.convertPptx),
};

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'tiff', 'tif', 'avif']);

export async function convert(file) {
  const ext = getExt(file);

  if (UNSUPPORTED.has(ext)) {
    throw new Error(`Format .${ext} non supporté. Enregistrez en .pptx ou convertissez en PDF.`);
  }

  if (ext === 'json') return { md: await convertJson(file), ext };

  if (IMAGE_EXTS.has(ext)) return { md: await convertImage(file), ext: ext };

  if (ext === 'md' || ext === 'markdown') return { md: await convertText(file), ext: 'md' };

  if (LAZY[ext]) {
    const fn = await LAZY[ext]();
    return { md: await fn(file), ext };
  }

  if (ext === 'txt' || ext === '' || file.type?.startsWith('text/')) {
    return { md: await convertText(file), ext: ext || 'txt' };
  }

  throw new Error(`Format .${ext} non reconnu`);
}

export { getExt, formatSize };
