import { loadPages, type DocumentLoadResult, type PageLine } from "./pdf";
import { headerFieldNames, parsePageLines, type ParsedPage } from "./parse";
import {
  ambiguousReferenceRefusal,
  badRowRefusal,
  pageErrorRefusal,
  pageNoTextRefusal,
  valueNotStatedRefusal,
  wouldRequireComputationRefusal,
} from "./rules";
import {
  collectDerivedLineTotals,
  metaContradictionIssue,
  rowArithmeticIssue,
  scanNumericClaimIssues,
  totalMismatchIssue,
  type MetaClaim,
  type NoteLine,
} from "./validate";
import { verifyTraceability } from "./verify";
import { parseLeadingAmount } from "./normalize";
import { lineRect, locateRect, tokenRect } from "./rects";
import {
  extractionResultSchema,
  type DocumentFields,
  type ExtractionResult,
  type FieldValue,
  type Issue,
  type LineItem,
  type Refusal,
} from "./types";

type MetaKey = "documentNumber" | "date" | "deliveredTo" | "orderedBy";

const META_KEYS: MetaKey[] = [
  "documentNumber",
  "date",
  "deliveredTo",
  "orderedBy",
];

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
  const refusals: Refusal[] = [];
  const issues: Issue[] = [];
  const parsed: ParsedPage[] = [];

  for (const page of doc.pages) {
    if (page.status === "no_text") {
      refusals.push(pageNoTextRefusal(page.pageNumber));
    } else if (page.status === "error") {
      refusals.push(pageErrorRefusal(page.pageNumber, page.message));
    } else {
      parsed.push(parsePageLines(page.pageNumber, page.lines));
    }
  }

  const items: LineItem[] = [];
  const fields: DocumentFields = {};
  const metaClaims: MetaClaim[] = [];
  const totalClaims: FieldValue[] = [];
  const notes: NoteLine[] = [];
  let firstSectionTitle: {
    value: string;
    page: number;
    lineNumber: number | null;
  } | null = null;

  // Raw page lines keyed by page, so every evidence box can be pinned to the
  // exact tokens it was read from (parsed rows keep lineNumber indices).
  const linesByPage = new Map<number, PageLine[]>();
  for (const page of doc.pages) {
    if (page.status === "ok") linesByPage.set(page.pageNumber, page.lines);
  }
  const lineOf = (
    pageNumber: number,
    lineNumber: number,
  ): PageLine | undefined => linesByPage.get(pageNumber)?.[lineNumber];
  const wholeLineRect = (pageNumber: number, lineNumber: number) => {
    const found = lineOf(pageNumber, lineNumber);
    return found ? lineRect(found) : undefined;
  };

  for (const page of parsed) {
    const section = page.sectionTitle ?? `Page ${page.pageNumber}`;

    if (page.sectionTitle && firstSectionTitle === null) {
      firstSectionTitle = {
        value: page.sectionTitle,
        page: page.pageNumber,
        lineNumber: page.titleLineNumber,
      };
    }

    for (const m of page.meta) {
      const metaLine = lineOf(page.pageNumber, m.lineNumber);
      metaClaims.push({
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
      const fieldNames = headerFieldNames(page.header);

      const hasQty = fieldNames.includes("quantity");
      const hasPrice = fieldNames.includes("unitPrice");
      const hasTotal = fieldNames.includes("lineTotal");
      if (hasQty && hasPrice && !hasTotal && page.rows.length > 0) {
        refusals.push(wouldRequireComputationRefusal(page.pageNumber, section));
      }

      for (const row of page.rows) {
        const record: Record<string, FieldValue> = {};
        const rowLine = lineOf(page.pageNumber, row.lineNumber);
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
              rect:
                token && token.str === cell ? tokenRect(token) : undefined,
            },
          };
        });

        if (!record.description) {
          refusals.push(
            badRowRefusal(
              page.pageNumber,
              section,
              {
                lineNumber: row.lineNumber,
                lineText: row.lineText,
                expectedCells: page.header?.length ?? 0,
                actualCells: row.cells.length,
              },
              wholeLineRect(page.pageNumber, row.lineNumber),
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
        items.push(item);

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

    for (const bad of page.badRows) {
      refusals.push(
        badRowRefusal(
          page.pageNumber,
          section,
          bad,
          wholeLineRect(page.pageNumber, bad.lineNumber),
        ),
      );
    }

    for (const other of page.otherLines) {
      notes.push({
        text: other.text,
        page: page.pageNumber,
        lineNumber: other.lineNumber,
      });

      const totalLine = /^Total:\s*(.+)$/.exec(other.text);
      if (totalLine) {
        const rest = totalLine[1].trim();
        const amountTokens = rest.match(/-?\$?\d[\d,]*(?:\.\d+)?/g) ?? [];
        const distinctAmounts = [...new Set(amountTokens)];
        if (distinctAmounts.length >= 2) {
          refusals.push(
            ambiguousReferenceRefusal(
              page.pageNumber,
              distinctAmounts,
              other.text,
              wholeLineRect(page.pageNumber, other.lineNumber),
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
          const totalLineRef = lineOf(page.pageNumber, other.lineNumber);
          totalClaims.push({
            value: rest,
            evidence: {
              page: page.pageNumber,
              sourceText: other.text,
              rect: totalLineRef
                ? locateRect(totalLineRef, valueStart, rest.length, rest)
                : undefined,
            },
          });
        } else {
          refusals.push(
            valueNotStatedRefusal(
              page.pageNumber,
              "total",
              rest,
              other.text,
              wholeLineRect(page.pageNumber, other.lineNumber),
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
          refusals.push(
            valueNotStatedRefusal(
              page.pageNumber,
              label,
              rest,
              other.text,
              wholeLineRect(page.pageNumber, other.lineNumber),
            ),
          );
        }
      }
    }
  }

  // Document-level meta: single distinct value wins; conflicts become
  // contradictions and the field is left unset (never quietly picked).
  for (const key of META_KEYS) {
    const claims = metaClaims.filter((c) => c.key === key);
    if (claims.length === 0) continue;
    const distinct = new Set(claims.map((c) => c.value));
    if (distinct.size === 1) {
      fields[key] = {
        value: claims[0].value,
        evidence: {
          page: claims[0].page,
          sourceText: claims[0].sourceText,
          rect: claims[0].rect,
        },
      };
    } else {
      issues.push(metaContradictionIssue(key, claims));
    }
  }

  if (firstSectionTitle) {
    fields.sectionTitle = {
      value: firstSectionTitle.value,
      evidence: {
        page: firstSectionTitle.page,
        sourceText: firstSectionTitle.value,
        rect:
          firstSectionTitle.lineNumber !== null
            ? wholeLineRect(firstSectionTitle.page, firstSectionTitle.lineNumber)
            : undefined,
      },
    };
  }

  if (totalClaims.length > 0) {
    fields.total = totalClaims[0];
  }

  issues.push(...scanNumericClaimIssues(notes, linesByPage));

  if (fields.total) {
    const lineTotals = items
      .map((i) => i.lineTotal)
      .filter((lt): lt is FieldValue => lt !== undefined);
    const mismatch = totalMismatchIssue(fields.total, lineTotals);
    if (mismatch) issues.push(mismatch);
  }

  issues.push(...collectDerivedLineTotals(items));

  const raw = {
    document: {
      fileName,
      pageCount: doc.pageCount,
      docType: detectDocType(firstSectionTitle?.value ?? null),
      fields,
    },
    items,
    refusals,
    issues,
  };

  const verified = verifyTraceability(extractionResultSchema.parse(raw));
  const withViolations = {
    ...verified.result,
    refusals: [...verified.result.refusals, ...verified.violations],
  };

  return extractionResultSchema.parse(withViolations);
}

export async function extractFromPdf(
  bytes: Uint8Array,
  fileName: string,
): Promise<ExtractionResult> {
  const doc = await loadPages(bytes);
  return buildExtraction(doc, fileName);
}
