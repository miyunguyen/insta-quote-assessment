"use client";

import { useEffect, useRef, useState } from "react";
import type { EvidenceRect } from "@/server/extract/types";

// ---------------------------------------------------------------------------
// Minimal structural types for the pdf.js API surface we use. Kept local so
// the component does not depend on pdfjs-dist's exported type names.
// ---------------------------------------------------------------------------
type PdfTextItem = {
  str: string;
  transform: number[];
  width: number;
  height: number;
};

type PdfViewport = {
  width: number;
  height: number;
  scale: number;
  convertToViewportPoint: (x: number, y: number) => [number, number];
};

type PdfPage = {
  getViewport: (options: { scale: number }) => PdfViewport;
  render: (options: {
    canvasContext: CanvasRenderingContext2D;
    viewport: PdfViewport;
  }) => { promise: Promise<void>; cancel: () => void };
  getTextContent: () => Promise<{ items: unknown[] }>;
};

type PdfDocument = {
  numPages: number;
  getPage: (pageNumber: number) => Promise<PdfPage>;
  destroy: () => Promise<void>;
};

type PdfJsModule = {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument: (options: { url: string }) => {
    promise: Promise<unknown>;
    destroy: () => Promise<void>;
  };
};

type HighlightRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

// Lazily loaded pdf.js module (client only, split into its own chunk).
let pdfjsPromise: Promise<PdfJsModule> | null = null;
function loadPdfjs(): Promise<PdfJsModule> {
  if (!pdfjsPromise) {
    pdfjsPromise = import("pdfjs-dist").then((module) => {
      const pdfjs = module as unknown as PdfJsModule;
      pdfjs.GlobalWorkerOptions.workerSrc = new URL(
        "pdfjs-dist/build/pdf.worker.min.mjs",
        import.meta.url,
      ).toString();
      return pdfjs;
    });
  }
  return pdfjsPromise;
}

// Single-entry document cache: destroyed whenever a different PDF is opened.
let cachedUrl: string | null = null;
let cachedDoc: Promise<PdfDocument> | null = null;
async function getDocument(
  pdfjs: PdfJsModule,
  url: string,
): Promise<PdfDocument> {
  if (cachedDoc && cachedUrl === url) return cachedDoc;
  if (cachedDoc) {
    const old = cachedDoc;
    cachedDoc = null;
    cachedUrl = null;
    old.then((doc) => doc.destroy()).catch(() => {});
  }
  const task = pdfjs.getDocument({ url });
  cachedDoc = task.promise.then((doc) => doc as PdfDocument);
  cachedUrl = url;
  return cachedDoc;
}

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function toTextItem(raw: unknown): PdfTextItem | null {
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

// Locate the evidence text among the page's text items and return highlight
// boxes in viewport (CSS pixel) coordinates. width/height come from pdf.js in
// PDF user-space units, so they are scaled by the viewport scale; the origin
// is converted with the viewport itself (handles the y-axis flip).
function findHighlightRects(
  viewport: PdfViewport,
  items: PdfTextItem[],
  sourceText: string,
): HighlightRect[] {
  const needle = normalize(sourceText);
  if (!needle) return [];

  const joined: string[] = [];
  const spans: Array<{ start: number; end: number; index: number }> = [];
  let cursor = 0;
  items.forEach((item, index) => {
    const text = normalize(item.str);
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
      (span) => normalize(items[span.index].str) === needle,
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
    const height = (item.height > 0 ? item.height : fontSize) * viewport.scale;
    const width = Math.max(item.width * viewport.scale, 4);
    const pad = 2;
    rects.push({
      left: baseX - pad,
      top: baseY - height - pad,
      width: width + pad * 2,
      height: height + pad * 2,
    });
  }
  // Sanity filter: never draw a box that is wildly off the rendered page
  // (protects against any geometry assumption being wrong for odd PDFs).
  return filterRects(viewport, rects);
}

// Sanity filter shared by both highlight paths.
function filterRects(
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

type RenderState =
  | { status: "loading" }
  | { status: "failed"; message: string }
  | {
      status: "ready";
      width: number;
      height: number;
      rects: HighlightRect[];
      matched: boolean;
    };

function PagePreview({
  pdfUrl,
  viewPage,
  evidencePage,
  sourceText,
  rect,
  paneWidth,
  paneHeight,
}: {
  pdfUrl: string;
  viewPage: number;
  evidencePage: number;
  sourceText: string;
  rect: EvidenceRect | undefined;
  paneWidth: number | null;
  paneHeight: number | null;
}) {
  const [render, setRender] = useState<RenderState>({ status: "loading" });
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (paneWidth === null || paneHeight === null) return;
    let cancelled = false;
    let renderTask: { promise: Promise<void>; cancel: () => void } | null =
      null;

    loadPdfjs()
      .then(async (pdfjs) => {
        const doc = await getDocument(pdfjs, pdfUrl);
        if (cancelled) return;
        const page = await doc.getPage(viewPage);
        if (cancelled) return;
        // Fit the whole page into the measured pane so no scrolling is
        // needed; render at up to 2x for crispness on dense displays.
        const points = page.getViewport({ scale: 1 });
        const fit = Math.min(
          Math.max(50, paneWidth - 24) / points.width,
          Math.max(50, paneHeight - 24) / points.height,
        );
        const cssWidth = Math.floor(points.width * fit);
        const cssHeight = Math.floor(points.height * fit);
        const density = Math.min(window.devicePixelRatio || 1, 2);
        const printScale = Math.min(fit * density, 3);
        const print = page.getViewport({ scale: printScale });
        const layout = page.getViewport({ scale: fit });
        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.width = Math.max(1, Math.floor(print.width));
        canvas.height = Math.max(1, Math.floor(print.height));
        const context = canvas.getContext("2d");
        if (!context) throw new Error("2D canvas context unavailable");
        renderTask = page.render({ canvasContext: context, viewport: print });
        await renderTask.promise;
        if (cancelled) return;

        let rects: HighlightRect[] = [];
        let matched = false;
        if (viewPage === evidencePage) {
          if (rect) {
            // Extraction-time position: draw exactly where the value was
            // read from — no text re-search, so repeated text can't
            // misplace the box.
            const [baseX, baseY] = layout.convertToViewportPoint(
              rect.x,
              rect.y,
            );
            const height = rect.height * layout.scale;
            const width = Math.max(rect.width * layout.scale, 4);
            const pad = 2;
            rects = filterRects(layout, [
              {
                left: baseX - pad,
                top: baseY - height - pad,
                width: width + pad * 2,
                height: height + pad * 2,
              },
            ]);
            matched = rects.length > 0;
          } else {
            const content = await page.getTextContent();
            if (cancelled) return;
            const items = content.items
              .map(toTextItem)
              .filter((item): item is PdfTextItem => item !== null);
            rects = findHighlightRects(layout, items, sourceText);
            matched = rects.length > 0;
          }
        }
        setRender({
          status: "ready",
          width: cssWidth,
          height: cssHeight,
          rects,
          matched,
        });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setRender({
          status: "failed",
          message:
            error instanceof Error ? error.message : "Unknown render error",
        });
      });

    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [pdfUrl, viewPage, evidencePage, sourceText, rect, paneWidth, paneHeight]);

  const onEvidencePage = viewPage === evidencePage;

  return (
    <div
      className="relative mx-auto"
      style={
        render.status === "ready"
          ? { width: render.width, height: render.height }
          : undefined
      }
    >
      <canvas
        ref={canvasRef}
        className="block bg-white shadow"
        style={
          render.status === "ready"
            ? { width: render.width, height: render.height }
            : undefined
        }
      />
      {render.status === "ready" &&
        onEvidencePage &&
        render.rects.map((rect, index) => (
          <div
            key={index}
            aria-hidden="true"
            className="pointer-events-none absolute rounded-sm border-2 border-amber-500 bg-amber-400/25"
            style={{
              left: rect.left,
              top: rect.top,
              width: rect.width,
              height: rect.height,
            }}
          />
        ))}
    </div>
  );
}

export function EvidenceModal({
  pdfUrl,
  pageCount,
  evidencePage,
  sourceText,
  rect,
  label,
  onClose,
}: {
  pdfUrl: string;
  pageCount: number;
  evidencePage: number;
  sourceText: string;
  rect: EvidenceRect | undefined;
  label: string;
  onClose: () => void;
}) {
  const [viewPage, setViewPage] = useState(evidencePage);
  const [paneSize, setPaneSize] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const paneRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    const pane = paneRef.current;
    if (!pane) return;
    const observer = new ResizeObserver((entries) => {
      const box = entries[0].contentRect;
      setPaneSize({ width: box.width, height: box.height });
    });
    observer.observe(pane);
    return () => observer.disconnect();
  }, []);

  const onEvidencePage = viewPage === evidencePage;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Evidence for ${label} on page ${evidencePage}`}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="absolute inset-0 bg-neutral-900/60" aria-hidden="true" />
      <div className="relative flex max-h-[calc(100vh-3rem)] w-[min(1500px,97vw)] flex-col overflow-hidden rounded-xl bg-white shadow-2xl md:h-[min(980px,calc(100vh-3rem))]">
        <div className="flex items-center justify-between gap-4 border-b border-neutral-200 px-5 py-3">
          <div>
            <p className="text-base font-semibold text-neutral-900">{label}</p>
            <p className="text-sm text-neutral-500">
              Evidence is on page {evidencePage}
              {!onEvidencePage && ` — currently viewing page ${viewPage}`}
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close evidence viewer"
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-700 hover:border-neutral-500 hover:text-neutral-900"
          >
            Close
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto md:flex-row md:overflow-hidden">
          <div className="relative h-[62vh] shrink-0 bg-neutral-100 md:h-auto md:min-h-0 md:min-w-0 md:flex-1">
            <div ref={paneRef} className="absolute inset-0">
              <div className="flex h-full items-center justify-center p-3">
                <PagePreview
                  key={`${pdfUrl}::${viewPage}`}
                  pdfUrl={pdfUrl}
                  viewPage={viewPage}
                  evidencePage={evidencePage}
                  sourceText={sourceText}
                  rect={rect}
                  paneWidth={paneSize?.width ?? null}
                  paneHeight={paneSize?.height ?? null}
                />
              </div>
            </div>
            <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-3 rounded-full border border-neutral-200 bg-white/95 px-2 py-1 shadow">
              <button
                type="button"
                disabled={viewPage <= 1}
                onClick={() => setViewPage((page) => Math.max(1, page - 1))}
                className="rounded-full px-3 py-1.5 text-sm text-neutral-700 disabled:opacity-40 hover:bg-neutral-100"
              >
                ‹ Prev
              </button>
              <span className="text-sm text-neutral-600">
                Page {viewPage} of {pageCount}
              </span>
              <button
                type="button"
                disabled={viewPage >= pageCount}
                onClick={() =>
                  setViewPage((page) => Math.min(pageCount, page + 1))
                }
                className="rounded-full px-3 py-1.5 text-sm text-neutral-700 disabled:opacity-40 hover:bg-neutral-100"
              >
                Next ›
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
