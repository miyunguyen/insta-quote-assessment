import { parseLeadingAmount } from "./normalize";
import type { Claim, FieldValue, Issue, LineItem } from "./types";

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function formatMoney(n: number): string {
  const sign = n < 0 ? "-" : "";
  const [int, dec] = Math.abs(n).toFixed(2).split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}$${grouped}.${dec}`;
}

export type MetaClaim = {
  key: string;
  value: string;
  sourceText: string;
  page: number;
};

export function metaContradictionIssue(
  key: string,
  claims: MetaClaim[],
): Issue {
  const pretty = {
    documentNumber: "document number",
    date: "date",
    deliveredTo: "delivery address",
    orderedBy: "order contact",
  }[key] ?? key;
  const listed = claims
    .map((c) => `"${c.value}" (page ${c.page})`)
    .join(" vs ");
  return {
    code: "contradiction",
    plainLanguage: `This document states different values for the ${pretty}: ${listed}. Every claim is listed with its own source — we don't pick one.`,
    claims: claims.map((c) => ({
      label: `Page ${c.page}`,
      value: c.value,
      evidence: { page: c.page, sourceText: c.sourceText },
    })),
  };
}

export type NoteLine = { text: string; page: number };

const NUMERIC_CLAIM_RE = /(\d+)\s+(pallets?)\b/gi;

export function scanNumericClaimIssues(notes: NoteLine[]): Issue[] {
  const groups = new Map<
    string,
    Array<{ noun: string; num: string; matchText: string; note: NoteLine }>
  >();
  for (const note of notes) {
    NUMERIC_CLAIM_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = NUMERIC_CLAIM_RE.exec(note.text)) !== null) {
      const noun = m[2].toLowerCase();
      const entry = {
        noun,
        num: m[1],
        matchText: m[0].trim(),
        note,
      };
      const list = groups.get(noun) ?? [];
      list.push(entry);
      groups.set(noun, list);
    }
  }

  const issues: Issue[] = [];
  for (const [, entries] of groups) {
    const distinct = new Set(entries.map((e) => e.num));
    if (distinct.size < 2) continue;
    const claims: Claim[] = entries.map((e) => {
      const colon = e.note.text.indexOf(":");
      const prefix = colon > 0 && colon < 40 ? e.note.text.slice(0, colon).trim() : null;
      return {
        label: prefix ?? `Page ${e.note.page} note`,
        value: e.matchText,
        evidence: { page: e.note.page, sourceText: e.note.text },
      };
    });
    const listed = claims
      .map((c) => `${c.value} ("${c.label}", page ${c.evidence.page})`)
      .join(" and ");
    issues.push({
      code: "contradiction",
      plainLanguage: `This document gives conflicting numbers of ${entries[0].noun}: ${listed}. Both statements are shown with their sources — we don't choose one.`,
      claims,
    });
  }
  return issues;
}

export function rowArithmeticIssue(
  page: number,
  rowLabel: string,
  quantity: FieldValue,
  unitPrice: FieldValue,
  lineTotal: FieldValue,
): Issue | null {
  const q = parseLeadingAmount(quantity.value);
  const p = parseLeadingAmount(unitPrice.value);
  const t = parseLeadingAmount(lineTotal.value);
  if (q === null || p === null || t === null) return null;
  const calc = round2(q * p);
  if (Math.abs(calc - t) < 0.005) return null;
  const currency =
    unitPrice.value.includes("$") || lineTotal.value.includes("$");
  const derivedValue = currency ? formatMoney(calc) : String(calc);
  return {
    code: "arithmetic_mismatch",
    plainLanguage: `On page ${page}, ${rowLabel}: the stated line total ${lineTotal.value} doesn't equal quantity × unit price (which comes to ${derivedValue}). The stated figure is reported as written; the calculated figure appears only as this check. We don't correct the document.`,
    stated: [lineTotal],
    derived: {
      value: derivedValue,
      derivation: "quantity × unit price (calculated as a cross-check only)",
      operands: [quantity, unitPrice],
    },
  };
}

export function totalMismatchIssue(
  total: FieldValue,
  lineTotals: FieldValue[],
): Issue | null {
  if (lineTotals.length === 0) return null;
  const stated = parseLeadingAmount(total.value);
  if (stated === null) return null;
  let sum = 0;
  for (const lt of lineTotals) {
    const v = parseLeadingAmount(lt.value);
    if (v === null) return null;
    sum = round2(sum + v);
  }
  if (Math.abs(round2(sum) - stated) < 0.005) return null;
  const currency = lineTotals.some((lt) => lt.value.includes("$"));
  const derivedValue = currency ? formatMoney(sum) : String(sum);
  return {
    code: "arithmetic_mismatch",
    plainLanguage: `The stated total ${total.value} doesn't equal the sum of the stated line totals, which comes to ${derivedValue}. Both numbers come from the document; we report the stated total as written and flag the mismatch instead of picking a winner.`,
    stated: [total],
    derived: {
      value: derivedValue,
      derivation: `sum of ${lineTotals.length} stated line totals (calculated as a cross-check only)`,
      operands: lineTotals,
    },
  };
}

export function derivedLineTotalIssue(
  page: number,
  rowLabel: string,
  quantity: FieldValue,
  unitPrice: FieldValue,
): Issue | null {
  const q = parseLeadingAmount(quantity.value);
  const p = parseLeadingAmount(unitPrice.value);
  if (q === null || p === null) return null;
  const calc = round2(q * p);
  const currency = unitPrice.value.includes("$");
  const derivedValue = currency ? formatMoney(calc) : String(calc);
  return {
    code: "derived_value",
    plainLanguage: `${rowLabel} on page ${page} doesn't state a line total. Quantity × unit price would be ${derivedValue}. This is shown only as a cross-check — it is NOT reported as an extracted value, because the document never writes it. (See the matching refusal for why no line total appears.)`,
    derived: {
      value: derivedValue,
      derivation: "quantity × unit price (calculated as a cross-check only)",
      operands: [quantity, unitPrice],
    },
  };
}

export function collectDerivedLineTotals(items: LineItem[]): Issue[] {
  const issues: Issue[] = [];
  items.forEach((item, index) => {
    if (item.lineTotal) return;
    if (!item.quantity || !item.unitPrice) return;
    const issue = derivedLineTotalIssue(
      item.quantity.evidence.page,
      `Row ${index + 1} ("${item.description.value}")`,
      item.quantity,
      item.unitPrice,
    );
    if (issue) issues.push(issue);
  });
  return issues;
}
