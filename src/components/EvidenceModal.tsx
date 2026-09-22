"use client";

import { useEffect, useRef, useState } from "react";
import type { EvidenceRect } from "@/server/extract/types";
import { PagePreview } from "./PagePreview";

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
