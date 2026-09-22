import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { evidenceContains, parseLeadingAmount } from "@/lib/text";
import { loadPages } from "@/server/extract/pdf";

const samplesDir = path.resolve(process.cwd(), "sample-files-variant-A");

async function loadSample(name: string) {
  const bytes = await readFile(path.join(samplesDir, name));
  return loadPages(new Uint8Array(bytes));
}

describe("loadPages", () => {
  test("clean packing list loads with text lines", async () => {
    const result = await loadSample("KBS-10234.pdf");
    expect(result.pageCount).toBe(1);
    const page = result.pages[0];
    expect(page.status).toBe("ok");
    if (page.status !== "ok") return;
    const allText = page.lines.map((l) => l.text).join("\n");
    expect(allText).toContain("Packing List");
    expect(allText).toContain("$1,195.20");
  });

  test("image-only PDF is reported as no_text, not an error", async () => {
    const result = await loadSample("KBS-10241.pdf");
    expect(result.pageCount).toBe(1);
    expect(result.pages[0].status).toBe("no_text");
  });

  test("multi-page docket isolates the image-only page", async () => {
    const result = await loadSample("KBS-DR118.pdf");
    expect(result.pageCount).toBe(8);
    const statuses = result.pages.map((p) => p.status);
    const noTextPages = result.pages
      .filter((p) => p.status === "no_text")
      .map((p) => p.pageNumber);
    expect(noTextPages).toContain(4);
    expect(statuses.filter((s) => s === "ok").length).toBeGreaterThanOrEqual(7);
  });

  test("rejects non-PDF bytes at the document level", async () => {
    const notAPdf = new Uint8Array([1, 2, 3, 4, 5]);
    await expect(loadPages(notAPdf)).rejects.toThrow();
  });
});

describe("normalize helpers", () => {
  test("evidenceContains matches value inside source text", () => {
    expect(evidenceContains("$1,195.20", "$1,195.20")).toBe(true);
    expect(evidenceContains("Date: 2 September 2026", "2 September 2026")).toBe(
      true,
    );
    expect(evidenceContains("$1,195.20", "$9,999.99")).toBe(false);
    expect(evidenceContains("   $42.00  ", "$42.00")).toBe(true);
  });

  test("parseLeadingAmount reads stated amounts with decorations", () => {
    expect(parseLeadingAmount("$1,195.20")).toBeCloseTo(1195.2);
    expect(parseLeadingAmount("$68.00 /bag")).toBeCloseTo(68);
    expect(parseLeadingAmount("48")).toBe(48);
    expect(parseLeadingAmount("see individual lines")).toBeNull();
  });
});
