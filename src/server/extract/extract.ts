import { loadPages, type DocumentLoadResult } from "./pdf";
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
  let firstSectionTitle: { value: string; page: number } | null = null;

  for (const page of parsed) {
    const section = page.sectionTitle ?? `Page ${page.pageNumber}`;

    if (page.sectionTitle && firstSectionTitle === null) {
      firstSectionTitle = { value: page.sectionTitle, page: page.pageNumber };
    }

    for (const m of page.meta) {
      metaClaims.push({
        key: m.key,
        value: m.value,
        sourceText: m.sourceText,
        page: page.pageNumber,
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
        fieldNames.forEach((name, i) => {
          if (!name || name === "item") return;
          const cell = row.cells[i];
          if (!cell) return;
          record[name] = {
            value: cell,
            evidence: { page: page.pageNumber, sourceText: cell },
          };
        });

        if (!record.description) {
          refusals.push(
            badRowRefusal(page.pageNumber, section, {
              lineNumber: row.lineNumber,
              lineText: row.lineText,
              expectedCells: page.header?.length ?? 0,
              actualCells: row.cells.length,
            }),
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
      refusals.push(badRowRefusal(page.pageNumber, section, bad));
    }

    for (const other of page.otherLines) {
      notes.push({ text: other.text, page: page.pageNumber });

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
            ),
          );
          continue;
        }
        if (parseLeadingAmount(rest) !== null) {
          totalClaims.push({
            value: rest,
            evidence: { page: page.pageNumber, sourceText: other.text },
          });
        } else {
          refusals.push(
            valueNotStatedRefusal(
              page.pageNumber,
              "total",
              rest,
              other.text,
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
      },
    };
  }

  if (totalClaims.length > 0) {
    fields.total = totalClaims[0];
  }

  issues.push(...scanNumericClaimIssues(notes));

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
