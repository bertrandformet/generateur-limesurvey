let XMLParser;

async function loadParser() {
  if (!XMLParser) {
    const mod = await import('https://esm.sh/fast-xml-parser@4.5.0');
    XMLParser = mod.XMLParser;
  }
  return XMLParser;
}

export async function convertXml(file) {
  await loadParser();
  const text = await file.text();
  const parser = new XMLParser({ ignoreAttributes: false, preserveOrder: false });
  const parsed = parser.parse(text);
  const pretty = JSON.stringify(parsed, null, 2);
  return `# ${file.name}\n\n\`\`\`xml\n${text.length > 5000 ? text.slice(0, 5000) + '\n...(tronqué)' : text}\n\`\`\`\n\n## Structure parsée\n\n\`\`\`json\n${pretty}\n\`\`\``;
}
