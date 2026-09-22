import type { BadRow } from "./parse";
import type { EvidenceRect, Refusal } from "./types";

export function pageNoTextRefusal(pageNumber: number): Refusal {
  return {
    code: "page_no_text",
    scope: { page: pageNumber },
    plainLanguage: `Page ${pageNumber} contains an image rather than selectable text, so nothing on it could be read. This usually means the page was scanned or photographed. No numbers were taken from this page. Other pages, if any, were still processed.`,
    technicalDetail: `getTextContent returned no text items for page ${pageNumber} (image-only page).`,
  };
}

export function pageErrorRefusal(pageNumber: number, message: string): Refusal {
  return {
    code: "page_parse_failed",
    scope: { page: pageNumber },
    plainLanguage: `Page ${pageNumber} could not be processed, so nothing on it was extracted. Other pages, if any, were still processed.`,
    technicalDetail: `Page ${pageNumber} failed during text extraction: ${message}`,
  };
}

export function badRowRefusal(
  pageNumber: number,
  section: string,
  row: BadRow,
  rect?: EvidenceRect,
): Refusal {
  return {
    code: "unreadable_value",
    scope: { page: pageNumber, section, row: row.lineNumber },
    plainLanguage: `One line on page ${pageNumber} didn't match this document's table columns, so we couldn't tell which number meant what. It was left out rather than guessed. The line reads: "${row.lineText}"`,
    technicalDetail: `Row at line ${row.lineNumber} has ${row.actualCells} cells; header defines ${row.expectedCells}. Row skipped (badRow).`,
    evidence: { page: pageNumber, sourceText: row.lineText, rect },
  };
}

export function ambiguousReferenceRefusal(
  pageNumber: number,
  amounts: string[],
  sourceText: string,
  rect?: EvidenceRect,
): Refusal {
  return {
    code: "ambiguous_reference",
    scope: { page: pageNumber, field: "total" },
    plainLanguage: `The total line on page ${pageNumber} states more than one amount (${amounts.join(", ")}), so it isn't clear which figure is the document's total. Rather than pick one, no total was extracted from this line.`,
    technicalDetail: `Total line matched ${amounts.length} distinct amounts; ambiguous totals are refused instead of resolved heuristically.`,
    evidence: { page: pageNumber, sourceText, rect },
  };
}

export function valueNotStatedRefusal(
  pageNumber: number,
  label: string,
  quoted: string,
  sourceText: string,
  rect?: EvidenceRect,
): Refusal {
  return {
    code: "value_not_stated",
    scope: { page: pageNumber, field: label },
    plainLanguage: `The document refers to a total ${label} on page ${pageNumber} but doesn't give a number for it — it says "${quoted}". We only report numbers that are actually written in the document, so nothing was extracted for this.`,
    technicalDetail: `Line "${sourceText}" matched a total-${label} pattern but its value did not parse as a numeric amount.`,
    evidence: { page: pageNumber, sourceText, rect },
  };
}

export function traceabilityRefusal(
  pageNumber: number,
  field: string,
  value: string,
  sourceText: string,
): Refusal {
  return {
    code: "unreadable_value",
    scope: { page: pageNumber, field },
    plainLanguage: `A value for "${field}" on page ${pageNumber} could not be confirmed against the exact text it was supposedly taken from, so it was removed rather than reported unverified.`,
    technicalDetail: `Traceability check failed: value "${value}" not found in evidence sourceText "${sourceText}".`,
    evidence: { page: pageNumber, sourceText },
  };
}
