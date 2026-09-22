import { collapseWhitespace } from "./text";
import type { EvidenceRect } from "@/server/extract/types";
import type { PdfTextItem, PdfViewport } from "./pdfjs";

// Highlight geometry: locate evidence text among a page's text items and
// return boxes in viewport (CSS pixel) coordinates. width/height come from
// pdf.js in PDF user-space units, so they are scaled by the viewport scale;
// the origin is converted with the viewport itself (handles the y-axis flip).

export type HighlightRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

const PAD = 2;

function toBox(
  baseX: number,
  baseY: number,
  width: number,
  height: number,
): HighlightRect {
  return {
    left: baseX - PAD,
    top: baseY - height - PAD,
    width: width + PAD * 2,
    height: height + PAD * 2,
  };
}
/**
  Convert an extraction-time rect (PDF user-space units, baseline origin —
  the same transform[4]/transform[5] the server records) into one viewport
  box. No text re-search, so repeated text can't misplace the box.
*/
export function evidenceRectToBox(
  viewport: PdfViewport,
  rect: EvidenceRect,
): HighlightRect {
  const [baseX, baseY] = viewport.convertToViewportPoint(rect.x, rect.y);
  return toBox(
    baseX,
    baseY,
    Math.max(rect.width * viewport.scale, 4),
    rect.height * viewport.scale,
  );
}

export function toTextItem(raw: unknown): PdfTextItem | null {
  if (typeof raw !== "object" || raw === null) return null;
  const item = raw as Partial<PdfTextItem>;
  if (typeof item.str !== "string" || item.str.trim() === "") return null;
  if (!Array.isArray(item.transform) || item.transform.length < 6) return null;
  return {
    str: item.str,
    transform: item.transform as number[],
    width: typeof item.width === "number" ? item.width : 0,
    height: typeof item.height === "number" ? item.height : 0,
  };
}

/**
  Locate the evidence text among the page's text items (first match wins —
  callers must prefer evidenceRectToBox whenever an extraction-time rect
  exists).
*/
export function findHighlightRects(
  viewport: PdfViewport,
  items: PdfTextItem[],
  sourceText: string,
): HighlightRect[] {
  const needle = collapseWhitespace(sourceText);
  if (!needle) return [];

  const joined: string[] = [];
  const spans: Array<{ start: number; end: number; index: number }> = [];
  let cursor = 0;
  items.forEach((item, index) => {
    const text = collapseWhitespace(item.str);
    if (!text) return;
    if (joined.length > 0) {
      joined.push(" ");
      cursor += 1;
    }
    const start = cursor;
    joined.push(text);
    cursor += text.length;
    spans.push({ start, end: cursor, index });
  });
  const haystack = joined.join("");

  let matchStart = haystack.indexOf(needle);
  let matchEnd = matchStart >= 0 ? matchStart + needle.length : -1;
  if (matchStart < 0) {
    // Fallback: a single item whose text equals the evidence (whitespace
    // differences between extraction and render can break the join match).
    const exact = spans.find(
      (span) => collapseWhitespace(items[span.index].str) === needle,
    );
    if (!exact) return [];
    matchStart = exact.start;
    matchEnd = exact.end;
  }

  const rects: HighlightRect[] = [];
  for (const span of spans) {
    if (span.end <= matchStart || span.start >= matchEnd) continue;
    const item = items[span.index];
    const [baseX, baseY] = viewport.convertToViewportPoint(
      item.transform[4],
      item.transform[5],
    );
    const fontSize = Math.hypot(item.transform[2], item.transform[3]) || 10;
    rects.push(
      toBox(
        baseX,
        baseY,
        Math.max(item.width * viewport.scale, 4),
        (item.height > 0 ? item.height : fontSize) * viewport.scale,
      ),
    );
  }
  return filterRects(viewport, rects);
}

/**
  Sanity filter shared by both highlight paths: never draw a box that is
  wildly off the rendered page (protects against any geometry assumption
  being wrong for odd PDFs).
*/
export function filterRects(
  viewport: PdfViewport,
  rects: HighlightRect[],
): HighlightRect[] {
  return rects.filter(
    (rect) =>
      rect.width > 0 &&
      rect.width < viewport.width + 100 &&
      rect.height > 0 &&
      rect.height < viewport.height + 100 &&
      rect.left > -100 &&
      rect.left < viewport.width + 100 &&
      rect.top > -100 &&
      rect.top < viewport.height + 100,
  );
}
