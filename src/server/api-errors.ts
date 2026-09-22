export type ApiErrorCode =
  | "missing_file"
  | "not_a_pdf"
  | "too_large"
  | "encrypted_pdf"
  | "unreadable_pdf"
  | "internal_error";

export const API_ERRORS: Record<
  ApiErrorCode,
  { status: number; message: string }
> = {
  missing_file: {
    status: 400,
    message:
      'No file was uploaded. The request must include a PDF file under the form field "file".',
  },
  not_a_pdf: {
    status: 400,
    message:
      "This file is not a PDF. Only PDF documents can be extracted — the file must start with a valid PDF header.",
  },
  too_large: {
    status: 413,
    message:
      "This file is larger than the 10 MB limit for extraction. Split the document or export a smaller PDF, then try again.",
  },
  encrypted_pdf: {
    status: 422,
    message:
      "This PDF is password-protected, so its pages cannot be opened. Remove the password (for example, print or re-export it as an unprotected PDF) and upload it again.",
  },
  unreadable_pdf: {
    status: 422,
    message:
      "This file has a PDF header but could not be opened as a PDF — it may be corrupted or truncated. Re-export or re-download the document and try again.",
  },
  internal_error: {
    status: 500,
    message:
      "The extractor hit an unexpected problem while processing this document. The details below are what the server reported.",
  },
};

export function apiError(code: ApiErrorCode, detail?: string): Response {
  const { status, message } = API_ERRORS[code];
  const body = {
    error: {
      code,
      message: detail ? `${message} (${detail})` : message,
    },
  };
  return Response.json(body, { status });
}
