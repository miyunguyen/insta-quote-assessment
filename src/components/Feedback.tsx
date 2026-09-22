import type { Issue, Refusal } from "@/server/extract/types";
import { EvidenceButton } from "./EvidenceButton";
import { ISSUE_LABELS, REFUSAL_LABELS } from "./labels";

// Feedback notices: deliberate refusals and flagged conflicts. Each part
// declares only the viewer props it needs.

type ViewerProps = {
  pdfUrl: string | null;
  pageCount: number;
};

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

export function RefusalsList({
  refusals,
  pdfUrl,
  pageCount,
}: {
  refusals: Refusal[];
} & ViewerProps) {
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
              <span className="rounded border border-amber-300 bg-amber-100 px-1.5 py-0.5 text-xs text-amber-900">
                {REFUSAL_LABELS[refusal.code]}
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

export function IssuesList({
  issues,
  pdfUrl,
  pageCount,
}: {
  issues: Issue[];
} & ViewerProps) {
  if (issues.length === 0) return null;
  return (
    <section className="mb-8">
      <SectionHeader title="Conflicts" count={issues.length} />
      <ul className="space-y-3">
        {issues.map((issue, index) => (
          <li
            key={index}
            className="rounded-lg border border-violet-200 bg-violet-50 p-4"
          >
            <span className="rounded border border-violet-300 bg-violet-100 px-1.5 py-0.5 text-xs text-violet-900">
              {ISSUE_LABELS[issue.code]}
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
                        buttonText={field.value}
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
                      buttonText={operand.value}
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
