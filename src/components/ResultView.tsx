import type { ExtractionResult, LineItem } from "@/server/extract/types";
import { EvidenceChip } from "./EvidenceChip";

const FIELD_LABELS: Array<{
  key: keyof Pick<
    LineItem,
    "quantity" | "unit" | "weight" | "unitPrice" | "lineTotal"
  >;
  label: string;
}> = [
  { key: "quantity", label: "Qty" },
  { key: "unit", label: "Unit" },
  { key: "weight", label: "Weight" },
  { key: "unitPrice", label: "Unit price" },
  { key: "lineTotal", label: "Line total" },
];

function SectionHeader({ title, count }: { title: string; count: number }) {
  return (
    <div className="mb-3 flex items-baseline gap-2">
      <h3 className="text-sm font-semibold text-neutral-200">{title}</h3>
      <span className="rounded-full bg-neutral-800 px-2 py-0.5 text-xs text-neutral-400">
        {count}
      </span>
    </div>
  );
}

function ItemsBySection({ items }: { items: LineItem[] }) {
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
          <div className="overflow-x-auto rounded-lg border border-neutral-800">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-neutral-800 bg-neutral-900/60 text-xs uppercase tracking-wide text-neutral-500">
                  <th className="px-3 py-2 font-medium">Description</th>
                  {FIELD_LABELS.map(({ key, label }) => (
                    <th key={key} className="px-3 py-2 font-medium">
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sectionItems.map((item, index) => (
                  <tr
                    key={`${section}-${index}`}
                    className="border-b border-neutral-900 last:border-0"
                  >
                    <td className="max-w-xs px-3 py-2">
                      <div className="text-neutral-200">
                        {item.description.value}
                      </div>
                      <div className="mt-1">
                        <EvidenceChip {...item.description.evidence} />
                      </div>
                      <div className="mt-1 font-mono text-[10px] text-neutral-600">
                        {item.rowSourceText}
                      </div>
                    </td>
                    {FIELD_LABELS.map(({ key }) => {
                      const field = item[key];
                      if (!field) {
                        return (
                          <td
                            key={key}
                            className="px-3 py-2 align-top text-xs italic text-neutral-600"
                          >
                            not stated
                          </td>
                        );
                      }
                      return (
                        <td key={key} className="px-3 py-2 align-top">
                          <div className="font-mono text-neutral-100">
                            {field.value}
                          </div>
                          <div className="mt-1">
                            <EvidenceChip {...field.evidence} />
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
}: {
  document: ExtractionResult["document"];
}) {
  const entries = Object.entries(document.fields).filter(
    (entry): entry is [string, NonNullable<(typeof entry)[1]>] =>
      entry[1] !== undefined,
  );
  if (entries.length === 0) return null;

  return (
    <section className="mb-8">
      <SectionHeader title="Document details" count={entries.length} />
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {entries.map(([name, field]) => (
          <div
            key={name}
            className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-3"
          >
            <dt className="text-xs uppercase tracking-wide text-neutral-500">
              {name.replace(/([A-Z])/g, " $1")}
            </dt>
            <dd className="mt-1 font-mono text-sm text-neutral-100">
              {field.value}
            </dd>
            <dd className="mt-1.5">
              <EvidenceChip {...field.evidence} />
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function RefusalsList({ refusals }: { refusals: ExtractionResult["refusals"] }) {
  if (refusals.length === 0) {
    return (
      <div className="mb-8 rounded-lg border border-emerald-900 bg-emerald-950/30 p-4 text-sm text-emerald-300">
        Nothing was refused — every page and field was readable.
      </div>
    );
  }
  return (
    <section className="mb-8">
      <SectionHeader
        title="Refused extractions"
        count={refusals.length}
      />
      <p className="mb-3 text-sm text-neutral-400">
        These are deliberate. We would rather leave a number out than guess it.
      </p>
      <ul className="space-y-3">
        {refusals.map((refusal, index) => (
          <li
            key={index}
            className="rounded-lg border border-amber-800 bg-amber-950/30 p-4"
          >
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded bg-amber-900/60 px-1.5 py-0.5 font-mono text-amber-300">
                {refusal.code}
              </span>
              <span className="text-amber-500">
                page {refusal.scope.page}
                {refusal.scope.section ? ` · ${refusal.scope.section}` : ""}
                {refusal.scope.field ? ` · ${refusal.scope.field}` : ""}
              </span>
            </div>
            <p className="mt-2 text-sm leading-relaxed text-amber-100">
              {refusal.plainLanguage}
            </p>
            {refusal.evidence && (
              <div className="mt-2">
                <EvidenceChip {...refusal.evidence} />
              </div>
            )}
            <details className="mt-2">
              <summary className="cursor-pointer text-xs text-amber-600 hover:text-amber-400">
                Technical detail
              </summary>
              <p className="mt-1 font-mono text-[11px] text-amber-700">
                {refusal.technicalDetail}
              </p>
            </details>
          </li>
        ))}
      </ul>
    </section>
  );
}

function IssuesList({ issues }: { issues: ExtractionResult["issues"] }) {
  if (issues.length === 0) return null;
  return (
    <section className="mb-8">
      <SectionHeader title="Conflicts &amp; calculated checks" count={issues.length} />
      <ul className="space-y-3">
        {issues.map((issue, index) => (
          <li
            key={index}
            className="rounded-lg border border-violet-800 bg-violet-950/30 p-4"
          >
            <span className="rounded bg-violet-900/60 px-1.5 py-0.5 font-mono text-xs text-violet-300">
              {issue.code}
            </span>
            <p className="mt-2 text-sm leading-relaxed text-violet-100">
              {issue.plainLanguage}
            </p>
            {issue.code === "contradiction" && (
              <ul className="mt-3 space-y-2 border-t border-violet-900 pt-3">
                {issue.claims.map((claim, claimIndex) => (
                  <li key={claimIndex} className="text-sm">
                    <span className="text-violet-400">{claim.label}:</span>{" "}
                    <span className="font-mono text-violet-100">
                      {claim.value}
                    </span>
                    <div className="mt-1">
                      <EvidenceChip {...claim.evidence} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {issue.code === "arithmetic_mismatch" && (
              <div className="mt-3 space-y-2 border-t border-violet-900 pt-3 text-sm">
                <div>
                  <span className="text-violet-400">Stated in document:</span>{" "}
                  {issue.stated.map((field, fieldIndex) => (
                    <span key={fieldIndex} className="ml-1">
                      <span className="font-mono text-violet-100">
                        {field.value}
                      </span>{" "}
                      <EvidenceChip {...field.evidence} />
                    </span>
                  ))}
                </div>
                <div>
                  <span className="text-violet-400">Calculated as a check:</span>{" "}
                  <span className="font-mono text-violet-100">
                    {issue.derived.value}
                  </span>
                  <span className="ml-1 text-xs text-violet-500">
                    ({issue.derived.derivation})
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {issue.derived.operands.map((operand, operandIndex) => (
                    <EvidenceChip key={operandIndex} {...operand.evidence} />
                  ))}
                </div>
              </div>
            )}
            {issue.code === "derived_value" && (
              <div className="mt-3 space-y-2 border-t border-violet-900 pt-3 text-sm">
                <div>
                  <span className="text-violet-400">Calculated (not stated):</span>{" "}
                  <span className="font-mono text-violet-100">
                    {issue.derived.value}
                  </span>
                  <span className="ml-1 text-xs text-violet-500">
                    ({issue.derived.derivation})
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {issue.derived.operands.map((operand, operandIndex) => (
                    <EvidenceChip key={operandIndex} {...operand.evidence} />
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

export function ResultView({ result }: { result: ExtractionResult }) {
  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center gap-3 text-sm text-neutral-400">
        <span className="font-mono text-neutral-200">
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
          <span className="rounded-full border border-amber-700 bg-amber-950/60 px-2 py-0.5 text-xs text-amber-300">
            {result.refusals.length} refusal
            {result.refusals.length === 1 ? "" : "s"}
          </span>
        )}
        {result.issues.length > 0 && (
          <span className="rounded-full border border-violet-700 bg-violet-950/60 px-2 py-0.5 text-xs text-violet-300">
            {result.issues.length} issue
            {result.issues.length === 1 ? "" : "s"}
          </span>
        )}
      </div>

      <RefusalsList refusals={result.refusals} />
      <IssuesList issues={result.issues} />
      <DocumentMeta document={result.document} />
      {result.items.length > 0 ? (
        <ItemsBySection items={result.items} />
      ) : (
        <p className="text-sm text-neutral-500">
          No line items were extracted.
        </p>
      )}
    </div>
  );
}
