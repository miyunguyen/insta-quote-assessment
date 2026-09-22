import type { Issue, RefusalCode } from "@/server/extract/types";

export const REFUSAL_LABELS: Record<RefusalCode, string> = {
  page_no_text: "Image-only page",
  page_parse_failed: "Unreadable page",
  unreadable_value: "Unreadable value",
  value_not_stated: "Value not stated",
  ambiguous_reference: "Ambiguous total",
};

export const ISSUE_LABELS: Record<Issue["code"], string> = {
  contradiction: "Conflicting values",
  arithmetic_mismatch: "Numbers don't add up",
};

const UPLOAD_ERROR_LABELS: Record<string, string> = {
  missing_file: "No file chosen",
  not_a_pdf: "Not a PDF",
  not_pdf: "Not a PDF",
  too_large: "File too large",
  encrypted_pdf: "Encrypted PDF",
  unreadable_pdf: "Unreadable PDF",
  internal_error: "Server error",
  network: "Connection failed",
};

export function uploadErrorLabel(code: string): string {
  return (
    UPLOAD_ERROR_LABELS[code] ??
    (code.startsWith("http_") ? "Request failed" : "Upload failed")
  );
}
