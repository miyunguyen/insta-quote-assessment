import { loadPages, type DocumentLoadResult, type PageLine } from "./pdf";
import { headerFieldNames, parsePageLines, type ParsedPage } from "./parse";
import {
  ambiguousReferenceRefusal,
  badRowRefusal,
  pageErrorRefusal,
  pageNoTextRefusal,
  valueNotStatedRefusal,
} from "./rules";
import {
  metaContradictionIssue,
  rowArithmeticIssue,
  totalMismatchIssue,
  type MetaClaim,
} from "./validate";
import { verifyTraceability } from "./verify";
import { parseLeadingAmount } from "@/lib/text";
import { lineRect, locateRect, tokenRect } from "./rects";
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
};

function detectDocType(sectionTitle: string | null): "packing_list" | "delivery_docket" | "unknown" {
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
  lineOf: (
    pageNumber: number,
    lineNumber: number,
  ) => PageLine | undefined;
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

  if (page.header) {
    collectRowItems(page, section, geo, build, acc.issues);
  }

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

  collectPageTotals(page, geo, build, acc.totalClaims);
}

function collectRowItems(
  page: ParsedPage,
  section: string,
  geo: PageGeometry,
  build: PageBuild,
  issues: Issue[],
): void {
  const fieldNames = headerFieldNames(page.header!);
  for (const row of page.rows) {
    const record: Record<string, FieldValue> = {};
    const rowLine = geo.lineOf(page.pageNumber, row.lineNumber);
    fieldNames.forEach((name, i) => {
      if (!name || name === "item") return;
      const cell = row.cells[i];
      if (!cell) return;
      // cells[i] is tokens[i] by construction — the box is that token's
      // own position, never a text re-search (so a quantity "12" can no
      // longer land on the "12" inside a date on the same page).
      const token = rowLine?.tokens[i];
      record[name] = {
        value: cell,
        evidence: {
          page: page.pageNumber,
          sourceText: cell,
          rect: token && token.str === cell ? tokenRect(token) : undefined,
        },
      };
    });

    if (!record.description) {
      build.refusals.push(
        badRowRefusal(
          page.pageNumber,
          section,
          {
            lineNumber: row.lineNumber,
            lineText: row.lineText,
            expectedCells: page.header?.length ?? 0,
            actualCells: row.cells.length,
          },
          geo.wholeLineRect(page.pageNumber, row.lineNumber),
        ),
      );
      continue;
    }

    const item: LineItem = {
      section,
      description: record.description,
      rowSourceText: row.lineText,
      ...(record.quantity ? { quantity: record.quantity } : {}),
      ...(record.unit ? { unit: record.unit } : {}),
      ...(record.weight ? { weight: record.weight } : {}),
      ...(record.unitPrice ? { unitPrice: record.unitPrice } : {}),
      ...(record.lineTotal ? { lineTotal: record.lineTotal } : {}),
    };
    build.items.push(item);

    if (item.quantity && item.unitPrice && item.lineTotal) {
      const issue = rowArithmeticIssue(
        page.pageNumber,
        `row "${item.description.value}"`,
        item.quantity,
        item.unitPrice,
        item.lineTotal,
      );
      if (issue) issues.push(issue);
    }
  }
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
      const rest = totalLine[1].trim();
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
        // ambiguous indexOf search.
        const raw = totalLine[1];
        const leading = raw.length - raw.trimStart().length;
        const valueStart =
          totalLine.index + totalLine[0].length - raw.length + leading;
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

    const labelledTotal =
      /^Total\s+([A-Za-z][A-Za-z ]*?):\s*(.+)$/.exec(other.text);
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

// A stated total is checked against its own page's line totals only —
// each page/section of a multi-page document stands on its own. This is
// the one bonus cross-check: genuine conflict in stated numbers.
function checkPageTotals(
  pageBuilds: Map<number, PageBuild>,
  issues: Issue[],
): void {
  for (const build of pageBuilds.values()) {
    if (build.total) {
      const lineTotals = build.items
        .map((i) => i.lineTotal)
        .filter((lt): lt is FieldValue => lt !== undefined);
      const mismatch = totalMismatchIssue(build.total, lineTotals);
      if (mismatch) issues.push(mismatch);
    }
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
    };
  });
}

// Violations carry their own scope.page — route each back onto its page
// (first page as an unreachable-from-our-builder fallback, never dropped).
function distributeViolations(
  pages: ResultPage[],
  violations: Refusal[],
): ResultPage[] {
  const copies = pages.map((page) => ({ ...page, refusals: [...page.refusals] }));
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
