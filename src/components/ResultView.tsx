import type { ExtractionResult, LineItem } from "@/server/extract/types";
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

function ItemsBySection({
  items,
  pdfUrl,
  pageCount,
}: { items: LineItem[] } & EvidencePlumbing) {
  const sections = new Map<string, LineItem[]>();
  for (const item of items) {
    const list = sections.get(item.section) ?? [];
    list.push(item);
    sections.set(item.section, list);
  }

  return (
    <div className="space-y-8">
      {[...sections.entries()].map(([section, sectionItems]) => (
        <section key={section}>
          <SectionHeader title={section} count={sectionItems.length} />
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
                {sectionItems.map((item, index) => (
                  <tr
                    key={`${section}-${index}`}
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
        </section>
      ))}
    </div>
  );
}

function DocumentMeta({
  document,
  pdfUrl,
  pageCount,
}: {
  document: ExtractionResult["document"];
} & EvidencePlumbing) {
  const entries = Object.entries(document.fields).filter(
    (entry): entry is [string, NonNullable<(typeof entry)[1]>] =>
      entry[1] !== undefined,
  );
  if (entries.length === 0) return null;

  return (
    <section className="mb-8">
      <SectionHeader title="Document details" count={entries.length} />
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {entries.map(([name, field]) => {
          const pretty = name.replace(/([A-Z])/g, " $1");
          return (
            <div
              key={name}
              className="rounded-lg border border-neutral-200 bg-white p-3"
            >
              <dt className="text-xs uppercase tracking-wide text-neutral-500">
                {pretty}
              </dt>
              <dd className="mt-1 font-mono text-[15px] text-neutral-900">
                {field.value}
              </dd>
              <dd className="mt-1.5">
                <EvidenceButton
                  page={field.evidence.page}
                  sourceText={field.evidence.sourceText}
                  rect={field.evidence.rect}
                  pdfUrl={pdfUrl}
                  pageCount={pageCount}
                  label={pretty}
                />
              </dd>
            </div>
          );
        })}
      </dl>
    </section>
  );
}

function RefusalsList({
  refusals,
  pdfUrl,
  pageCount,
}: {
  refusals: ExtractionResult["refusals"];
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
  issues: ExtractionResult["issues"];
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
        <span>{result.items.length} line items</span>
        {result.refusals.length > 0 && (
          <span className="rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 text-xs text-amber-900">
            {result.refusals.length} refusal
            {result.refusals.length === 1 ? "" : "s"}
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
        refusals={result.refusals}
        pdfUrl={pdfUrl}
        pageCount={pageCount}
      />
      <IssuesList
        issues={result.issues}
        pdfUrl={pdfUrl}
        pageCount={pageCount}
      />
      <DocumentMeta
        document={result.document}
        pdfUrl={pdfUrl}
        pageCount={pageCount}
      />
      {result.items.length > 0 ? (
        <ItemsBySection
          items={result.items}
          pdfUrl={pdfUrl}
          pageCount={pageCount}
        />
      ) : (
        <p className="text-[15px] text-neutral-500">
          No line items were extracted.
        </p>
      )}
    </div>
  );
}
