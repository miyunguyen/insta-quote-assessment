import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { buildExtraction, extractFromPdf } from "@/server/extract/extract";
import type { DocumentLoadResult, PageLine, PageResult } from "@/server/extract/pdf";
import { verifyTraceability } from "@/server/extract/verify";
import {
  evidenceContains,
} from "@/server/extract/normalize";
import type { ExtractionResult, FieldValue, LineItem, Refusal } from "@/server/extract/types";

const samplesDir = path.resolve(process.cwd(), "sample-files-variant-A");

async function extractSample(name: string): Promise<ExtractionResult> {
  const bytes = await readFile(path.join(samplesDir, name));
  return extractFromPdf(new Uint8Array(bytes), name);
}

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

function okPage(pageNumber: number, lines: PageLine[]): PageResult {
  return { pageNumber, status: "ok", lines };
}

function syntheticDoc(...pages: PageResult[]): DocumentLoadResult {
  return { pageCount: pages.length, pages };
}

const HEADER = [
  "Item",
  "Description",
  "Qty",
  "Unit",
  "Unit Price",
  "Line Total",
];

function allItems(result: ExtractionResult): LineItem[] {
  return result.pages.flatMap((page) => page.items);
}

function allRefusals(result: ExtractionResult): Refusal[] {
  return result.pages.flatMap((page) => page.refusals);
}

function allFieldValues(result: ExtractionResult): FieldValue[] {
  const out: FieldValue[] = [];
  for (const page of result.pages) {
    if (page.sectionTitle) out.push(page.sectionTitle);
    for (const fv of Object.values(page.fields)) {
      if (fv) out.push(fv);
    }
    if (page.total) out.push(page.total);
    for (const item of page.items) {
      for (const key of [
        "description",
        "quantity",
        "unit",
        "weight",
        "unitPrice",
        "lineTotal",
      ] as const) {
        const fv = item[key];
        if (fv) out.push(fv);
      }
    }
  }
  return out;
}

describe("refusal rules on real samples", () => {
  test("image-only document: everything refused, nothing invented", async () => {
    const result = await extractSample("KBS-10241.pdf");
    expect(allItems(result)).toHaveLength(0);
    const refusals = allRefusals(result);
    expect(refusals).toHaveLength(1);
    expect(refusals[0].code).toBe("page_no_text");
    expect(refusals[0].scope.page).toBe(1);
    expect(refusals[0].plainLanguage).toContain("image");
    expect(result.document.pageCount).toBe(1);
    // the image-only page still appears in pages, as a shell with its refusal
    expect(result.pages).toHaveLength(1);
    expect(result.pages[0].refusals).toHaveLength(1);
  });

  test("DR118: refusal for page 4 only; other 7 pages still yield items", async () => {
    const result = await extractSample("KBS-DR118.pdf");
    expect(result.pages).toHaveLength(8);
    const refusals = allRefusals(result);
    expect(refusals).toHaveLength(1);
    expect(refusals[0].code).toBe("page_no_text");
    expect(refusals[0].scope.page).toBe(4);
    expect(result.pages[3].items).toHaveLength(0);
    expect(result.pages[3].refusals).toHaveLength(1);
    const items = allItems(result);
    expect(items).toHaveLength(21);
    const sections = new Set(items.map((i) => i.section));
    expect(sections.size).toBe(7);
    // every readable page keeps its own copy of the repeated meta
    const numbered = result.pages.filter((p) => p.fields.documentNumber);
    expect(numbered).toHaveLength(7);
    for (const page of numbered) {
      expect(page.fields.documentNumber?.value).toBe("KBS-DR118");
      expect(page.fields.date?.value).toBe("24 August 2026");
      expect(page.fields.documentNumber?.evidence.rect).toBeDefined();
      expect(page.fields.date?.evidence.rect).toBeDefined();
    }
    expect(result.issues).toHaveLength(0);
  });

  test("KBS-10255: no line totals computed into items; unstated values refused with reason", async () => {
    const result = await extractSample("KBS-10255.pdf");
    const items = allItems(result);
    expect(items).toHaveLength(4);
    for (const item of items) {
      expect(item.lineTotal).toBeUndefined();
      expect(item.quantity).toBeDefined();
      expect(item.unitPrice).toBeDefined();
    }
    // absent columns are not refusals — only the stated-but-unreadable value is
    const weightRefusal = allRefusals(result).find(
      (r) => r.code === "value_not_stated",
    );
    expect(weightRefusal?.evidence?.sourceText).toContain(
      "see individual lines",
    );

    // no what-if values anywhere: no derived issues, nothing computed
    expect(result.issues).toHaveLength(0);
    const raw = JSON.stringify({
      document: result.document,
      pages: result.pages,
    });
    expect(raw).not.toContain("$272.00");
  });

  test("KBS-10262: notes ignored; stated total kept, totals reconcile", async () => {
    const result = await extractSample("KBS-10262.pdf");
    expect(allItems(result)).toHaveLength(3);
    // stated total equals sum of line totals → no arithmetic issue
    expect(result.issues).toHaveLength(0);
    expect(result.pages[0].total?.value).toBe("$5,122.40");
  });

  test("KBS-10270: stated total kept, mismatch flagged, no invented reconciling number", async () => {
    const result = await extractSample("KBS-10270.pdf");
    expect(result.pages[0].total?.value).toBe("$1,612.90");
    expect(result.pages[0].total?.evidence.sourceText).toContain(
      "$1,612.90",
    );
    const mismatch = result.issues.find((i) => i.code === "arithmetic_mismatch");
    expect(mismatch).toBeDefined();
    if (mismatch?.code !== "arithmetic_mismatch") throw new Error("wrong code");
    expect(mismatch.derived.value).toBe("$1,538.20");
    expect(mismatch.stated[0].value).toBe("$1,612.90");
    expect(mismatch.derived.operands).toHaveLength(4);
    expect(mismatch.plainLanguage).toContain("doesn't equal");
    // each stated line total remains individually extracted with evidence
    const totals = allItems(result)
      .map((i) => i.lineTotal?.value)
      .filter(Boolean);
    expect(totals).toEqual(["$936.00", "$160.20", "$64.00", "$378.00"]);
  });

  test("KBS-10234: clean document has no refusals and no issues", async () => {
    const result = await extractSample("KBS-10234.pdf");
    expect(allRefusals(result)).toHaveLength(0);
    expect(result.issues).toHaveLength(0);
    expect(allItems(result)).toHaveLength(5);
    expect(result.pages[0].total?.value).toBe("$2,630.00");
    expect(result.document.docType).toBe("packing_list");
  });
});

describe("traceability invariant across all samples", () => {
  test("every number in document/items points at its own source text", async () => {
    const files = [
      "KBS-10234.pdf",
      "KBS-10241.pdf",
      "KBS-10255.pdf",
      "KBS-10262.pdf",
      "KBS-10270.pdf",
      "KBS-DR118.pdf",
    ];
    for (const file of files) {
      const result = await extractSample(file);
      for (const fv of allFieldValues(result)) {
        expect(
          evidenceContains(fv.evidence.sourceText, fv.value),
          `${file}: value "${fv.value}" not in source "${fv.evidence.sourceText}"`,
        ).toBe(true);
        expect(fv.evidence.page).toBeGreaterThanOrEqual(1);
        expect(fv.evidence.page).toBeLessThanOrEqual(result.document.pageCount);
      }
      // bonus conflicts must reference actually extracted values, not invented ones
      for (const issue of result.issues) {
        if (issue.code !== "arithmetic_mismatch") continue;
        const statedValues = allFieldValues(result).map((f) => f.value);
        for (const stated of issue.stated) {
          expect(statedValues).toContain(stated.value);
        }
      }
    }
  });
});

describe("refusal rules on synthetic pages", () => {
  test("row with wrong cell count → unreadable_value refusal; sibling rows survive", () => {
    const doc = syntheticDoc(
      okPage(1, [
        line(900, ["Example Co"]),
        line(880, ["Packing List"]),
        line(860, ["Document No: TEST-2"]),
        line(800, HEADER),
        line(795, ["-".repeat(60)]),
        line(780, ["1", "Widget", "2", "ea", "$10.00", "$20.00"]),
        line(760, ["2", "Broken row"]),
        line(740, ["3", "Gadget", "1", "ea", "$5.00", "$5.00"]),
      ]),
    );
    const result = buildExtraction(doc, "synthetic.pdf");
    expect(allItems(result)).toHaveLength(2);
    const refusal = allRefusals(result).find((r) => r.code === "unreadable_value");
    expect(refusal).toBeDefined();
    expect(refusal?.evidence?.sourceText).toBe("2 Broken row");
    expect(refusal?.plainLanguage).toContain("didn't match");
    expect(refusal?.technicalDetail).toContain("2 cells");
  });

  test("failing traceability check removes the field instead of emitting it", () => {
    const doc = syntheticDoc(
      okPage(1, [
        line(900, ["Example Co"]),
        line(880, ["Packing List"]),
        line(860, ["Document No: TEST-3"]),
        line(800, HEADER),
        line(795, ["-".repeat(60)]),
        line(780, ["1", "Widget", "2", "ea", "$10.00", "$20.00"]),
      ]),
    );
    const result = buildExtraction(doc, "synthetic.pdf");
    // Tamper: value no longer present in its evidence text
    const original = result.pages[0].fields.documentNumber;
    expect(original).toBeDefined();
    const tampered: ExtractionResult = {
      ...result,
      pages: result.pages.map((page, index) =>
        index === 0
          ? {
              ...page,
              fields: {
                ...page.fields,
                documentNumber: {
                  value: "FAKE-999",
                  evidence: original!.evidence,
                },
              },
            }
          : page,
      ),
    };
    const verified = verifyTraceability(tampered);
    expect(verified.result.pages[0].fields.documentNumber).toBeUndefined();
    expect(verified.violations).toHaveLength(1);
    expect(verified.violations[0].plainLanguage).toContain(
      "removed rather than reported",
    );
    expect(verified.violations[0].plainLanguage).toContain("page 1");
  });

  test("row arithmetic mismatch produces issue with operand evidence", () => {
    const doc = syntheticDoc(
      okPage(1, [
        line(900, ["Example Co"]),
        line(880, ["Invoice"]),
        line(860, ["Document No: TEST-4"]),
        line(800, HEADER),
        line(795, ["-".repeat(60)]),
        line(780, ["1", "Widget", "2", "ea", "$10.00", "$99.00"]),
      ]),
    );
    const result = buildExtraction(doc, "synthetic.pdf");
    // stated line total still extracted (it has a source)
    expect(result.pages[0].items[0].lineTotal?.value).toBe("$99.00");
    const mismatch = result.issues.find((i) => i.code === "arithmetic_mismatch");
    expect(mismatch).toBeDefined();
    if (mismatch?.code !== "arithmetic_mismatch") throw new Error("wrong code");
    expect(mismatch.derived.value).toBe("$20.00");
    expect(mismatch.derived.operands[0].evidence.sourceText).toBe("2");
  });

  test("conflicting document numbers across pages: field omitted, both claims kept", () => {
    const pageWith = (num: string, pageNumber: number): PageResult =>
      okPage(pageNumber, [
        line(900, ["Example Co"]),
        line(880, ["Packing List"]),
        line(860, [`Document No: ${num}`]),
        line(800, HEADER),
        line(795, ["-".repeat(60)]),
        line(780, ["1", "Widget", "2", "ea", "$10.00", "$20.00"]),
      ]);
    const doc = syntheticDoc(pageWith("AAA-1", 1), pageWith("BBB-2", 2));
    const result = buildExtraction(doc, "synthetic.pdf");
    expect(
      result.pages.every((p) => p.fields.documentNumber === undefined),
    ).toBe(true);
    const contradiction = result.issues.find((i) => i.code === "contradiction");
    expect(contradiction?.code === "contradiction" && contradiction.claims).toHaveLength(2);
    expect(allItems(result)).toHaveLength(2);
  });

  test("agreeing document numbers across pages: each page keeps its own copy", () => {
    const pageWith = (pageNumber: number): PageResult =>
      okPage(pageNumber, [
        line(900, ["Example Co"]),
        line(880, ["Packing List"]),
        line(860, ["Document No: SAME-1"]),
        line(800, HEADER),
        line(795, ["-".repeat(60)]),
        line(780, ["1", "Widget", "2", "ea", "$10.00", "$20.00"]),
      ]);
    const doc = syntheticDoc(pageWith(1), pageWith(2));
    const result = buildExtraction(doc, "synthetic.pdf");
    expect(result.pages).toHaveLength(2);
    for (const page of result.pages) {
      expect(page.fields.documentNumber?.value).toBe("SAME-1");
      expect(page.fields.documentNumber?.evidence.page).toBe(page.pageNumber);
      expect(page.fields.documentNumber?.evidence.rect).toBeDefined();
    }
    expect(
      result.issues.some((i) => i.code === "contradiction"),
    ).toBe(false);
  });
});
