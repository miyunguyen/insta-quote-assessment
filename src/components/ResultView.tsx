import type {
  DocumentFields,
  ExtractionResult,
  FieldValue,
  Issue,
  LineItem,
  Refusal,
  ResultPage,
} from "@/server/extract/types";
import { EvidenceButton } from "./EvidenceButton";

type EvidencePlumbing = {
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

function SectionHeader({ title, count }: { title: string; count: number }) {
  return (
    <div className="mb-3 flex items-baseline gap-2">
      <h3 className="text-base font-semibold text-neutral-900">{title}</h3>
      <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600">
        {count}
      </span>
    </div>
  );
}

function ItemsTable({
  items,
  pdfUrl,
  pageCount,
}: { items: LineItem[] } & EvidencePlumbing) {
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
} & EvidencePlumbing) {
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
function PageBlock({
  page,
  pdfUrl,
  pageCount,
}: {
  page: ResultPage;
} & EvidencePlumbing) {
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

function RefusalsList({
  refusals,
  pdfUrl,
  pageCount,
}: {
  refusals: Refusal[];
} & EvidencePlumbing) {
  if (refusals.length === 0) {
    return (
      <div className="mb-8 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-[15px] text-emerald-900">
        Nothing was refused — every page and field was readable.
      </div>
    );
  }
  return (
    <section className="mb-8">
      <SectionHeader title="Refused extractions" count={refusals.length} />
      <p className="mb-3 text-[15px] text-neutral-600">
        These are deliberate. We would rather leave a number out than guess it.
      </p>
      <ul className="space-y-3">
        {refusals.map((refusal, index) => (
          <li
            key={index}
            className="rounded-lg border border-amber-200 bg-amber-50 p-4"
          >
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded border border-amber-300 bg-amber-100 px-1.5 py-0.5 font-mono text-amber-900">
                {refusal.code}
              </span>
              <span className="text-amber-800">
                page {refusal.scope.page}
                {refusal.scope.section ? ` · ${refusal.scope.section}` : ""}
                {refusal.scope.field ? ` · ${refusal.scope.field}` : ""}
              </span>
            </div>
            <p className="mt-2 text-[15px] leading-relaxed text-neutral-900">
              {refusal.plainLanguage}
            </p>
            {refusal.evidence && (
              <div className="mt-2">
                <EvidenceButton
                  page={refusal.evidence.page}
                  sourceText={refusal.evidence.sourceText}
                  rect={refusal.evidence.rect}
                  pdfUrl={pdfUrl}
                  pageCount={pageCount}
                  label="Refusal evidence"
                />
              </div>
            )}
            <details className="mt-2">
              <summary className="cursor-pointer text-xs text-amber-800 hover:text-amber-900">
                Technical detail
              </summary>
              <p className="mt-1 font-mono text-xs text-neutral-600">
                {refusal.technicalDetail}
              </p>
            </details>
          </li>
        ))}
      </ul>
    </section>
  );
}

function IssuesList({
  issues,
  pdfUrl,
  pageCount,
}: {
  issues: Issue[];
} & EvidencePlumbing) {
  if (issues.length === 0) return null;
  return (
    <section className="mb-8">
      <SectionHeader
        title="Conflicts & calculated checks"
        count={issues.length}
      />
      <ul className="space-y-3">
        {issues.map((issue, index) => (
          <li
            key={index}
            className="rounded-lg border border-violet-200 bg-violet-50 p-4"
          >
            <span className="rounded border border-violet-300 bg-violet-100 px-1.5 py-0.5 font-mono text-xs text-violet-900">
              {issue.code}
            </span>
            <p className="mt-2 text-[15px] leading-relaxed text-neutral-900">
              {issue.plainLanguage}
            </p>
            {issue.code === "contradiction" && (
              <ul className="mt-3 space-y-2 border-t border-violet-200 pt-3">
                {issue.claims.map((claim, claimIndex) => (
                  <li key={claimIndex} className="text-[15px]">
                    <span className="text-violet-900">{claim.label}:</span>{" "}
                    <span className="font-mono text-neutral-900">
                      {claim.value}
                    </span>
                    <div className="mt-1">
                      <EvidenceButton
                        page={claim.evidence.page}
                        sourceText={claim.evidence.sourceText}
                        rect={claim.evidence.rect}
                        pdfUrl={pdfUrl}
                        pageCount={pageCount}
                        label={claim.label}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {issue.code === "arithmetic_mismatch" && (
              <div className="mt-3 space-y-2 border-t border-violet-200 pt-3 text-[15px]">
                <div>
                  <span className="text-violet-900">Stated in document:</span>{" "}
                  {issue.stated.map((field, fieldIndex) => (
                    <span key={fieldIndex} className="ml-1">
                      <span className="font-mono text-neutral-900">
                        {field.value}
                      </span>{" "}
                      <EvidenceButton
                        page={field.evidence.page}
                        sourceText={field.evidence.sourceText}
                        rect={field.evidence.rect}
                        pdfUrl={pdfUrl}
                        pageCount={pageCount}
                        label="Stated value"
                      />
                    </span>
                  ))}
                </div>
                <div>
                  <span className="text-violet-900">
                    Calculated as a check:
                  </span>{" "}
                  <span className="font-mono text-neutral-900">
                    {issue.derived.value}
                  </span>
                  <span className="ml-1 text-xs text-violet-800">
                    ({issue.derived.derivation})
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {issue.derived.operands.map((operand, operandIndex) => (
                    <EvidenceButton
                      key={operandIndex}
                      page={operand.evidence.page}
                      sourceText={operand.evidence.sourceText}
                      rect={operand.evidence.rect}
                      pdfUrl={pdfUrl}
                      pageCount={pageCount}
                      label="Operand value"
                    />
                  ))}
                </div>
              </div>
            )}
            {issue.code === "derived_value" && (
              <div className="mt-3 space-y-2 border-t border-violet-200 pt-3 text-[15px]">
                <div>
                  <span className="text-violet-900">
                    Calculated (not stated):
                  </span>{" "}
                  <span className="font-mono text-neutral-900">
                    {issue.derived.value}
                  </span>
                  <span className="ml-1 text-xs text-violet-800">
                    ({issue.derived.derivation})
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {issue.derived.operands.map((operand, operandIndex) => (
                    <EvidenceButton
                      key={operandIndex}
                      page={operand.evidence.page}
                      sourceText={operand.evidence.sourceText}
                      rect={operand.evidence.rect}
                      pdfUrl={pdfUrl}
                      pageCount={pageCount}
                      label="Operand value"
                    />
                  ))}
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

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

      <RefusalsList
        refusals={refusals}
        pdfUrl={pdfUrl}
        pageCount={pageCount}
      />
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
