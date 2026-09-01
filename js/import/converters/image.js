export function convertImage(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      URL.revokeObjectURL(url);
      const sizeKo = (file.size / 1024).toFixed(1).replace('.', ',');
      const md = `# ${file.name}\n\n| Champ | Valeur |\n| --- | --- |\n| Dimensions | ${w} × ${h} |\n| Type | ${file.type || 'image'} |\n| Taille | ${sizeKo} Ko |`;
      resolve(md);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      const sizeKo = (file.size / 1024).toFixed(1).replace('.', ',');
      resolve(`# ${file.name}\n\n*Image (${file.type || 'type inconnu'}, ${sizeKo} Ko)*`);
    };
    img.src = url;
  });
}
