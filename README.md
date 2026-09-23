# Take-Home Assessment: Full Stack Engineer

Upload a packing list or delivery docket (PDF) and get back structured data —
line items and document fields — where every number carries its exact source text,
and anything uncertain becomes an explicit refusal.

Two parts:

- **Part A — Extraction Service** (`POST /api/extract`): a deterministic PDF → JSON
  pipeline with page-level evidence and refusal codes.
- **Part B — Web UI** (`/`): uploads a file to Part A and displays the result,
  with refusals shown in plain language.

## My approach

1. Examine all samples and identify common output patterns.
2. Explore raw PDF extraction output using [unpdf](https://www.npmjs.com/package/unpdf).
3. Design the output data model.
4. Build the PDF extraction pipeline.
5. Define extraction, evidence, ambiguity, contradiction, and consistency rules.
6. Map validated candidates into the output model.
7. Produce the final result: extracted fields + refusals + issues (if any).

## The three questions from the brief

### 1. What was the hardest decision, and why that way?

**What is the scope of the expected output? Do I need to handle minor special cases?**

As I examined the sample documents, I noticed several document-specific cases that
could affect the extraction logic.

- `KBS-10255.pdf` is missing the `Line Total` column, while this column exists in
  the other samples. I decided to omit the field rather than treat the missing
  column itself as a refusal.

- `KBS-10262.pdf` contains two notes — a Summary Note and a Driver Note — with
  conflicting information about the number of pallets. Since note extraction is
  a relatively minor requirement and this case only appears in one sample, I
  avoided adding sample-specific logic that could overfit the provided documents.

- `KBS-10270.pdf` contains a mismatch between the stated Total and the calculated
  sum of the line totals. I preserve the Total exactly as stated because it has
  direct evidence, while reporting the discrepancy as an issue rather than
  silently replacing it with the calculated value.

From a software engineering perspective, I prefer clear and general extraction
rules, preserved traceability, and explicit handling of uncertainty over
sample-specific logic. If a value cannot be reliably supported by the source
document, I would rather refuse or flag it than return a potentially incorrect
value. This keeps the implementation predictable and avoids overfitting to the
provided samples.

### 2. Where I'm not confident

- The implementation is validated against the provided PDFs, not real customer
  documents. Tables are detected by their divider line; rows are plain cells
  split on `|` (or text tokens), and the table's width is the most common cell
  count with ties going to the heading count.

- A total line containing two different amounts is always refused rather than
  resolved. For example, `Total: $1,000 incl $150 GST` is refused.

- Some extraction rules are necessarily hard-coded to make processing the provided
  documents reliable. An arbitrary document with similar patterns could therefore
  pass the pipeline and produce unexpected output.

- Evidence highlighting was added while building the UI. The current
  implementation supports standard upright PDF.js user-space geometry. Rotated
  or heavily skewed pages are not covered; the sanity filter rejects invalid
  bounding boxes and falls back to the exact source quote without highlighting.

- The current tests are largely AI-assisted, with the test scenarios based on
  common cases I identified during development. Broader test coverage would
  benefit from more real-world documents and additional edge cases.

### 3. What I'd do with three more days

1. **Strengthen the test suite** with more targeted and synthetic edge cases for
   extraction, evidence, ambiguity, contradiction, and refusal behavior.

2. **Improve table detection beyond literal headers** using fuzzy and positional
   matching, and add an explicit `no_table_found` refusal.

3. **Add tRPC + shared contract types** to align with the team stack. Part A
   intentionally uses plain REST so it can be called without a TypeScript client.

4. **Improve the PDF evidence viewer**, potentially using an extended PDF viewer
   library for better interaction and more robust PDF highlight handling.

## How the brief's requirements are met

| # | Requirement | Where |
|---|---|---|
| 1 | Stack choice | TypeScript + Next.js match the team |
| 2 | Every number traceable | `evidence: { page, sourceText, rect }` on all values; `verifyTraceability` drops unverified values as refusals; traceability invariant test across all samples |
| 3 | Ambiguity surfaced, never quietly resolved | `contradiction` issues preserve all claims; `ambiguous_reference` refusals; conflicting-document-numbers test verifies that no winner is selected |
| 4 | AI-assisted, understood work | Built with AI coding agents, with the implementation and generated code reviewed |
| 5 | Refusal-rule tests | `tests/refusal-contract.test.ts` + `tests/rules.test.ts` |

## How to run

Requires Node 22.

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # 47 tests (Vitest)
npm run typecheck  # tsc --noEmit
npm run lint       # ESLint
npm run build      # production build
node scripts/smoke-api.mjs   # 13 live HTTP checks against `next start`
```

## API

`POST /api/extract` with multipart form field `file` (PDF, max 10 MB).
Success returns `200` with the extraction result (shape below). Failures
return `{ "error": { "code", "message" } }` with a specific, non-generic
message:

| Code | Status | Meaning |
|---|---|---|
| `missing_file` | 400 | No file (or empty file) under field `file` |
| `not_a_pdf` | 400 | Upload fails the `%PDF-` header check |
| `too_large` | 413 | Over the 10 MB limit |
| `encrypted_pdf` | 422 | Password-protected, cannot be opened |
| `unreadable_pdf` | 422 | Has a PDF header but cannot be parsed |
| `internal_error` | 500 | Unexpected extractor failure |

## Response (trimmed)

Results are **per page** — a multi-page docket repeats its headings on every
page, so each page keeps its own copy instead of collapsing to one record:

```json
{
  "document": { "fileName": "KBS-DR118.pdf", "pageCount": 8, "docType": "delivery_docket" },
  "pages": [
    {
      "pageNumber": 1,
      "sectionTitle": { "value": "…Site 1 of 4…", "evidence": { "page": 1, "sourceText": "…", "rect": { "x": 0, "y": 0, "width": 0, "height": 0 } } },
      "fields": {
        "documentNumber": { "value": "KBS-DR118", "evidence": { "page": 1, "sourceText": "Document No: KBS-DR118" } },
        "date": { "value": "24 August 2026", "evidence": { "page": 1, "sourceText": "Date: 24 August 2026" } }
      },
      "total": { "value": "$2,630.00", "evidence": { "page": 1, "sourceText": "Total: $2,630.00" } },
      "items": [
        {
          "section": "…",
          "cells": [
            {
              "label": "Description",
              "value": "…",
              "evidence": { "page": 1, "sourceText": "…" }
            },
            {
              "label": "Line Total",
              "value": "$1,195.20",
              "evidence": { "page": 1, "sourceText": "$1,195.20" }
            }
          ],
          "rowSourceText": "…"
        }
      ],
      "tableLabels": ["Item", "Description", "Qty", "Unit", "Unit Price", "Line Total"],
      "refusals": []
    }
  ],
  "issues": []
}
```

`evidence.rect` is the value's bounding box in PDF points, captured at
extraction time. The viewer draws that box directly and only falls back
to text search when no rect exists.

## Sample documents (`sample-files-variant-A/`) and expected behavior

| File | What it is | Expected result |
|---|---|---|
| `KBS-10234.pdf` | Clean packing list | 5 items, total $2,630.00, no refusals, no issues |
| `KBS-10241.pdf` | Image-only page (scanned) | `page_no_text` refusal, 0 items, nothing invented |
| `KBS-10255.pdf` | No line-total column | 4 items, `value_not_stated` for the unparsable weight total; no issues |
| `KBS-10262.pdf` | Consistent totals | 3 items, total $5,122.40 reconciles, no issues |
| `KBS-10270.pdf` | Wrong stated total | Total $1,612.90 kept as written + `arithmetic_mismatch` (sums to $1,538.20) |
| `KBS-DR118.pdf` | 8-page docket, page 4 image-only | 21 items across 7 sections, per-page meta, 1 page refusal, no issues |
