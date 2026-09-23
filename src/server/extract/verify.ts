import { evidenceContains } from "@/lib/text";
import { traceabilityRefusal } from "./rules";
import type {
  CellValue,
  DocumentFields,
  ExtractionResult,
  FieldValue,
  LineItem,
  Refusal,
  ResultPage,
} from "./types";

type FieldName = string;

function checkFields<T extends Record<string, { value: string; evidence: { page: number; sourceText: string } } | undefined>>(
  fields: T,
  owner: string,
  pageCount: number,
  onViolation: (field: FieldName, value: string, sourceText: string, page: number) => void,
): T {
  const out = { ...fields };
  for (const [name, fieldValue] of Object.entries(fields)) {
    if (!fieldValue) continue;
    const { value, evidence } = fieldValue;
    const inBounds = evidence.page >= 1 && evidence.page <= pageCount;
    if (!inBounds || !evidenceContains(evidence.sourceText, value)) {
      delete out[name];
      onViolation(`${owner}.${name}`, value, evidence.sourceText, evidence.page);
    }
  }
  return out;
}

function checkOptionalField(
  fieldValue: FieldValue | undefined,
  owner: string,
  pageCount: number,
  onViolation: (field: FieldName, value: string, sourceText: string, page: number) => void,
): FieldValue | undefined {
  if (!fieldValue) return undefined;
  const { value, evidence } = fieldValue;
  const inBounds = evidence.page >= 1 && evidence.page <= pageCount;
  if (!inBounds || !evidenceContains(evidence.sourceText, value)) {
    onViolation(owner, value, evidence.sourceText, evidence.page);
    return undefined;
  }
  return fieldValue;
}

function verifyPage(
  page: ResultPage,
  pageCount: number,
  onViolation: (field: FieldName, value: string, sourceText: string, page: number) => void,
): ResultPage {
  const owner = `page ${page.pageNumber}`;
  const fields: DocumentFields = checkFields(
    page.fields,
    owner,
    pageCount,
    onViolation,
  );
  const sectionTitle = checkOptionalField(
    page.sectionTitle,
    `${owner}.sectionTitle`,
    pageCount,
    onViolation,
  );
  const total = checkOptionalField(
    page.total,
    `${owner}.total`,
    pageCount,
    onViolation,
  );

  const items: LineItem[] = [];
  for (const item of page.items) {
    const cells: CellValue[] = [];
    item.cells.forEach((cell, index) => {
      const { value, evidence } = cell;
      const inBounds = evidence.page >= 1 && evidence.page <= pageCount;
      if (!inBounds || !evidenceContains(evidence.sourceText, value)) {
        onViolation(
          `${owner}.item.cell_${index}`,
          value,
          evidence.sourceText,
          evidence.page,
        );
        return;
      }
      cells.push(cell);
    });
    // A row whose every cell fails verification carries nothing verifiable.
    if (cells.length > 0) {
      items.push({ ...item, cells });
    }
  }

  return { ...page, sectionTitle, fields, total, items };
}

export function verifyTraceability(result: ExtractionResult): {
  result: ExtractionResult;
  violations: Refusal[];
} {
  const violations: Refusal[] = [];
  const pageCount = result.document.pageCount;
  const onViolation = (field: FieldName, value: string, sourceText: string, page: number) =>
    violations.push(traceabilityRefusal(page, field, value, sourceText));

  const pages = result.pages.map((page) =>
    verifyPage(page, pageCount, onViolation),
  );

  return {
    result: { ...result, pages },
    violations,
  };
}
