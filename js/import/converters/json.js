export async function convertJson(file) {
  const text = await file.text();
  const parsed = JSON.parse(text);
  const pretty = JSON.stringify(parsed, null, 2);
  return `# ${file.name}\n\n\`\`\`json\n${pretty}\n\`\`\``;
}
