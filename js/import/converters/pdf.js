let pdfjsLib;

async function loadPdfjs() {
  if (!pdfjsLib) {
    pdfjsLib = await import('https://esm.sh/pdfjs-dist@4.9.155/build/pdf.mjs');
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://esm.sh/pdfjs-dist@4.9.155/build/pdf.worker.mjs';
  }
  return pdfjsLib;
}

export async function convertPdf(file) {
  const pdfjs = await loadPdfjs();
  const buf = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: buf }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const text = content.items.map((item) => item.str).join(' ');
    if (text.trim()) {
      pages.push(doc.numPages > 1 ? `## Page ${i}\n\n${text.trim()}` : text.trim());
    }
  }
  if (!pages.length) return `# ${file.name}\n\n*Aucun texte extractible (document scanné ?)*`;
  return `# ${file.name}\n\n${pages.join('\n\n---\n\n')}`;
}
