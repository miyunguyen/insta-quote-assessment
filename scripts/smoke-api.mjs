// Live smoke test for POST /api/extract.
// Spawns `next start`, runs HTTP checks against the real route, then kills it.
// Run: node scripts/smoke-api.mjs
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";

const PORT = 3123;
const BASE = `http://127.0.0.1:${PORT}`;
const SAMPLES = path.resolve(process.cwd(), "sample-files-variant-A");

let failures = 0;

function check(name, cond, detail = "") {
  if (cond) {
    console.log(`PASS  ${name}`);
  } else {
    failures += 1;
    console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function postFile(fileName, bytes, contentType) {
  const body = new FormData();
  body.append(
    "file",
    new Blob([bytes], { type: contentType }),
    fileName,
  );
  const res = await fetch(`${BASE}/api/extract`, { method: "POST", body });
  const payload = await res.json().catch(() => null);
  return { res, payload };
}

async function waitReady(server) {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`${BASE}/`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  server.kill();
  throw new Error("server did not become ready in 60s");
}

const server = spawn(
  process.execPath,
  ["node_modules/next/dist/bin/next", "start", "-p", String(PORT)],
  { stdio: "ignore" },
);

try {
  await waitReady(server);

  // 1. missing file -> 400 missing_file
  {
    const res = await fetch(`${BASE}/api/extract`, { method: "POST" });
    const payload = await res.json().catch(() => null);
    check("no file -> 400", res.status === 400, `status=${res.status}`);
    check(
      "no file -> missing_file",
      payload?.error?.code === "missing_file",
      JSON.stringify(payload)?.slice(0, 120),
    );
  }

  // 2. non-PDF -> 400 not_a_pdf
  {
    const { res, payload } = await postFile(
      "note.txt",
      Buffer.from("just some text, not a pdf"),
      "text/plain",
    );
    check("non-PDF -> 400", res.status === 400, `status=${res.status}`);
    check(
      "non-PDF -> not_a_pdf",
      payload?.error?.code === "not_a_pdf",
      JSON.stringify(payload)?.slice(0, 120),
    );
  }

  // 3. clean doc -> 200, 5 items
  {
    const bytes = await readFile(path.join(SAMPLES, "KBS-10234.pdf"));
    const { res, payload } = await postFile(
      "KBS-10234.pdf",
      bytes,
      "application/pdf",
    );
    check("KBS-10234 -> 200", res.status === 200, `status=${res.status}`);
    const itemCount = payload?.pages?.flatMap((p) => p.items)?.length;
    check(
      "KBS-10234 -> 5 items",
      itemCount === 5,
      `items=${itemCount}`,
    );
    check(
      "KBS-10234 -> per-page document fields",
      payload?.pages?.[0]?.fields?.documentNumber?.value === "KBS-10234",
      `documentNumber=${payload?.pages?.[0]?.fields?.documentNumber?.value}`,
    );
  }

  // 4. image-only -> 200 with page_no_text refusal
  {
    const bytes = await readFile(path.join(SAMPLES, "KBS-10241.pdf"));
    const { res, payload } = await postFile(
      "KBS-10241.pdf",
      bytes,
      "application/pdf",
    );
    check("KBS-10241 -> 200", res.status === 200, `status=${res.status}`);
    const refusalCodes = payload?.pages?.flatMap((p) => p.refusals)?.map(
      (r) => r.code,
    );
    check(
      "KBS-10241 -> page_no_text refusal",
      refusalCodes?.some((c) => c === "page_no_text") === true,
      `refusals=${JSON.stringify(refusalCodes)}`,
    );
  }

  // 5. totals reconcile -> 200, stated total kept, no issues
  {
    const bytes = await readFile(path.join(SAMPLES, "KBS-10262.pdf"));
    const { res, payload } = await postFile(
      "KBS-10262.pdf",
      bytes,
      "application/pdf",
    );
    check("KBS-10262 -> 200", res.status === 200, `status=${res.status}`);
    check(
      "KBS-10262 -> stated total kept",
      payload?.pages?.[0]?.total?.value === "$5,122.40",
      `total=${payload?.pages?.[0]?.total?.value}`,
    );
    check(
      "KBS-10262 -> no issues",
      payload?.issues?.length === 0,
      `issues=${JSON.stringify(payload?.issues?.map((i) => i.code))}`,
    );
  }

  // 6. total mismatch doc -> 200 with arithmetic_mismatch issue
  {
    const bytes = await readFile(path.join(SAMPLES, "KBS-10270.pdf"));
    const { res, payload } = await postFile(
      "KBS-10270.pdf",
      bytes,
      "application/pdf",
    );
    check("KBS-10270 -> 200", res.status === 200, `status=${res.status}`);
    check(
      "KBS-10270 -> arithmetic_mismatch issue",
      payload?.issues?.some((i) => i.code === "arithmetic_mismatch") === true,
      `issues=${JSON.stringify(payload?.issues?.map((i) => i.code))}`,
    );
  }
} finally {
  server.kill();
}

if (failures > 0) {
  console.log(`\n${failures} check(s) failed`);
  process.exitCode = 1;
} else {
  console.log("\nAll smoke checks passed");
}
