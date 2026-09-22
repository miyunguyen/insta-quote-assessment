import { evidenceContains } from "./normalize";
import { traceabilityRefusal } from "./rules";
import type { ExtractionResult, Refusal } from "./types";

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

export function verifyTraceability(result: ExtractionResult): {
  result: ExtractionResult;
  violations: Refusal[];
} {
  const violations: Refusal[] = [];
  const pageCount = result.document.pageCount;

  const document = {
    ...result.document,
    fields: checkFields(
      result.document.fields,
      "document",
      pageCount,
      (field, value, sourceText, page) =>
        violations.push(traceabilityRefusal(page, field, value, sourceText)),
    ),
  };

  const items = [];
  for (const item of result.items) {
    const copy = { ...item };
    let dropItem = false;

    const description = item.description;
    const descOk =
      description &&
      description.evidence.page >= 1 &&
      description.evidence.page <= pageCount &&
      evidenceContains(description.evidence.sourceText, description.value);
    if (!descOk) {
      dropItem = true;
      violations.push(
        traceabilityRefusal(
          description.evidence.page,
          "item.description",
          description.value,
          description.evidence.sourceText,
        ),
      );
    }

    const optional = checkFields(
      {
        quantity: item.quantity,
        unit: item.unit,
        weight: item.weight,
        unitPrice: item.unitPrice,
        lineTotal: item.lineTotal,
      },
      "item",
      pageCount,
      (field, value, sourceText, page) =>
        violations.push(traceabilityRefusal(page, field, value, sourceText)),
    );

    if (!dropItem) {
      items.push({ ...copy, ...optional });
    }
  }

  return {
    result: { ...result, document, items },
    violations,
  };
}
