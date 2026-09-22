import type { ExtractionResult } from "@/server/extract/types";
import { PageBlock } from "./DocumentPages";
import { IssuesList, RefusalsList } from "./Feedback";

// Composes the extraction result: summary header, feedback notices, then
// one block per page (heading + its own items). All parts live in
// DocumentPages / Feedback; this file only orchestrates them.

export function ResultView({
  result,
  pdfUrl,
}: {
  result: ExtractionResult;
  pdfUrl: string | null;
}) {
  const pageCount = result.document.pageCount;
  const items = result.pages.flatMap((page) => page.items);
  const refusals = result.pages.flatMap((page) => page.refusals);
  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center gap-3 text-[15px] text-neutral-600">
        <span className="font-mono text-neutral-900">
          {result.document.fileName}
        </span>
        <span>
          {result.document.pageCount} page
          {result.document.pageCount === 1 ? "" : "s"}
        </span>
        <span className="capitalize">
          {result.document.docType.replace(/_/g, " ")}
        </span>
        <span>{items.length} line items</span>
        {refusals.length > 0 && (
          <span className="rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 text-xs text-amber-900">
            {refusals.length} refusal
            {refusals.length === 1 ? "" : "s"}
          </span>
        )}
        {result.issues.length > 0 && (
          <span className="rounded-full border border-violet-300 bg-violet-100 px-2 py-0.5 text-xs text-violet-900">
            {result.issues.length} issue
            {result.issues.length === 1 ? "" : "s"}
          </span>
        )}
      </div>

      <RefusalsList refusals={refusals} pdfUrl={pdfUrl} pageCount={pageCount} />
      <IssuesList
        issues={result.issues}
        pdfUrl={pdfUrl}
        pageCount={pageCount}
      />
      {result.pages.map((page) => (
        <PageBlock
          key={page.pageNumber}
          page={page}
          pdfUrl={pdfUrl}
          pageCount={pageCount}
        />
      ))}
      {items.length === 0 && (
        <p className="text-[15px] text-neutral-500">
          No line items were extracted.
        </p>
      )}
    </div>
  );
}
