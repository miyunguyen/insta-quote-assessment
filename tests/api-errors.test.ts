import { describe, expect, test } from "vitest";
import { API_ERRORS } from "@/server/api-errors";

describe("API error contract", () => {
  test("every error code has a non-generic, actionable message", () => {
    const generic = [
      /an error occurred/i,
      /something went wrong/i,
      /unknown error/i,
      /please try again later/i,
      /^error$/i,
    ];
    for (const [code, { status, message }] of Object.entries(API_ERRORS)) {
      expect(status).toBeGreaterThanOrEqual(400);
      expect(message.length, code).toBeGreaterThanOrEqual(40);
      for (const pattern of generic) {
        expect(pattern.test(message), `${code}: ${message}`).toBe(false);
      }
      // messages should tell the user what to do or what happened specifically
      expect(message).toMatch(/\./);
    }
  });

  test("error statuses match the agreed contract", () => {
    expect(API_ERRORS.missing_file.status).toBe(400);
    expect(API_ERRORS.not_a_pdf.status).toBe(400);
    expect(API_ERRORS.too_large.status).toBe(413);
    expect(API_ERRORS.encrypted_pdf.status).toBe(422);
    expect(API_ERRORS.unreadable_pdf.status).toBe(422);
    expect(API_ERRORS.internal_error.status).toBe(500);
  });
});
