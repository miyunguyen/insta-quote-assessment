import { NextRequest } from "next/server";
import { extractFromPdf } from "@/server/extract/extract";
import { apiError } from "@/server/api-errors";

export const runtime = "nodejs";

const MAX_BYTES = 10 * 1024 * 1024;

function looksLikePdf(bytes: Uint8Array): boolean {
  const header = bytes.subarray(0, 1024);
  for (let i = 0; i < header.length - 4; i++) {
    if (
      header[i] === 0x25 && // %
      header[i + 1] === 0x50 && // P
      header[i + 2] === 0x44 && // D
      header[i + 3] === 0x46 && // F
      header[i + 4] === 0x2d // -
    ) {
      return true;
    }
  }
  return false;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function POST(request: NextRequest): Promise<Response> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return apiError(
      "missing_file",
      "the request body was not valid multipart/form-data",
    );
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return apiError("missing_file");
  }
  if (file.size === 0) {
    return apiError("missing_file", "the uploaded file is empty");
  }
  if (file.size > MAX_BYTES) {
    return apiError("too_large", `${file.size} bytes exceeds ${MAX_BYTES}`);
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!looksLikePdf(bytes)) {
    return apiError("not_a_pdf");
  }

  try {
    const result = await extractFromPdf(bytes, file.name || "document.pdf");
    return Response.json(result);
  } catch (err) {
    const message = messageOf(err);
    if (/password/i.test(message) || /encrypt/i.test(message)) {
      return apiError("encrypted_pdf", message);
    }
    if (/invalid pdf|structure|corrupt|malformed|xref/i.test(message)) {
      return apiError("unreadable_pdf", message);
    }
    return apiError("internal_error", message);
  }
}
