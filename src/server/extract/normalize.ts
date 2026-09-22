export function collapseWs(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

export function normalizeForEvidence(s: string): string {
  return collapseWs(s);
}

export function evidenceContains(sourceText: string, value: string): boolean {
  const source = normalizeForEvidence(sourceText);
  const needle = normalizeForEvidence(value);
  if (needle.length === 0) return false;
  return source.includes(needle);
}

const AMOUNT_RE = /^(-?\d[\d,]*(?:\.\d+)?)/;

export function parseLeadingAmount(raw: string): number | null {
  const cleaned = collapseWs(raw).replace(/[$]/g, "");
  const match = AMOUNT_RE.exec(cleaned);
  if (!match) return null;
  const parsed = Number(match[1].replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}
