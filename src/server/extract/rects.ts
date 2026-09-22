import { collapseWhitespace } from "@/lib/text";
import type { PageLine, PageToken } from "./pdf";
import type { EvidenceRect } from "./types";

// Geometry helpers: turn extraction-time tokens into evidence rects.

export function tokenRect(token: PageToken): EvidenceRect {
  const height =
    typeof token.height === "number" && token.height > 0
      ? token.height
      : token.fontSize;
  return {
    x: token.x,
    y: token.y,
    width: Math.max(token.width, 0),
    height,
  };
}

function unionRects(rects: EvidenceRect[]): EvidenceRect | undefined {
  if (rects.length === 0) return undefined;
  const x0 = Math.min(...rects.map((r) => r.x));
  const x1 = Math.max(...rects.map((r) => r.x + r.width));
  const heights = rects.map((r) => r.height);
  // Tokens on one line share a baseline; height is the tallest token.
  // y stays the baseline origin the viewer converts from.
  const y = rects[0].y;
  const height = Math.max(...heights);
  if (!(x1 > x0) || !(height > 0)) return undefined;
  return { x: x0, y, width: x1 - x0, height };
}

// Whole-line box (row evidence, refusal evidence quoting a full line).
export function lineRect(line: PageLine): EvidenceRect | undefined {
  return unionRects(line.tokens.map(tokenRect));
}

// Box for the char range [charStart, charStart + charLength) inside
// line.text (tokens joined with single spaces). expectedText must match the
// sliced range after whitespace collapsing — a mismatch means the offsets
// drifted (e.g. odd whitespace inside tokens) and we return undefined so the
// caller falls back to text search rather than drawing a wrong box.
export function locateRect(
  line: PageLine,
  charStart: number,
  charLength: number,
  expectedText: string,
): EvidenceRect | undefined {
  if (!Number.isInteger(charStart) || charStart < 0 || charLength <= 0) {
    return undefined;
  }
  const sliced = line.text.slice(charStart, charStart + charLength);
  if (collapseWhitespace(sliced) !== collapseWhitespace(expectedText)) {
    return undefined;
  }
  const end = charStart + charLength;
  let offset = 0;
  const hits: EvidenceRect[] = [];
  line.tokens.forEach((token, index) => {
    const tokenEnd = offset + token.str.length;
    const isLast = index === line.tokens.length - 1;
    // Join separator: single space between tokens (see groupIntoLines).
    const spanEnd = isLast ? tokenEnd : tokenEnd + 1;
    if (offset < end && spanEnd > charStart) {
      hits.push(tokenRect(token));
    }
    offset = spanEnd;
  });
  return unionRects(hits);
}
