import type {
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

const FIELD_LABELS: Array<{
  key: keyof Pick<
    LineItem,
    "quantity" | "unit" | "weight" | "unitPrice" | "lineTotal"
  >;
  label: string;
}> = [
  { key: "quantity", label: "Quantity" },
  { key: "unit", label: "Unit" },
  { key: "weight", label: "Weight" },
  { key: "unitPrice", label: "Unit price" },
  { key: "lineTotal", label: "Line total" },
];

export function ItemsTable({
  items,
  pdfUrl,
  pageCount,
}: { items: LineItem[] } & ViewerProps) {
  return (
    <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-neutral-200 bg-neutral-50 text-xs uppercase tracking-wide text-neutral-600">
            <th className="px-4 py-2.5 font-medium">Description</th>
            {FIELD_LABELS.map(({ key, label }) => (
              <th key={key} className="px-4 py-2.5 font-medium">
                {label}
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
              <td className="max-w-xs px-4 py-3">
                <div className="text-[15px] text-neutral-900">
                  {item.description.value}
                </div>
                <div className="mt-1.5">
                  <EvidenceButton
                    page={item.description.evidence.page}
                    sourceText={item.description.evidence.sourceText}
                    rect={item.description.evidence.rect}
                    pdfUrl={pdfUrl}
                    pageCount={pageCount}
                    label="Description"
                  />
                </div>
              </td>
              {FIELD_LABELS.map(({ key, label }) => {
                const field = item[key];
                if (!field) {
                  return (
                    <td
                      key={key}
                      className="px-4 py-3 align-top text-sm italic text-neutral-400"
                    >
                      not stated
                    </td>
                  );
                }
                return (
                  <td key={key} className="px-4 py-3 align-top">
                    <div className="font-mono text-[15px] text-neutral-900">
                      {field.value}
                    </div>
                    <div className="mt-1.5">
                      <EvidenceButton
                        page={field.evidence.page}
                        sourceText={field.evidence.sourceText}
                        rect={field.evidence.rect}
                        pdfUrl={pdfUrl}
                        pageCount={pageCount}
                        label={label}
                      />
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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
            pdfUrl={pdfUrl}
            pageCount={pageCount}
          />
        </div>
      )}
    </section>
  );
}
