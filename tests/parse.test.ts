import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { parsePageLines } from "@/server/extract/parse";
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
    // labels are the document's own words — cells are never typed
    expect(parsed.tableLabels).toEqual([
      "Item",
      "Description",
      "Qty",
      "Unit",
      "Unit Price",
      "Line Total",
    ]);
    expect(parsed.tableHeaderText).toBe(
      "Item Description Qty Unit Unit Price Line Total",
    );
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

  test("no-line-total document: plain cells, weight-total note preserved", async () => {
    const parsed = await parseSample("KBS-10255.pdf");
    expect(parsed.tableLabels).toEqual([
      "Item",
      "Description",
      "Qty",
      "Weight",
      "Unit Price",
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
    const divider: PageLine = {
      y: 90,
      text: "-".repeat(60),
      tokens: [
        { str: "-".repeat(60), x: 0, y: 90, width: 300, fontSize: 10 },
      ],
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
    const parsed = parsePageLines(1, [header, divider, badRow, goodRow]);
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
      pack(70, "-".repeat(60), ["-".repeat(60)]),
      pack(60, "1 Widget 2 ea $10.00 $20.00", [
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

  test("separator-anchored table with custom header extracts rows", () => {
    const mk = (y: number, text: string, strs: string[]): PageLine => ({
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
    const dash = "-".repeat(60);
    const parsed = parsePageLines(1, [
      mk(100, "Example Co", ["Example", "Co"]),
      mk(90, "Packing List", ["Packing", "List"]),
      mk(80, "No Description Qty Unit Price", [
        "No",
        "Description",
        "Qty",
        "Unit Price",
      ]),
      mk(70, dash, [dash]),
      mk(60, "1 Widget 2 $10.00", ["1", "Widget", "2", "$10.00"]),
      mk(50, "2 Gadget 1 $5.00", ["2", "Gadget", "1", "$5.00"]),
    ]);
    expect(parsed.tableProblem).toBeNull();
    expect(parsed.tableLabels).toEqual([
      "No",
      "Description",
      "Qty",
      "Unit Price",
    ]);
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0].cells).toEqual(["1", "Widget", "2", "$10.00"]);
    expect(parsed.sectionTitle).toBe("Packing List");
  });

  test("uniform rows narrower than the header still extract generically", () => {
    const mk = (y: number, text: string, strs: string[]): PageLine => ({
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
    const dash = "-".repeat(60);
    const parsed = parsePageLines(1, [
      mk(100, "Example Co", ["Example", "Co"]),
      mk(90, "Packing List", ["Packing", "List"]),
      // header declares 4 columns, every data row carries 5: the table's
      // own width wins, headings don't line up so labels stay generic
      mk(80, "No Description Qty Unit Price", [
        "No",
        "Description",
        "Qty",
        "Unit Price",
      ]),
      mk(70, dash, [dash]),
      mk(60, "1 Widget 2 ea $10.00", ["1", "Widget", "2", "ea", "$10.00"]),
      mk(50, "2 Gadget 1 ea $5.00", ["2", "Gadget", "1", "ea", "$5.00"]),
    ]);
    expect(parsed.tableProblem).toBeNull();
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0].cells).toEqual([
      "1",
      "Widget",
      "2",
      "ea",
      "$10.00",
    ]);
    expect(parsed.tableLabels).toBeNull();
    expect(parsed.tableHeaderText).toBe("No Description Qty Unit Price");
    expect(parsed.badRows).toHaveLength(0);
  });

  test("isolated short row is refused alone; matching rows survive", () => {
    const mk = (y: number, text: string, strs: string[]): PageLine => ({
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
    const dash = "-".repeat(60);
    const parsed = parsePageLines(1, [
      mk(100, "Example Co", ["Example", "Co"]),
      mk(90, "Packing List", ["Packing", "List"]),
      mk(80, "No Description Qty Unit Price", [
        "No",
        "Description",
        "Qty",
        "Unit Price",
      ]),
      mk(70, dash, [dash]),
      mk(60, "1 Widget 2 $10.00", ["1", "Widget", "2", "$10.00"]),
      mk(50, "2 Broken", ["2", "Broken"]),
      mk(40, "3 Gadget 1 $5.00", ["3", "Gadget", "1", "$5.00"]),
    ]);
    expect(parsed.tableProblem).toBeNull();
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.badRows).toHaveLength(1);
    expect(parsed.badRows[0].lineText).toBe("2 Broken");
    expect(parsed.badRows[0].expectedCells).toBe(4);
    expect(parsed.badRows[0].actualCells).toBe(2);
  });

  test("divider with no usable header above it is a whole-table problem", () => {
    const mk = (y: number, text: string, strs: string[]): PageLine => ({
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
    const dash = "-".repeat(60);
    const parsed = parsePageLines(1, [
      mk(100, "Example Co", ["Example", "Co"]),
      mk(90, "Packing List", ["Packing", "List"]),
      // data row where the header should be — digit-led, not a heading
      mk(80, "1 Widget 2 $10.00", ["1", "Widget", "2", "$10.00"]),
      mk(70, dash, [dash]),
      mk(60, "2 Gadget 1 $5.00", ["2", "Gadget", "1", "$5.00"]),
    ]);
    expect(parsed.tableProblem?.kind).toBe("no_header");
    expect(parsed.rows).toHaveLength(0);
    expect(parsed.badRows).toHaveLength(0);
  });

  test("table exits at the first non-data line; totals still parse", () => {    const mk = (y: number, text: string, strs: string[]): PageLine => ({
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
    const dash = "-".repeat(60);
    const parsed = parsePageLines(1, [
      mk(100, "Example Co", ["Example", "Co"]),
      mk(90, "Packing List", ["Packing", "List"]),
      mk(80, "No Description Qty Unit Price", [
        "No",
        "Description",
        "Qty",
        "Unit Price",
      ]),
      mk(70, dash, [dash]),
      mk(60, "1 Widget 2 $10.00", ["1", "Widget", "2", "$10.00"]),
      mk(50, "Total: $10.00", ["Total:", "$10.00"]),
      mk(40, "Thank you", ["Thank", "you"]),
    ]);
    expect(parsed.tableProblem).toBeNull();
    expect(parsed.rows).toHaveLength(1);
    const texts = parsed.otherLines.map((l) => l.text);
    expect(texts.some((t) => t.startsWith("Total:"))).toBe(true);
  });

  test("Item/Description header without a divider finds no table", () => {
    const mk = (y: number, text: string, strs: string[]): PageLine => ({
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
    // Legacy exact-header scan is gone: no divider means no table, even
    // with the classic headings.
    const parsed = parsePageLines(1, [
      mk(100, "Example Co", ["Example", "Co"]),
      mk(90, "Packing List", ["Packing", "List"]),
      mk(80, "Item Description Qty Unit Price Line Total", [
        "Item",
        "Description",
        "Qty",
        "Unit Price",
        "Line Total",
      ]),
      mk(70, "1 Widget 2 $10.00 $20.00", [
        "1",
        "Widget",
        "2",
        "$10.00",
        "$20.00",
      ]),
    ]);
    expect(parsed.tableLabels).toBeNull();
    expect(parsed.tableHeaderText).toBeNull();
    expect(parsed.rows).toHaveLength(0);
    expect(parsed.tableProblem).toBeNull();
    expect(parsed.sectionTitle).toBeNull();
  });

  test("pipe table keeps every cell plain, headings as labels", () => {
    const mk = (y: number, text: string, strs: string[]): PageLine => ({
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
    const dash = "-".repeat(60);
    const parsed = parsePageLines(1, [
      mk(100, "Example Co", ["Example", "Co"]),
      mk(90, "Packing List", ["Packing", "List"]),
      mk(80, "Item | Description | Qty | Unit Price", [
        "Item",
        "|",
        "Description",
        "|",
        "Qty",
        "|",
        "Unit Price",
      ]),
      mk(70, dash, [dash]),
      mk(60, "1 | Red Widget | 2 | $10.00", [
        "1",
        "|",
        "Red",
        "Widget",
        "|",
        "2",
        "|",
        "$10.00",
      ]),
      mk(50, "2 | Gadget | 1 | $5.00", [
        "2",
        "|",
        "Gadget",
        "|",
        "1",
        "|",
        "$5.00",
      ]),
    ]);
    expect(parsed.tableProblem).toBeNull();
    expect(parsed.tableLabels).toEqual([
      "Item",
      "Description",
      "Qty",
      "Unit Price",
    ]);
    expect(parsed.rows).toHaveLength(2);
    // multi-word cell stays one cell, spanning two tokens
    expect(parsed.rows[0].cells).toEqual(["1", "Red Widget", "2", "$10.00"]);
    expect(parsed.rows[0].cellTokens).toEqual([[0], [2, 3], [5], [7]]);
  });

  test("pipe table with partial header extracts with generic labels", () => {
    const mk = (y: number, text: string, strs: string[]): PageLine => ({
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
    const dash = "-".repeat(60);
    // Mirrors the KBS-10234-2 layout: 3 headings, 6 pipe cells.
    const parsed = parsePageLines(1, [
      mk(100, "Example Co", ["Example", "Co"]),
      mk(90, "Packing List", ["Packing", "List"]),
      mk(80, "Description | Unit | Line Total", [
        "Description",
        "|",
        "Unit",
        "|",
        "Line Total",
      ]),
      mk(70, dash, [dash]),
      mk(
        60,
        "1 | 10mm GIB Standard board 2400x1200 | 48 | sheet | $24.90 | $1,195.20",
        [
          "1",
          "|",
          "10mm",
          "GIB",
          "Standard",
          "board",
          "2400x1200",
          "|",
          "48",
          "|",
          "sheet",
          "|",
          "$24.90",
          "|",
          "$1,195.20",
        ],
      ),
    ]);
    expect(parsed.tableProblem).toBeNull();
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0].cells).toEqual([
      "1",
      "10mm GIB Standard board 2400x1200",
      "48",
      "sheet",
      "$24.90",
      "$1,195.20",
    ]);
    // 3 headings, 6 cells: rows still extract, labels stay generic and the
    // header line is quoted as context
    expect(parsed.tableLabels).toBeNull();
    expect(parsed.tableHeaderText).toBe("Description | Unit | Line Total");
  });

  test("pipe row with an empty cell is refused alone with reason", () => {
    const mk = (y: number, text: string, strs: string[]): PageLine => ({
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
    const dash = "-".repeat(60);
    const parsed = parsePageLines(1, [
      mk(100, "Example Co", ["Example", "Co"]),
      mk(90, "Packing List", ["Packing", "List"]),
      mk(80, "Item | Description | Qty | Unit Price", [
        "Item",
        "|",
        "Description",
        "|",
        "Qty",
        "|",
        "Unit Price",
      ]),
      mk(70, dash, [dash]),
      mk(60, "1 | Widget | 2 | $10.00", [
        "1",
        "|",
        "Widget",
        "|",
        "2",
        "|",
        "$10.00",
      ]),
      // interior empty cell: "1 | Gadget | | $5.00"
      mk(50, "1 | Gadget | | $5.00", [
        "1",
        "|",
        "Gadget",
        "|",
        "|",
        "$5.00",
      ]),
    ]);
    // right cell count, missing value: per-row refusal only, never the table
    expect(parsed.tableProblem).toBeNull();
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.badRows).toHaveLength(1);
    expect(parsed.badRows[0].detail).toContain("empty");
  });

  test("uniform pipe rows narrower than the header extract generically", () => {
    const mk = (y: number, text: string, strs: string[]): PageLine => ({
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
    const dash = "-".repeat(60);
    const parsed = parsePageLines(1, [
      mk(100, "Example Co", ["Example", "Co"]),
      mk(90, "Packing List", ["Packing", "List"]),
      mk(80, "Item | Description | Qty | Unit Price", [
        "Item",
        "|",
        "Description",
        "|",
        "Qty",
        "|",
        "Unit Price",
      ]),
      mk(70, dash, [dash]),
      mk(60, "1 | Widget | 2", ["1", "|", "Widget", "|", "2"]),
      mk(50, "2 | Gadget | 1", ["2", "|", "Gadget", "|", "1"]),
    ]);
    expect(parsed.tableProblem).toBeNull();
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0].cells).toEqual(["1", "Widget", "2"]);
    // 3-cell rows under a 4-cell heading: generic labels, header quoted
    expect(parsed.tableLabels).toBeNull();
    expect(parsed.tableHeaderText).toBe("Item | Description | Qty | Unit Price");
    expect(parsed.badRows).toHaveLength(0);
  });

  test("unknown headings are displayed, never read", () => {
    const mk = (y: number, text: string, strs: string[]): PageLine => ({
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
    const dash = "-".repeat(60);
    const parsed = parsePageLines(1, [
      mk(100, "Example Co", ["Example", "Co"]),
      mk(90, "Packing List", ["Packing", "List"]),
      mk(80, "Xyz | Abc", ["Xyz", "|", "Abc"]),
      mk(70, dash, [dash]),
      mk(60, "1 | Widget", ["1", "|", "Widget"]),
      mk(50, "2 | Gadget", ["2", "|", "Gadget"]),
    ]);
    // gibberish headings: rows still extract, headings shown as-is
    expect(parsed.tableProblem).toBeNull();
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0].cells).toEqual(["1", "Widget"]);
    expect(parsed.tableLabels).toEqual(["Xyz", "Abc"]);
  });
});