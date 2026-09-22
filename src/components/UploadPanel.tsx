"use client";

import { useEffect, useRef, useState } from "react";
import type { ExtractionResult } from "@/server/extract/types";
import { ResultView } from "./ResultView";

const MAX_BYTES = 10 * 1024 * 1024;

const LOADING_STEPS = [
  "Uploading file…",
  "Reading pages…",
  "Structuring line items…",
  "Checking every number against its source…",
] as const;

type Phase = "idle" | "loading" | "done" | "error";

type ApiError = { code: string; message: string };

function isPdfFile(file: File): boolean {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

export function UploadPanel() {
  const inputRef = useRef<HTMLInputElement>(null);
  const pdfUrlRef = useRef<string | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [step, setStep] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [result, setResult] = useState<ExtractionResult | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    return () => {
      if (pdfUrlRef.current) URL.revokeObjectURL(pdfUrlRef.current);
    };
  }, []);

  async function extract(chosen: File) {
    setFile(chosen);
    setResult(null);
    setError(null);
    if (pdfUrlRef.current) {
      URL.revokeObjectURL(pdfUrlRef.current);
      pdfUrlRef.current = null;
    }
    setPdfUrl(null);

    if (!isPdfFile(chosen)) {
      setPhase("error");
      setError({
        code: "not_pdf",
        message: `"${chosen.name}" is not a PDF. Only PDF files can be read by this tool.`,
      });
      return;
    }
    if (chosen.size > MAX_BYTES) {
      setPhase("error");
      setError({
        code: "too_large",
        message: `"${chosen.name}" is ${Math.round(chosen.size / (1024 * 1024))} MB. The limit is 10 MB — this file was not uploaded.`,
      });
      return;
    }

    setPhase("loading");
    setStep(0);
    const timer = window.setInterval(() => {
      setStep((s) => Math.min(s + 1, LOADING_STEPS.length - 1));
    }, 700);

    try {
      const body = new FormData();
      body.append("file", chosen);
      const response = await fetch("/api/extract", {
        method: "POST",
        body,
      });
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        const message =
          payload?.error?.message ??
          `The server returned HTTP ${response.status} without a reason.`;
        const code = payload?.error?.code ?? `http_${response.status}`;
        setPhase("error");
        setError({ code, message });
        return;
      }

      // The viewer renders from the uploaded file itself (zero bytes
      // transferred, zero decoding) — the API response carries only data.
      const url = URL.createObjectURL(chosen);
      pdfUrlRef.current = url;
      setPdfUrl(url);

      setResult(payload as ExtractionResult);
      setPhase("done");
    } catch (err) {
      setPhase("error");
      setError({
        code: "network",
        message:
          err instanceof Error
            ? `Could not reach the extraction service: ${err.message}`
            : "Could not reach the extraction service for an unknown reason.",
      });
    } finally {
      window.clearInterval(timer);
    }
  }

  return (
    <div className="space-y-8">
      <div
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const chosen = e.dataTransfer.files[0];
          if (chosen) void extract(chosen);
        }}
        className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-10 text-center transition-colors ${
          dragOver
            ? "border-blue-400 bg-blue-50"
            : "border-neutral-300 bg-neutral-50 hover:border-neutral-400 hover:bg-white"
        }`}
      >
        <p className="text-base font-medium text-neutral-900">
          Drop a PDF here, or click to choose a file
        </p>
        <p className="mt-1 text-sm text-neutral-500">
          PDF only · max 10 MB · nothing is stored after extraction
        </p>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          onChange={(e) => {
            const chosen = e.target.files?.[0];
            if (chosen) void extract(chosen);
            e.target.value = "";
          }}
        />
      </div>

      {phase === "loading" && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
          <p className="text-[15px] font-medium text-blue-950">
            Processing {file?.name}
          </p>
          <ul className="mt-2 space-y-1">
            {LOADING_STEPS.map((label, index) => (
              <li
                key={label}
                className={`text-[15px] ${
                  index <= step ? "text-blue-900" : "text-neutral-400"
                }`}
              >
                {index <= step ? `✓ ${label}` : `· ${label}`}
              </li>
            ))}
          </ul>
        </div>
      )}

      {phase === "error" && error && (
        <div
          role="alert"
          className="rounded-lg border border-red-300 bg-red-50 p-4"
        >
          <div className="flex items-center gap-2">
            <span className="rounded border border-red-200 bg-red-100 px-1.5 py-0.5 font-mono text-xs text-red-900">
              {error.code}
            </span>
            <span className="text-[15px] font-medium text-red-950">
              Extraction could not run
            </span>
          </div>
          <p className="mt-2 text-[15px] leading-relaxed text-red-900">
            {error.message}
          </p>
          <button
            type="button"
            onClick={() => {
              setPhase("idle");
              setError(null);
              setFile(null);
            }}
            className="mt-3 rounded-md border border-red-300 bg-white px-3 py-1.5 text-sm text-red-800 hover:bg-red-100"
          >
            Choose another file
          </button>
        </div>
      )}

      {phase === "done" && result && (
        <ResultView result={result} pdfUrl={pdfUrl} />
      )}
    </div>
  );
}
