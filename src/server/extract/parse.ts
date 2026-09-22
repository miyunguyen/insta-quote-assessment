import { collapseWhitespace } from "./normalize";
import type { PageLine } from "./pdf";

export type MetaKey = "documentNumber" | "date" | "deliveredTo" | "orderedBy";

export type RawMeta = {
  key: MetaKey;
  value: string;
  sourceText: string;
  lineNumber: number;
};

export type ParsedRow = {
  cells: string[];
  lineNumber: number;
  lineText: string;
};

export type BadRow = {
  lineNumber: number;
  lineText: string;
  expectedCells: number;
  actualCells: number;
};

export type OtherLine = {
  lineNumber: number;
  text: string;
};

export type ParsedPage = {
  pageNumber: number;
  sectionTitle: string | null;
  header: string[] | null;
  headerLineNumber: number | null;
  rows: ParsedRow[];
  badRows: BadRow[];
  meta: RawMeta[];
  otherLines: OtherLine[];
};

const META_PATTERNS: Array<{ key: MetaKey; re: RegExp }> = [
  { key: "documentNumber", re: /^Document No:\s*(.+)$/i },
  { key: "date", re: /^Date:\s*(.+)$/i },
  { key: "deliveredTo", re: /^Delivered to:\s*(.+)$/i },
  { key: "orderedBy", re: /^Ordered by:\s*(.+)$/i },
];

function matchMeta(text: string): { key: MetaKey; value: string } | null {
  for (const { key, re } of META_PATTERNS) {
    const m = re.exec(text);
    if (m) return { key, value: m[1].trim() };
  }
  return null;
}

function isSeparator(text: string): boolean {
  return /^[\s-]{20,}$/.test(text) && text.includes("-");
}

function isTableHeader(tokens: string[]): boolean {
  return tokens[0] === "Item" && tokens[1] === "Description";
}

export function parsePageLines(
  pageNumber: number,
  lines: PageLine[],
): ParsedPage {
  const consumed = new Set<number>();
  const cellsOf = (line: PageLine): string[] => line.tokens.map((t) => t.str);
  const textOf = (line: PageLine): string => collapseWhitespace(line.text);

  // Meta lines (Document No / Date / Delivered to / Ordered by)
  const meta: RawMeta[] = [];
  let firstMetaIndex = -1;
  lines.forEach((line, i) => {
    const text = textOf(line);
    const m = matchMeta(text);
    if (m) {
      meta.push({
        key: m.key,
        value: m.value,
        sourceText: text,
        lineNumber: i,
      });
      consumed.add(i);
      if (firstMetaIndex === -1) firstMetaIndex = i;
    }
  });

  // Section title: the line just before the first meta line.
  // Without meta lines, only accept line 1 as a title if it cannot be a
  // table header, a separator, or a data row.
  let titleIndex = -1;
  if (firstMetaIndex >= 1) {
    titleIndex = firstMetaIndex - 1;
  } else if (lines.length > 1) {
    const candidate = lines[1];
    const candidateText = textOf(candidate);
    const looksStructural =
      isTableHeader(cellsOf(candidate)) ||
      isSeparator(candidateText) ||
      /^\d/.test(candidateText);
    if (!looksStructural) titleIndex = 1;
  }
  let sectionTitle: string | null = null;
  if (titleIndex >= 0) {
    sectionTitle = textOf(lines[titleIndex]);
    consumed.add(titleIndex);
  }
  // Company name: line above the title
  if (titleIndex - 1 >= 0) consumed.add(titleIndex - 1);

  // Table header + rows
  let header: string[] | null = null;
  let headerLineNumber: number | null = null;
  const rows: ParsedRow[] = [];
  const badRows: BadRow[] = [];

  lines.forEach((line, i) => {
    if (consumed.has(i)) return;
    const tokens = cellsOf(line);
    if (header === null && isTableHeader(tokens)) {
      header = tokens;
      headerLineNumber = i;
      consumed.add(i);
      return;
    }
    if (header !== null && isSeparator(textOf(line))) {
      consumed.add(i);
      return;
    }
    if (header !== null && /^\d+$/.test(tokens[0] ?? "")) {
      consumed.add(i);
      if (tokens.length === header.length) {
        rows.push({ cells: tokens, lineNumber: i, lineText: textOf(line) });
      } else {
        badRows.push({
          lineNumber: i,
          lineText: textOf(line),
          expectedCells: header.length,
          actualCells: tokens.length,
        });
      }
    }
  });

  // Everything else (notes, totals, page footers) is preserved for later rules
  const otherLines: OtherLine[] = [];
  lines.forEach((line, i) => {
    if (consumed.has(i)) return;
    otherLines.push({ lineNumber: i, text: textOf(line) });
  });

  return {
    pageNumber,
    sectionTitle,
    header,
    headerLineNumber,
    rows,
    badRows,
    meta,
    otherLines,
  };
}

export const COLUMN_FIELD_MAP: Record<string, string> = {
  description: "description",
  qty: "quantity",
  unit: "unit",
  weight: "weight",
  "unit price": "unitPrice",
  "line total": "lineTotal",
};

export function headerFieldNames(header: string[]): (string | null)[] {
  return header.map((column) => {
    const key = column.trim().toLowerCase();
    if (key === "item") return "item";
    return COLUMN_FIELD_MAP[key] ?? null;
  });
}
