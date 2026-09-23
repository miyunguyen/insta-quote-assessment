import { loadPages, type DocumentLoadResult, type PageLine } from "./pdf";
import { parsePageLines, type ParsedPage } from "./parse";
import {
  ambiguousReferenceRefusal,
  badRowRefusal,
  pageErrorRefusal,
  pageNoTextRefusal,
  unparseableTableRefusal,
  valueNotStatedRefusal,
} from "./rules";
import {
  metaContradictionIssue,
  totalMismatchIssue,
  type MetaClaim,
} from "./validate";
import { verifyTraceability } from "./verify";
import { parseLeadingAmount } from "@/lib/text";
import { lineRect, locateRect, spanRect, tokenRect } from "./rects";
import {
  extractionResultSchema,
  type DocumentFields,
  type EvidenceRect,
  type ExtractionResult,
  type FieldValue,
  type Issue,
  type LineItem,
  type Refusal,
  type ResultPage,
} from "./types";

type MetaKey = "documentNumber" | "date" | "deliveredTo" | "orderedBy";

const META_KEYS: MetaKey[] = [
  "documentNumber",
  "date",
  "deliveredTo",
  "orderedBy",
];

// Per-page accumulator: every page of the document keeps its own heading,
// meta fields, total, items, and refusals instead of collapsing to one
// document-level record.
type PageBuild = {
  pageNumber: number;
  sectionTitle?: FieldValue;
  fields: DocumentFields;
  total?: FieldValue;
  items: LineItem[];
  refusals: Refusal[];
  tableLabels?: string[];
  tableHeaderText?: string;
};

function detectDocType(
  sectionTitle: string | null,
): "packing_list" | "delivery_docket" | "unknown" {
  if (!sectionTitle) return "unknown";
  if (/packing list/i.test(sectionTitle)) return "packing_list";
  if (/delivery|docket/i.test(sectionTitle)) return "delivery_docket";
  return "unknown";
}

export function buildExtraction(
  doc: DocumentLoadResult,
  fileName: string,
): ExtractionResult {
  const pageBuilds = new Map<number, PageBuild>();
  const acc: PageAccumulators = { issues: [], metaClaims: [], totalClaims: [] };
  const geo = buildGeometry(doc);
  const parsed = collectParsedPages(doc, pageBuilds);

  let firstSectionTitle: string | null = null;
  for (const page of parsed) {
    if (page.sectionTitle && firstSectionTitle === null) {
      firstSectionTitle = page.sectionTitle;
    }
    collectPageOutput(page, geo, pageBuild(pageBuilds, page.pageNumber), acc);
  }

  resolveMetaFields(acc.metaClaims, pageBuilds, acc.issues);
  resolvePageTotals(acc.totalClaims, pageBuilds);
  checkPageTotals(pageBuilds, acc.issues);

  const raw = {
    document: {
      fileName,
      pageCount: doc.pageCount,
      docType: detectDocType(firstSectionTitle),
    },
    pages: assemblePages(doc.pageCount, pageBuilds),
    issues: acc.issues,
  };

  const verified = verifyTraceability(extractionResultSchema.parse(raw));
  return extractionResultSchema.parse({
    ...verified.result,
    pages: distributeViolations(verified.result.pages, verified.violations),
  });
}

// --- Extraction stages -----------------------------------------------------
// buildExtraction below only orchestrates these: each stage has one job and
// explicit inputs/outputs, so a stage can change without touching the rest.

type TotalClaim = { page: number; field: FieldValue };

type PageAccumulators = {
  issues: Issue[];
  metaClaims: MetaClaim[];
  totalClaims: TotalClaim[];
};

type PageGeometry = {
  lineOf: (pageNumber: number, lineNumber: number) => PageLine | undefined;
  wholeLineRect: (
    pageNumber: number,
    lineNumber: number,
  ) => EvidenceRect | undefined;
};

function pageBuild(
  pageBuilds: Map<number, PageBuild>,
  pageNumber: number,
): PageBuild {
  let build = pageBuilds.get(pageNumber);
  if (!build) {
    build = { pageNumber, fields: {}, items: [], refusals: [] };
    pageBuilds.set(pageNumber, build);
  }
  return build;
}

// Raw page lines keyed by page, so every evidence box can be pinned to the
// exact tokens it was read from (parsed rows keep lineNumber indices).
function buildGeometry(doc: DocumentLoadResult): PageGeometry {
  const linesByPage = new Map<number, PageLine[]>();
  for (const page of doc.pages) {
    if (page.status === "ok") linesByPage.set(page.pageNumber, page.lines);
  }
  const lineOf = (pageNumber: number, lineNumber: number) =>
    linesByPage.get(pageNumber)?.[lineNumber];
  return {
    lineOf,
    wholeLineRect: (pageNumber, lineNumber) => {
      const found = lineOf(pageNumber, lineNumber);
      return found ? lineRect(found) : undefined;
    },
  };
}

// Sort pages into refusals (no_text/error) versus parsed content.
function collectParsedPages(
  doc: DocumentLoadResult,
  pageBuilds: Map<number, PageBuild>,
): ParsedPage[] {
  const parsed: ParsedPage[] = [];
  for (const page of doc.pages) {
    if (page.status === "no_text") {
      pageBuild(pageBuilds, page.pageNumber).refusals.push(
        pageNoTextRefusal(page.pageNumber),
      );
    } else if (page.status === "error") {
      pageBuild(pageBuilds, page.pageNumber).refusals.push(
        pageErrorRefusal(page.pageNumber, page.message),
      );
    } else {
      parsed.push(parsePageLines(page.pageNumber, page.lines));
    }
  }
  return parsed;
}

// One parsed page: heading, meta claims, row items, totals. Push order into
// build.refusals / acc.issues matches the old inline loop exactly.
function collectPageOutput(
  page: ParsedPage,
  geo: PageGeometry,
  build: PageBuild,
  acc: PageAccumulators,
): void {
  const section = page.sectionTitle ?? `Page ${page.pageNumber}`;

  if (page.sectionTitle && page.titleLineNumber !== null) {
    build.sectionTitle = {
      value: page.sectionTitle,
      evidence: {
        page: page.pageNumber,
        sourceText: page.sectionTitle,
        rect: geo.wholeLineRect(page.pageNumber, page.titleLineNumber),
      },
    };
  }

  for (const m of page.meta) {
    const metaLine = geo.lineOf(page.pageNumber, m.lineNumber);
    acc.metaClaims.push({
      key: m.key,
      value: m.value,
      sourceText: m.sourceText,
      page: page.pageNumber,
      // Pin to this line's own value occurrence — e.g. date
      // "12 August 2026" must not resolve to a later "12" elsewhere.
      rect: metaLine
        ? locateRect(metaLine, m.valueStart, m.valueLength, m.value)
        : undefined,
    });
  }

  if (page.tableProblem) {
    // The table was seen but has no usable header — one refusal covers the
    // whole table; no rows are extracted and no per-row refusals are added.
    const problem = page.tableProblem;
    build.refusals.push(
      unparseableTableRefusal(
        page.pageNumber,
        section,
        problem,
        geo.wholeLineRect(
          page.pageNumber,
          problem.headerLineNumber ?? problem.separatorLineNumber,
        ),
      ),
    );
  } else {
    if (page.tableLabels) build.tableLabels = page.tableLabels;
    if (page.tableHeaderText) build.tableHeaderText = page.tableHeaderText;
    collectRowItems(page, geo, build);

    for (const bad of page.badRows) {
      build.refusals.push(
        badRowRefusal(
          page.pageNumber,
          section,
          bad,
          geo.wholeLineRect(page.pageNumber, bad.lineNumber),
        ),
      );
    }
  }

  collectPageTotals(page, geo, build, acc.totalClaims);
}

function collectRowItems(
  page: ParsedPage,
  geo: PageGeometry,
  build: PageBuild,
): void {
  const section = buildSection(page, build);
  const labels = page.tableLabels;
  for (const row of page.rows) {
    const rowLine = geo.lineOf(page.pageNumber, row.lineNumber);
    const cells = row.cells.map((text, i) => {
      // cells[i] aligns with row.cellTokens[i] by construction (pipe
      // tables: exact pipe segments; token tables: identity spans) — the
      // box is that span's own position, never a text re-search (so a
      // quantity "12" can no longer land on the "12" inside a date on the
      // same page).
      const span = row.cellTokens[i] ?? [i];
      const slice = rowLine
        ? span.flatMap((j) => {
            const token = rowLine.tokens[j];
            return token ? [token] : [];
          })
        : [];
      return {
        label: labels?.[i] ?? "",
        value: text,
        evidence: {
          page: page.pageNumber,
          sourceText: text,
          rect:
            slice.length === 1 && slice[0].str === text
              ? tokenRect(slice[0])
              : spanRect(slice),
        },
      };
    });

    build.items.push({ section, cells, rowSourceText: row.lineText });
  }
}

// Item section: the page's own heading when it has one, else "Page N".
// Stored per item so rows stay readable outside their page block.
function buildSection(page: ParsedPage, build: PageBuild): string {
  return build.sectionTitle?.value ?? `Page ${page.pageNumber}`;
}

function collectPageTotals(
  page: ParsedPage,
  geo: PageGeometry,
  build: PageBuild,
  totalClaims: TotalClaim[],
): void {
  for (const other of page.otherLines) {
    const totalLine = /^Total:\s*(.+)$/.exec(other.text);
    if (totalLine) {
      const raw = totalLine[1].trim();
      // Pipe-delimited totals ("Total: | $2,630.00"): the pipes are cell
      // dividers, not part of the amount.
      const rest = raw.replace(/^(\|\s*)+/, "");
      const amountTokens = rest.match(/-?\$?\d[\d,]*(?:\.\d+)?/g) ?? [];
      const distinctAmounts = [...new Set(amountTokens)];
      if (distinctAmounts.length >= 2) {
        build.refusals.push(
          ambiguousReferenceRefusal(
            page.pageNumber,
            distinctAmounts,
            other.text,
            geo.wholeLineRect(page.pageNumber, other.lineNumber),
          ),
        );
        continue;
      }
      if (parseLeadingAmount(rest) !== null) {
        // (.+)$ runs to the end of the match, so the value start needs no
        // ambiguous indexOf search; the stripped pipe prefix is added back
        // so the box lands on the amount, not the divider.
        const rawLine = totalLine[1];
        const leading = rawLine.length - rawLine.trimStart().length;
        const trimmed = rawLine.trim();
        const valueStart =
          totalLine.index +
          totalLine[0].length -
          rawLine.length +
          leading +
          (trimmed.length - rest.length);
        const totalLineRef = geo.lineOf(page.pageNumber, other.lineNumber);
        totalClaims.push({
          page: page.pageNumber,
          field: {
            value: rest,
            evidence: {
              page: page.pageNumber,
              sourceText: other.text,
              rect: totalLineRef
                ? locateRect(totalLineRef, valueStart, rest.length, rest)
                : undefined,
            },
          },
        });
      } else {
        build.refusals.push(
          valueNotStatedRefusal(
            page.pageNumber,
            "total",
            rest,
            other.text,
            geo.wholeLineRect(page.pageNumber, other.lineNumber),
          ),
        );
      }
      continue;
    }

    const labelledTotal = /^Total\s+([A-Za-z][A-Za-z ]*?):\s*(.+)$/.exec(
      other.text,
    );
    if (labelledTotal) {
      const label = labelledTotal[1].trim().toLowerCase();
      const rest = labelledTotal[2].trim();
      if (parseLeadingAmount(rest) === null) {
        build.refusals.push(
          valueNotStatedRefusal(
            page.pageNumber,
            label,
            rest,
            other.text,
            geo.wholeLineRect(page.pageNumber, other.lineNumber),
          ),
        );
      }
    }
  }
}

// Meta resolution per key: unanimous across pages → every claiming page
// keeps its own copy; divergent values → one contradiction issue and no
// page keeps the field (never quietly picked).
function resolveMetaFields(
  metaClaims: MetaClaim[],
  pageBuilds: Map<number, PageBuild>,
  issues: Issue[],
): void {
  for (const key of META_KEYS) {
    const claims = metaClaims.filter((c) => c.key === key);
    if (claims.length === 0) continue;
    const distinct = new Set(claims.map((c) => c.value));
    if (distinct.size === 1) {
      for (const claim of claims) {
        const build = pageBuild(pageBuilds, claim.page);
        if (!build.fields[key]) {
          build.fields[key] = {
            value: claim.value,
            evidence: {
              page: claim.page,
              sourceText: claim.sourceText,
              rect: claim.rect,
            },
          };
        }
      }
    } else {
      issues.push(metaContradictionIssue(key, claims));
    }
  }
}

// One total per page: the first total claim on that page wins.
function resolvePageTotals(
  totalClaims: TotalClaim[],
  pageBuilds: Map<number, PageBuild>,
): void {
  for (const { page, field } of totalClaims) {
    const build = pageBuild(pageBuilds, page);
    if (!build.total) build.total = field;
  }
}

// A stated total is checked against its own page's line totals only -
// each page/section of a multi-page document stands on its own. This is
// the one cross-check: genuine conflict in stated numbers. The only number
// ever interpreted is a trailing money cell ("$" required, so a trailing
// quantity or note column can't be mistaken for a total). The check needs a
// price column and a total column, so it runs only when every row carries
// at least two money cells - anything less is skipped, never guessed.
function checkPageTotals(
  pageBuilds: Map<number, PageBuild>,
  issues: Issue[],
): void {
  for (const build of pageBuilds.values()) {
    if (!build.total || build.items.length === 0) continue;
    const lineTotals: FieldValue[] = [];
    let complete = true;
    for (const item of build.items) {
      const moneyCells = item.cells.filter((cell) =>
        cell.value.includes("$"),
      );
      const last = item.cells[item.cells.length - 1];
      if (
        moneyCells.length < 2 ||
        !last ||
        !last.value.includes("$") ||
        parseLeadingAmount(last.value) === null
      ) {
        complete = false;
        break;
      }
      lineTotals.push({ value: last.value, evidence: last.evidence });
    }
    if (!complete) continue;
    const mismatch = totalMismatchIssue(build.total, lineTotals);
    if (mismatch) issues.push(mismatch);
  }
}

// Every page 1..pageCount appears, even image-only ones (shell + refusal).
function assemblePages(
  pageCount: number,
  pageBuilds: Map<number, PageBuild>,
): ResultPage[] {
  return Array.from({ length: pageCount }, (_, index) => {
    const build = pageBuilds.get(index + 1);
    return {
      pageNumber: index + 1,
      ...(build?.sectionTitle ? { sectionTitle: build.sectionTitle } : {}),
      fields: build?.fields ?? {},
      ...(build?.total ? { total: build.total } : {}),
      items: build?.items ?? [],
      refusals: build?.refusals ?? [],
      ...(build?.tableLabels ? { tableLabels: build.tableLabels } : {}),
      ...(build?.tableHeaderText
        ? { tableHeaderText: build.tableHeaderText }
        : {}),
    };
  });
}

// Violations carry their own scope.page — route each back onto its page
// (first page as an unreachable-from-our-builder fallback, never dropped).
function distributeViolations(
  pages: ResultPage[],
  violations: Refusal[],
): ResultPage[] {
  const copies = pages.map((page) => ({
    ...page,
    refusals: [...page.refusals],
  }));
  const byPage = new Map(copies.map((page) => [page.pageNumber, page]));
  for (const violation of violations) {
    const target = byPage.get(violation.scope.page) ?? copies[0];
    target?.refusals.push(violation);
  }
  return copies;
}

export async function extractFromPdf(
  bytes: Uint8Array,
  fileName: string,
): Promise<ExtractionResult> {
  const doc = await loadPages(bytes);
  return buildExtraction(doc, fileName);
}
