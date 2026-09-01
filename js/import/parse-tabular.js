// Delimited-text (CSV/TSV) parser with delimiter auto-detection, since
// French Excel commonly exports ";"-delimited "CSV" while most other tools
// use ",". No external dependency — this alone satisfies "tout format
// tableur" for the common case; XLSX/ODS support is a documented fast-follow
// (see README) rather than built here, to keep V1's dependency surface at
// zero.

const CANDIDATE_DELIMITERS = [",", ";", "\t"];

function splitLine(line, delimiter) {
  const fields = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === delimiter) {
      fields.push(current);
      current = "";
    } else {
      current += c;
    }
  }
  fields.push(current);
  return fields;
}

function detectDelimiter(firstLine) {
  let best = ",";
  let bestCount = 0;
  for (const d of CANDIDATE_DELIMITERS) {
    const count = splitLine(firstLine, d).length;
    if (count > bestCount) {
      bestCount = count;
      best = d;
    }
  }
  return best;
}

/**
 * @param {string} text raw file/paste content
 * @returns {{ headers: string[], rows: Record<string,string>[] }}
 */
export function parseDelimited(text) {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  const lines = normalized.split("\n").filter((l) => l.length > 0);
  if (lines.length === 0) return { headers: [], rows: [] };

  const delimiter = detectDelimiter(lines[0]);
  const headers = splitLine(lines[0], delimiter).map((h) => h.trim().toLowerCase());

  const rows = lines.slice(1).map((line) => {
    const fields = splitLine(line, delimiter);
    const row = {};
    headers.forEach((h, i) => {
      row[h] = (fields[i] ?? "").trim();
    });
    return row;
  });

  return { headers, rows };
}
