import { readFile } from "node:fs/promises";
import path from "node:path";
import { getDocumentProxy } from "unpdf";

const dir = path.resolve(process.cwd(), "sample-files-variant-A");
const file = process.argv[2] ?? "KBS-10234.pdf";
const pdf = await getDocumentProxy(
  new Uint8Array(await readFile(path.join(dir, file))),
);

const TOLERANCE = 2.5;

for (let n = 1; n <= pdf.numPages; n++) {
  const page = await pdf.getPage(n);
  const content = await page.getTextContent();
  const tokens = [];
  for (const item of content.items) {
    if (typeof item !== "object" || item === null) continue;
    if (typeof item.str !== "string" || item.str.trim() === "") continue;
    const t = item.transform;
    if (!Array.isArray(t) || t.length < 6) continue;
    tokens.push({ str: item.str, x: t[4], y: t[5] });
  }
  const sorted = [...tokens].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines = [];
  for (const tok of sorted) {
    const cur = lines[lines.length - 1];
    if (cur && Math.abs(cur.y - tok.y) <= TOLERANCE) cur.tokens.push(tok);
    else lines.push({ y: tok.y, tokens: [tok] });
  }
  console.log(`\n===== ${file} page ${n} (${lines.length} lines) =====`);
  lines.forEach((line, i) => {
    line.tokens.sort((a, b) => a.x - b.x);
    const text = line.tokens.map((t) => t.str).join(" | ");
    console.log(`${String(i).padStart(2)} y=${line.y.toFixed(1)}  ${text}`);
  });
}
