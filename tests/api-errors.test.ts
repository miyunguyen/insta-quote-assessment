import { describe, expect, test } from "vitest";
import { API_ERRORS } from "@/server/api-errors";

describe("API error contract", () => {
  test("error statuses match the agreed contract", () => {
    expect(API_ERRORS.missing_file.status).toBe(400);
    expect(API_ERRORS.not_a_pdf.status).toBe(400);
    expect(API_ERRORS.too_large.status).toBe(413);
    expect(API_ERRORS.encrypted_pdf.status).toBe(422);
    expect(API_ERRORS.unreadable_pdf.status).toBe(422);
    expect(API_ERRORS.internal_error.status).toBe(500);
  });
});
