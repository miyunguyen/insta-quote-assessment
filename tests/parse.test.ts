import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { headerFieldNames, parsePageLines } from "@/server/extract/parse";
import { loadPages, type PageLine } from "@/server/extract/pdf";

const samplesDir = path.resolve(process.cwd(), "sample-files-variant-A");

async function parseSample(name: string, pageNumber = 1) {
  const bytes = await readFile(path.join(samplesDir, name));
  const doc = await loadPages(new Uint8Array(bytes));
  const page = doc.pages[pageNumber - 1];
  if (page.status !== "ok") throw new Error(`page ${pageNumber} not ok`);
  return parsePageLines(page.pageNumber, page.lines);
}

describe("parsePageLines", () => {
  test("clean packing list: meta, header, five rows, footer in otherLines", async () => {
    const parsed = await parseSample("KBS-10234.pdf");
    expect(parsed.sectionTitle).toBe("Packing List");
    expect(parsed.meta.map((m) => m.key)).toEqual([
      "documentNumber",
      "date",
      "deliveredTo",
      "orderedBy",
    ]);
    expect(parsed.meta[0].value).toBe("KBS-10234");
    expect(parsed.header).toEqual([
      "Item",
      "Description",
      "Qty",
      "Unit",
      "Unit Price",
      "Line Total",
    ]);
    expect(parsed.rows).toHaveLength(5);
    expect(parsed.rows[0].cells).toEqual([
      "1",
      "10mm GIB Standard board 2400x1200",
      "48",
      "sheet",
      "$24.90",
      "$1,195.20",
    ]);
    expect(parsed.badRows).toHaveLength(0);
    const footer = parsed.otherLines.find((l) => l.text.startsWith("Total:"));
    expect(footer?.text).toContain("$2,630.00");
  });

  test("no-line-total document: Weight column mapped, weight-total note preserved", async () => {
    const parsed = await parseSample("KBS-10255.pdf");
    expect(parsed.header).toEqual([
      "Item",
      "Description",
      "Qty",
      "Weight",
      "Unit Price",
    ]);
    expect(headerFieldNames(parsed.header!)).toEqual([
      "item",
      "description",
      "quantity",
      "weight",
      "unitPrice",
    ]);
    expect(parsed.rows).toHaveLength(4);
    expect(parsed.rows[0].cells).toEqual([
      "1",
      "Galv nails 90mm, bulk",
      "4",
      "25kg",
      "$68.00 /bag",
    ]);
    const note = parsed.otherLines.find((l) =>
      l.text.includes("Total consignment weight"),
    );
    expect(note?.text).toContain("see individual lines");
  });

  test("contradictory document keeps both claim notes in otherLines", async () => {
    const parsed = await parseSample("KBS-10262.pdf");
    expect(parsed.rows).toHaveLength(3);
    const texts = parsed.otherLines.map((l) => l.text);
    expect(texts.some((t) => t.includes("Summary: 14 pallets"))).toBe(true);
    expect(texts.some((t) => t.includes("Driver notes: 16 pallets"))).toBe(
      true,
    );
    expect(texts.some((t) => t.startsWith("Total:"))).toBe(true);
  });

  test("multi-section docket: each page keeps its own section title and rows", async () => {
    const page1 = await parseSample("KBS-DR118.pdf", 1);
    const page5 = await parseSample("KBS-DR118.pdf", 5);
    expect(page1.sectionTitle).toContain("Site 1 of 4");
    expect(page5.sectionTitle).toContain("Summary");
    expect(page1.rows).toHaveLength(3);
    expect(page5.rows[0].cells[1]).toBe("Framing timber lot 5-1");
    expect(page1.meta.find((m) => m.key === "documentNumber")?.value).toBe(
      "KBS-DR118",
    );
  });

  test("row with wrong cell count becomes a badRow; siblings still parse", () => {
    const header: PageLine = {
      y: 100,
      text: "Item Description Qty Unit Unit Price Line Total",
      tokens: [
        "Item",
        "Description",
        "Qty",
        "Unit",
        "Unit Price",
        "Line Total",
      ].map((str, i) => ({ str, x: i * 10, y: 100, width: 5, fontSize: 10 })),
    };
    const badRow: PageLine = {
      y: 80,
      text: "2 Broken row missing cells",
      tokens: ["2", "Broken row missing cells"].map((str, i) => ({
        str,
        x: i * 10,
        y: 80,
        width: 5,
        fontSize: 10,
      })),
    };
    const goodRow: PageLine = {
      y: 60,
      text: "3 Widget 5 ea $2.00 $10.00",
      tokens: ["3", "Widget", "5", "ea", "$2.00", "$10.00"].map((str, i) => ({
        str,
        x: i * 10,
        y: 60,
        width: 5,
        fontSize: 10,
      })),
    };
    const parsed = parsePageLines(1, [header, badRow, goodRow]);
    expect(parsed.badRows).toHaveLength(1);
    expect(parsed.badRows[0].expectedCells).toBe(6);
    expect(parsed.badRows[0].actualCells).toBe(2);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0].cells[0]).toBe("3");
  });

  test("arbitrary text without meta or table gets no section title", () => {
    const textLine = (y: number, text: string): PageLine => ({
      y,
      text,
      tokens: text
        .split(" ")
        .map((str, i) => ({ str, x: i * 20, y, width: 10, fontSize: 10 })),
    });
    const parsed = parsePageLines(1, [
      textLine(100, "Dear Sir,"),
      textLine(90, "Thank you for your letter."),
      textLine(80, "Kind regards,"),
    ]);
    expect(parsed.sectionTitle).toBeNull();
    expect(parsed.titleLineNumber).toBeNull();
    expect(parsed.meta).toHaveLength(0);
    expect(parsed.rows).toHaveLength(0);
  });

  test("meta-less table page still keeps its genuine title", () => {
    const pack = (y: number, text: string, strs: string[]): PageLine => ({
      y,
      text,
      tokens: strs.map((str, i) => ({
        str,
        x: i * 20,
        y,
        width: 10,
        fontSize: 10,
      })),
    });
    const parsed = parsePageLines(1, [
      pack(100, "Example Co", ["Example", "Co"]),
      pack(90, "Packing List", ["Packing", "List"]),
      pack(80, "Item Description Qty Unit Unit Price Line Total", [
        "Item",
        "Description",
        "Qty",
        "Unit",
        "Unit Price",
        "Line Total",
      ]),
      pack(70, "1 Widget 2 ea $10.00 $20.00", [
        "1",
        "Widget",
        "2",
        "ea",
        "$10.00",
        "$20.00",
      ]),
    ]);
    expect(parsed.sectionTitle).toBe("Packing List");
    expect(parsed.titleLineNumber).toBe(1);
    expect(parsed.rows).toHaveLength(1);
  });
});
