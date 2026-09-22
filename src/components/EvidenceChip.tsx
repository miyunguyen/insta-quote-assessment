export function EvidenceChip({
  page,
  sourceText,
}: {
  page: number;
  sourceText: string;
}) {
  return (
    <span className="inline-flex max-w-full items-baseline gap-1.5 rounded border border-sky-800 bg-sky-950/50 px-1.5 py-0.5 font-mono text-[11px] text-sky-300">
      <span className="shrink-0 text-sky-500">p{page}</span>
      <span className="truncate" title={sourceText}>
        {sourceText}
      </span>
    </span>
  );
}
