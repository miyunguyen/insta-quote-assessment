import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { buildExtraction, extractFromPdf } from "@/server/extract/extract";
import type { DocumentLoadResult, PageLine, PageResult } from "@/server/extract/pdf";
import { extractionResultSchema } from "@/server/extract/types";

const samplesDir = path.resolve(process.cwd(), "sample-files-variant-A");

function line(y: number, tokens: string[]): PageLine {
  const sorted = tokens.map((str, i) => ({
    str,
    x: i * 20,
    y,
    width: 10,
    fontSize: 10,
  }));
  return { y, tokens: sorted, text: tokens.join(" ") };
}

const HEADER = [
  "Item",
  "Description",
  "Qty",
  "Unit",
  "Unit Price",
  "Line Total",
];

function doc(...pages: PageResult[]): DocumentLoadResult {
  return { pageCount: pages.length, pages };
}

describe("refusal code coverage", () => {
  test("page that fails during parsing becomes a contained page_parse_failed refusal", () => {
    const result = buildExtraction(
      doc(
        {
          pageNumber: 1,
          status: "error",
          message: "Malformed content stream at offset 1234",
        },
        {
          pageNumber: 2,
          status: "ok",
          lines: [
            line(900, ["Example Co"]),
            line(880, ["Packing List"]),
            line(860, ["Document No: TEST-5"]),
            line(800, HEADER),
            line(795, ["-".repeat(60)]),
            line(780, ["1", "Widget", "2", "ea", "$10.00", "$20.00"]),
          ],
        },
      ),
      "partial.pdf",
    );
    expect(result.pages).toHaveLength(2);
    const refusals = result.pages.flatMap((p) => p.refusals);
    expect(refusals).toHaveLength(1);
    expect(refusals[0].code).toBe("page_parse_failed");
    expect(refusals[0].scope.page).toBe(1);
    expect(refusals[0].technicalDetail).toContain(
      "Malformed content stream",
    );
    // page 2 still extracted — failure contained
    expect(result.pages.flatMap((p) => p.items)).toHaveLength(1);
    expect(result.pages[1].fields.documentNumber?.value).toBe("TEST-5");
  });

  test("total line with two different amounts → ambiguous_reference, no total extracted", () => {
    const result = buildExtraction(
      doc(
        {
          pageNumber: 1,
          status: "ok",
          lines: [
            line(900, ["Example Co"]),
            line(880, ["Packing List"]),
            line(860, ["Document No: TEST-6"]),
            line(800, HEADER),
            line(795, ["-".repeat(60)]),
            line(780, ["1", "Widget", "2", "ea", "$10.00", "$20.00"]),
            line(760, ["Total:", "$100.00", "or", "$95.00"]),
          ],
        },
      ),
      "ambiguous.pdf",
    );
    expect(result.pages[0].total).toBeUndefined();
    const refusal = result.pages
      .flatMap((p) => p.refusals)
      .find((r) => r.code === "ambiguous_reference");
    expect(refusal).toBeDefined();
    expect(refusal?.evidence?.sourceText).toBe(
      "Total: $100.00 or $95.00",
    );
    expect(refusal?.plainLanguage).toContain("isn't clear which figure");
    expect(refusal?.plainLanguage).toContain("$100.00, $95.00");
    // the row's trailing money cell is untouched
    const rowCells = result.pages[0].items[0].cells.map((c) => c.value);
    expect(rowCells[rowCells.length - 1]).toBe("$20.00");
  });
});

describe("refusal messages stay human-readable", () => {
  test("no refusal collapses into generic error language", async () => {
    const files = [
      "KBS-10234.pdf",
      "KBS-10241.pdf",
      "KBS-10255.pdf",
      "KBS-10262.pdf",
      "KBS-10270.pdf",
      "KBS-DR118.pdf",
    ];
    const genericPatterns = [
      /an error occurred/i,
      /something went wrong/i,
      /unknown error/i,
      /error\s*\d+/i,
      /failed to process/i,
      /please try again later/i,
    ];
    let refusalCount = 0;
    for (const file of files) {
      const bytes = await readFile(path.join(samplesDir, file));
      const result = await extractFromPdf(new Uint8Array(bytes), file);
      for (const refusal of result.pages.flatMap((p) => p.refusals)) {
        refusalCount += 1;
        expect(refusal.plainLanguage.length).toBeGreaterThanOrEqual(40);
        for (const pattern of genericPatterns) {
          expect(
            pattern.test(refusal.plainLanguage),
            `${file}: "${refusal.plainLanguage}" matches ${pattern}`,
          ).toBe(false);
        }
        // must say where
        expect(refusal.plainLanguage).toMatch(/page \d+/i);
      }
      for (const issue of result.issues) {
        expect(issue.plainLanguage.length).toBeGreaterThanOrEqual(40);
        for (const pattern of genericPatterns) {
          expect(
            pattern.test(issue.plainLanguage),
            `${file}: "${issue.plainLanguage}" matches ${pattern}`,
          ).toBe(false);
        }
      }
    }
    // sanity: the guard actually inspected real refusals
    expect(refusalCount).toBeGreaterThanOrEqual(3);
  });
});

describe("response schema guards the contract", () => {
  test("rejects a value without evidence", () => {
    const parsed = extractionResultSchema.safeParse({
      document: {
        fileName: "x.pdf",
        pageCount: 1,
        docType: "unknown",
      },
      pages: [
        {
          pageNumber: 1,
          fields: { date: { value: "1 Jan 2026" } },
          items: [],
          refusals: [],
        },
      ],
      issues: [],
    });
    expect(parsed.success).toBe(false);
  });

  test("rejects unknown refusal codes and empty plain-language", () => {
    const pageWith = (refusals: unknown) => ({
      document: {
        fileName: "x.pdf",
        pageCount: 1,
        docType: "unknown",
      },
      pages: [{ pageNumber: 1, fields: {}, items: [], refusals }],
      issues: [],
    });
    expect(
      extractionResultSchema.safeParse(
        pageWith([
          {
            code: "mystery_code",
            scope: { page: 1 },
            plainLanguage: "because",
            technicalDetail: "x",
          },
        ]),
      ).success,
    ).toBe(false);
    expect(
      extractionResultSchema.safeParse(
        pageWith([
          {
            code: "page_no_text",
            scope: { page: 1 },
            plainLanguage: "",
            technicalDetail: "x",
          },
        ]),
      ).success,
    ).toBe(false);
  });

  test("rejects an issue whose claims are missing evidence", () => {
    const parsed = extractionResultSchema.safeParse({
      document: {
        fileName: "x.pdf",
        pageCount: 1,
        docType: "unknown",
      },
      pages: [
        { pageNumber: 1, fields: {}, items: [], refusals: [] },
      ],
      issues: [
        {
          code: "contradiction",
          plainLanguage: "Two values conflict here in this document.",
          claims: [
            { label: "A", value: "1" },
            { label: "B", value: "2" },
          ],
        },
      ],
    });
    expect(parsed.success).toBe(false);
  });
});
