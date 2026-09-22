import { parseLeadingAmount } from "./normalize";
import type { EvidenceRect, FieldValue, Issue } from "./types";

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
  rect?: EvidenceRect;
};

export function metaContradictionIssue(
  key: string,
  claims: MetaClaim[],
): Issue {
  const pretty =
    {
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
      evidence: { page: c.page, sourceText: c.sourceText, rect: c.rect },
    })),
  };
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
