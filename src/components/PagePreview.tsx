"use client";

import { useEffect, useRef, useState } from "react";
import type { EvidenceRect } from "@/server/extract/types";
import { getDocument, loadPdfjs, type PdfTextItem } from "@/lib/pdfjs";
import {
  evidenceRectToBox,
  filterRects,
  findHighlightRects,
  toTextItem,
  type HighlightRect,
} from "@/lib/highlight";

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

export function PagePreview({
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
            rects = filterRects(layout, [evidenceRectToBox(layout, rect)]);
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
