import type {
  CellValue,
  DocumentFields,
  FieldValue,
  LineItem,
  ResultPage,
} from "@/server/extract/types";
import { EvidenceButton } from "./EvidenceButton";

// One page's block: its heading + field lines, immediately followed by its
// own line items. Each part declares only the viewer props it needs.

type ViewerProps = {
  pdfUrl: string | null;
  pageCount: number;
};

// Cells are plain text with the document's own headings (or generic Column
// N when the headings don't line up with the data). No field semantics.
export function ItemsTable({
  items,
  labels,
  headerText,
  pdfUrl,
  pageCount,
}: {
  items: LineItem[];
  labels: string[] | null;
  headerText: string | null;
} & ViewerProps) {
  const columnCount = Math.max(0, ...items.map((item) => item.cells.length));
  const headings = Array.from(
    { length: columnCount },
    (_, i) => labels?.[i] || `Column ${i + 1}`,
  );
  return (
    <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
      {labels === null && headerText && (
        <p className="border-b border-neutral-200 bg-neutral-50 px-4 py-2 text-[13px] text-neutral-600">
          Columns as labeled in the document:{" "}
          <span className="font-mono">{headerText}</span>
        </p>
      )}
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-neutral-200 bg-neutral-50 text-xs uppercase tracking-wide text-neutral-600">
            {headings.map((heading) => (
              <th key={heading} className="px-4 py-2.5 font-medium">
                {heading}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((item, index) => (
            <tr
              key={index}
              className="border-b border-neutral-100 last:border-0"
            >
              {item.cells.map((cell, cellIndex) => (
                <Cell
                  key={cellIndex}
                  cell={cell}
                  heading={headings[cellIndex] ?? `Column ${cellIndex + 1}`}
                  pdfUrl={pdfUrl}
                  pageCount={pageCount}
                />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Cell({
  cell,
  heading,
  pdfUrl,
  pageCount,
}: {
  cell: CellValue;
  heading: string;
} & ViewerProps) {
  return (
    <td className="max-w-xs px-4 py-3 align-top">
      <div className="font-mono text-[15px] text-neutral-900">{cell.value}</div>
      <div className="mt-1.5">
        <EvidenceButton
          page={cell.evidence.page}
          sourceText={cell.evidence.sourceText}
          rect={cell.evidence.rect}
          pdfUrl={pdfUrl}
          pageCount={pageCount}
          label={heading}
        />
      </div>
    </td>
  );
}

const PAGE_FIELD_LABELS: Array<{ key: keyof DocumentFields; label: string }> = [
  { key: "documentNumber", label: "Document No" },
  { key: "date", label: "Date" },
  { key: "deliveredTo", label: "Delivered to" },
  { key: "orderedBy", label: "Ordered by" },
];

function PageDocument({
  page,
  pdfUrl,
  pageCount,
}: {
  page: ResultPage;
} & ViewerProps) {
  const lines: Array<{ label: string; field: FieldValue }> = [];
  for (const { key, label } of PAGE_FIELD_LABELS) {
    const field = page.fields[key];
    if (field) lines.push({ label, field });
  }
  if (page.total) lines.push({ label: "Total", field: page.total });
  if (!page.sectionTitle && lines.length === 0) return null;

  return (
    <>
      <h3 className="mb-2 flex items-center gap-2 text-lg font-semibold text-neutral-900">
        {page.sectionTitle?.value ?? `Page ${page.pageNumber}`}
        {page.sectionTitle && (
          <EvidenceButton
            page={page.sectionTitle.evidence.page}
            sourceText={page.sectionTitle.evidence.sourceText}
            rect={page.sectionTitle.evidence.rect}
            pdfUrl={pdfUrl}
            pageCount={pageCount}
            label="Section title"
          />
        )}
      </h3>
      {lines.map(({ label, field }) => (
        <div
          key={label}
          className="flex items-center gap-2 py-0.5 text-[15px] text-neutral-900"
        >
          <span>
            {label}: <span className="font-mono">{field.value}</span>
          </span>
          <EvidenceButton
            page={field.evidence.page}
            sourceText={field.evidence.sourceText}
            rect={field.evidence.rect}
            pdfUrl={pdfUrl}
            pageCount={pageCount}
            label={label}
          />
        </div>
      ))}
    </>
  );
}

function pageHasDocument(page: ResultPage): boolean {
  return (
    page.sectionTitle !== undefined ||
    page.total !== undefined ||
    Object.values(page.fields).some((field) => field !== undefined)
  );
}

// One page's block: its heading + field lines, immediately followed by its
// own line items — then the next page. Applies to every document type, so a
// multi-page docket reads page by page instead of headings-first.
export function PageBlock({
  page,
  pdfUrl,
  pageCount,
}: {
  page: ResultPage;
} & ViewerProps) {
  if (!pageHasDocument(page) && page.items.length === 0) return null;
  return (
    <section className="mb-8">
      <PageDocument page={page} pdfUrl={pdfUrl} pageCount={pageCount} />
      {page.items.length > 0 && (
        <div className={pageHasDocument(page) ? "mt-4" : ""}>
          <ItemsTable
            items={page.items}
            labels={page.tableLabels ?? null}
            headerText={page.tableHeaderText ?? null}
            pdfUrl={pdfUrl}
            pageCount={pageCount}
          />
        </div>
      )}
    </section>
  );
}
