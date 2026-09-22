"use client";

import { useState } from "react";
import type { EvidenceRect } from "@/server/extract/types";
import { EvidenceModal } from "./EvidenceModal";

function EyeIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-4 w-4"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.8}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"
      />
    </svg>
  );
}

export function EvidenceButton({
  page,
  sourceText,
  rect,
  pdfUrl,
  pageCount,
  label,
}: {
  page: number;
  sourceText: string;
  rect: EvidenceRect | undefined;
  pdfUrl: string | null;
  pageCount: number;
  label: string;
}) {
  const [open, setOpen] = useState(false);

  if (!pdfUrl) {
    return <span className="text-xs text-neutral-500">page {page}</span>;
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={`Show evidence`}
        aria-label={`Show evidence on page ${page} for ${label}: ${sourceText}`}
        className="inline-flex items-center gap-1 rounded-md border border-neutral-300 bg-white px-1.5 py-1 text-xs font-medium text-neutral-500 shadow-sm hover:border-neutral-500 hover:text-neutral-900"
      >
        <EyeIcon />
      </button>
      {open && (
        <EvidenceModal
          pdfUrl={pdfUrl}
          pageCount={pageCount}
          evidencePage={page}
          sourceText={sourceText}
          rect={rect}
          label={label}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
