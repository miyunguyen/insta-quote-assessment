import { collapseWhitespace } from "@/lib/text";
import { splitPipeCells, type PipeCell } from "./rects";
import type { PageLine } from "./pdf";

export type MetaKey = "documentNumber" | "date" | "deliveredTo" | "orderedBy";

export type RawMeta = {
  key: MetaKey;
  value: string;
  sourceText: string;
  lineNumber: number;
  valueStart: number;
  valueLength: number;
};

export type ParsedRow = {
  cells: string[];
  // Token indices per cell, parallel to cells. Pipe tables: a cell spans
  // several tokens and boundary tokens are shared; token tables: identity
  // spans ([[0], [1], ...]).
  cellTokens: number[][];
  lineNumber: number;
  lineText: string;
};

export type BadRow = {
  lineNumber: number;
  lineText: string;
  expectedCells: number;
  actualCells: number;
  detail?: string;
};

export type OtherLine = {
  lineNumber: number;
  text: string;
};

export type TableProblemKind = "no_header";

// A table the parser could see but not use: a divider with no usable header
// line above it. Cells are plain text, so there is nothing else to distrust
// — rows that don't fit the table's own width are per-row badRows instead.
export type TableProblem = {
  kind: TableProblemKind;
  separatorLineNumber: number;
  separatorText: string;
  headerLineNumber: number | null;
  headerText: string | null;
  expectedCells: number;
  mismatchedRows: number;
};

export type ParsedPage = {
  pageNumber: number;
  sectionTitle: string | null;
  titleLineNumber: number | null;
  headerLineNumber: number | null;
  // The document's own heading texts (display labels only — never read for
  // meaning). Present only when every extracted row has exactly this many
  // cells; otherwise rows still extract and the viewer shows generic
  // columns plus tableHeaderText quoted as context.
  tableLabels: string[] | null;
  tableHeaderText: string | null;
  rows: ParsedRow[];
  badRows: BadRow[];
  tableProblem: TableProblem | null;
  meta: RawMeta[];
  otherLines: OtherLine[];
};

const META_PATTERNS: Array<{ key: MetaKey; re: RegExp }> = [
  { key: "documentNumber", re: /^Document No:\s*(.+)$/i },
  { key: "date", re: /^Date:\s*(.+)$/i },
  { key: "deliveredTo", re: /^Delivered to:\s*(.+)$/i },
  { key: "orderedBy", re: /^Ordered by:\s*(.+)$/i },
];

function matchMeta(text: string): {
  key: MetaKey;
  value: string;
  valueStart: number;
  valueLength: number;
} | null {
  for (const { key, re } of META_PATTERNS) {
    const m = re.exec(text);
    if (!m) continue;
    // Every pattern ends with (.+)$, so the raw capture always runs to the
    // end of the match — its start needs no ambiguous indexOf search.
    const raw = m[1];
    const leading = raw.length - raw.trimStart().length;
    const value = raw.trim();
    return {
      key,
      value,
      valueStart: m.index + m[0].length - raw.length + leading,
      valueLength: value.length,
    };
  }
  return null;
}

function isSeparator(text: string): boolean {
  return /^[\s-]{20,}$/.test(text) && text.includes("-");
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
        valueStart: m.valueStart,
        valueLength: m.valueLength,
      });
      consumed.add(i);
      if (firstMetaIndex === -1) firstMetaIndex = i;
    }
  });

  // Section title: the line just before the first meta line.
  // Without meta lines, only accept line 1 as a title when the page
  // actually contains an items table — otherwise the second line of any
  // arbitrary document would be promoted to a heading — and when it cannot
  // be a table header, a separator, or a data row.
  let titleIndex = -1;
  if (firstMetaIndex >= 1) {
    titleIndex = firstMetaIndex - 1;
  } else if (lines.length > 1) {
    // A page counts as having a table when it has a divider line — headings
    // may use any wording. Without a divider there is no table, so a bare
    // "Item/Description" line alone grants nothing.
    const hasTable = lines.some((line) => isSeparator(textOf(line)));
    if (hasTable) {
      const candidate = lines[1];
      const candidateText = textOf(candidate);
      // A header sits directly above its divider — it is table furniture,
      // not a title (it will be consumed as the header below).
      const aboveDivider = lines.length > 2 && isSeparator(textOf(lines[2]));
      const looksStructural =
        aboveDivider || isSeparator(candidateText) || /^\d/.test(candidateText);
      if (!looksStructural) titleIndex = 1;
    }
  }
  let sectionTitle: string | null = null;
  if (titleIndex >= 0) {
    sectionTitle = textOf(lines[titleIndex]);
    consumed.add(titleIndex);
  }
  // Company name: line above the title
  if (titleIndex - 1 >= 0) consumed.add(titleIndex - 1);

  // Table header + rows - divider-anchored only. A dash divider marks the
  // table, the line immediately above it is the header, and the lines below
  // are the body until a total, note, or other non-data line exits the
  // table (totals stay available to later rules). Single table per page;
  // without a divider there is no table.
  //
  // Cells are plain text: pipe segments when the header uses "|" (exact
  // boundaries, so multi-word cells stay intact), text tokens otherwise.
  // Nothing is typed or validated - header words are display labels only,
  // never read for meaning. The table's width is the most common cell count
  // among its digit-led rows (first row wins ties); an outlier row is a
  // per-row refusal, an empty cell is a missing value.
  let headerLineNumber: number | null = null;
  let tableLabels: string[] | null = null;
  let tableHeaderText: string | null = null;
  const rows: ParsedRow[] = [];
  const badRows: BadRow[] = [];
  let tableProblem: TableProblem | null = null;

  const separatorIndex = lines.findIndex(
    (line, i) => !consumed.has(i) && isSeparator(textOf(line)),
  );

  // Split one body line into cells, or null when a piped table's line has
  // no pipes (malformed row - its siblings are unaffected).
  const splitBodyLine = (line: PageLine, piped: boolean): PipeCell[] | null => {
    if (!piped) {
      return line.tokens.map((token, i) => ({
        text: token.str,
        tokenIndices: [i],
      }));
    }
    const cells = splitPipeCells(line.tokens);
    return cells ? trimPipeEdges(cells) : null;
  };

  if (separatorIndex !== -1) {
    const candidate = separatorIndex - 1;
    const candidateLine =
      candidate >= 0 && !consumed.has(candidate) ? lines[candidate] : undefined;
    // Leading/trailing pipes are formatting (drop empties at the edges);
    // interior empties are unknown columns and stay.
    const rawHeader: PipeCell[] = candidateLine
      ? (splitPipeCells(candidateLine.tokens) ??
        candidateLine.tokens.map((token, i) => ({
          text: token.str,
          tokenIndices: [i],
        })))
      : [];
    const headerCells = trimPipeEdges(rawHeader);
    const headerTexts = headerCells.map((c) => c.text);
    const candidateText = candidateLine ? textOf(candidateLine) : "";
    const separatorText = textOf(lines[separatorIndex]);
    const piped =
      candidateLine?.tokens.some((t) => t.str.includes("|")) ?? false;
    const headerUsable =
      candidateLine !== undefined &&
      headerCells.length >= 2 &&
      !isSeparator(candidateText) &&
      !/^\d+$/.test(headerCells[0].text);
    if (!headerUsable) {
      tableProblem = {
        kind: "no_header",
        separatorLineNumber: separatorIndex,
        separatorText,
        headerLineNumber: null,
        headerText: null,
        expectedCells: 0,
        mismatchedRows: 0,
      };
      consumed.add(separatorIndex);
    } else {
      headerLineNumber = candidate;
      tableHeaderText = candidateText;
      consumed.add(candidate);
      consumed.add(separatorIndex);
      type RawRow = {
        lineNumber: number;
        lineText: string;
        cells: PipeCell[];
        digit: boolean;
      };
      const rawRows: RawRow[] = [];
      for (let i = separatorIndex + 1; i < lines.length; i++) {
        if (consumed.has(i)) continue;
        const lineText = textOf(lines[i]);
        if (isSeparator(lineText)) {
          consumed.add(i);
          continue;
        }
        // Totals (plain or labelled, piped or not) end the table
        // unconsumed so later rules still see them.
        if (/^Total:/.test(lineText) || /^Total\s+[A-Za-z]/.test(lineText))
          break;
        const split = splitBodyLine(lines[i], piped);
        if (!split) {
          if (/^\d+$/.test(cellsOf(lines[i])[0] ?? "")) {
            // Digit-led but unsplittable: malformed row, siblings unaffected.
            consumed.add(i);
            badRows.push({
              lineNumber: i,
              lineText,
              expectedCells: headerTexts.length,
              actualCells: cellsOf(lines[i]).length,
            });
          } else break;
          continue;
        }
        const digit = /^\d+$/.test(split[0]?.text ?? "");
        // Prose lines exit the table; piped lines attempting data without a
        // leading number are refused on their own without ending it.
        if (!digit && !piped) break;
        consumed.add(i);
        rawRows.push({ lineNumber: i, lineText, cells: split, digit });
      }
      // Table width: most common cell count among digit-led rows; ties go
      // to the heading count when it is among them (headings are usually
      // right about width even when their words mean nothing), else the
      // first row wins - one ragged row can't redefine the table.
      const widthFrequency = new Map<number, number>();
      for (const row of rawRows) {
        if (!row.digit) continue;
        widthFrequency.set(
          row.cells.length,
          (widthFrequency.get(row.cells.length) ?? 0) + 1,
        );
      }
      let tableWidth = 0;
      let bestCount = 0;
      for (const [width, count] of widthFrequency) {
        if (
          count > bestCount ||
          (count === bestCount && width === headerTexts.length)
        ) {
          bestCount = count;
          tableWidth = width;
        }
      }
      for (const row of rawRows) {
        if (!row.digit || row.cells.length !== tableWidth) {
          badRows.push({
            lineNumber: row.lineNumber,
            lineText: row.lineText,
            expectedCells: tableWidth,
            actualCells: row.cells.length,
          });
          continue;
        }
        if (row.cells.some((cell) => cell.text === "")) {
          badRows.push({
            lineNumber: row.lineNumber,
            lineText: row.lineText,
            expectedCells: tableWidth,
            actualCells: row.cells.length,
            detail: "one cell is empty (missing value)",
          });
          continue;
        }
        rows.push({
          cells: row.cells.map((cell) => cell.text),
          cellTokens: row.cells.map((cell) => cell.tokenIndices),
          lineNumber: row.lineNumber,
          lineText: row.lineText,
        });
      }
      // Labels align only when every extracted row matches the heading
      // count; otherwise the viewer shows generic columns with the header
      // line quoted as context.
      if (
        rows.length > 0 &&
        rows.every((row) => row.cells.length === headerTexts.length)
      ) {
        tableLabels = headerTexts;
      }
    }
  }

  // Everything else (notes, totals, page footers) is preserved for later rules
  const otherLines: OtherLine[] = [];
  lines.forEach((line, i) => {
    if (consumed.has(i)) return;
    otherLines.push({ lineNumber: i, text: textOf(line) });
  });

  return {
    pageNumber,
    sectionTitle,
    titleLineNumber: titleIndex >= 0 ? titleIndex : null,
    headerLineNumber,
    tableLabels,
    tableHeaderText,
    rows,
    badRows,
    tableProblem,
    meta,
    otherLines,
  };

}

// Leading/trailing pipes are formatting (drop empties at the edges);
// interior empties are unknown columns and stay.
function trimPipeEdges(cells: PipeCell[]): PipeCell[] {
  let start = 0;
  let end = cells.length;
  while (start < end && cells[start].text === "") start++;
  while (end > start && cells[end - 1].text === "") end--;
  return cells.slice(start, end);
}
