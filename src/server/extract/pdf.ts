import { getDocumentProxy } from "unpdf";

export type PageToken = {
  str: string;
  x: number;
  y: number;
  width: number;
  fontSize: number;
};

export type PageLine = {
  y: number;
  tokens: PageToken[];
  text: string;
};

export type PageResult =
  | { pageNumber: number; status: "ok"; lines: PageLine[] }
  | { pageNumber: number; status: "no_text" }
  | { pageNumber: number; status: "error"; message: string };

export type DocumentLoadResult = {
  pageCount: number;
  pages: PageResult[];
};

const LINE_Y_TOLERANCE = 2.5;

type PdfTextItem = {
  str?: unknown;
  transform?: unknown;
  width?: unknown;
  height?: unknown;
  fontSize?: unknown;
};

function toItem(raw: unknown): PageToken | null {
  if (typeof raw !== "object" || raw === null) return null;
  const item = raw as PdfTextItem;
  if (typeof item.str !== "string" || item.str.trim() === "") return null;
  const transform = Array.isArray(item.transform)
    ? (item.transform as number[])
    : null;
  if (!transform || transform.length < 6) return null;
  const fontSize =
    typeof item.fontSize === "number" && item.fontSize > 0
      ? item.fontSize
      : Math.sqrt((transform[2] ?? 0) ** 2 + (transform[3] ?? 0) ** 2) || 12;
  return {
    str: item.str,
    x: transform[4],
    y: transform[5],
    width: typeof item.width === "number" ? item.width : 0,
    fontSize,
  };
}

export function groupIntoLines(tokens: PageToken[]): PageLine[] {
  const sorted = [...tokens].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: PageLine[] = [];
  for (const token of sorted) {
    const current = lines[lines.length - 1];
    if (current && Math.abs(current.y - token.y) <= LINE_Y_TOLERANCE) {
      current.tokens.push(token);
    } else {
      lines.push({ y: token.y, tokens: [token], text: token.str });
    }
  }
  for (const line of lines) {
    line.tokens.sort((a, b) => a.x - b.x);
    line.text = line.tokens.map((t) => t.str).join(" ");
  }
  return lines;
}

async function loadPage(
  pdf: Awaited<ReturnType<typeof getDocumentProxy>>,
  pageNumber: number,
): Promise<PageResult> {
  try {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const tokens: PageToken[] = [];
    for (const raw of content.items) {
      const token = toItem(raw);
      if (token) tokens.push(token);
    }
    if (tokens.length === 0) {
      return { pageNumber, status: "no_text" };
    }
    const lines = groupIntoLines(tokens);
    if (lines.length === 0) {
      return { pageNumber, status: "no_text" };
    }
    return { pageNumber, status: "ok", lines };
  } catch (err) {
    return {
      pageNumber,
      status: "error",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function loadPages(data: Uint8Array): Promise<DocumentLoadResult> {
  const pdf = await getDocumentProxy(data);
  try {
    const pageCount = pdf.numPages;
    const pages: PageResult[] = [];
    for (let n = 1; n <= pageCount; n++) {
      pages.push(await loadPage(pdf, n));
    }
    return { pageCount, pages };
  } finally {
    try {
      await (pdf as { destroy?: () => Promise<void> }).destroy?.();
    } catch {
      // destroy is best-effort cleanup
    }
  }
}
