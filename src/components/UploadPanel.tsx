"use client";

import { useRef, useState } from "react";
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
  return (
    file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")
  );
}

export function UploadPanel() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [step, setStep] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<ExtractionResult | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [dragOver, setDragOver] = useState(false);

  async function extract(chosen: File) {
    setFile(chosen);
    setResult(null);
    setError(null);

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
            ? "border-sky-500 bg-sky-950/30"
            : "border-neutral-700 bg-neutral-900/40 hover:border-neutral-500"
        }`}
      >
        <p className="text-sm font-medium text-neutral-200">
          Drop a PDF here, or click to choose a file
        </p>
        <p className="mt-1 text-xs text-neutral-500">PDF only · max 10 MB</p>
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
        <div className="rounded-lg border border-sky-800 bg-sky-950/30 p-4">
          <p className="text-sm font-medium text-sky-200">
            Processing {file?.name}
          </p>
          <ul className="mt-2 space-y-1">
            {LOADING_STEPS.map((label, index) => (
              <li
                key={label}
                className={`text-sm ${
                  index <= step ? "text-sky-300" : "text-neutral-600"
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
          className="rounded-lg border border-red-800 bg-red-950/40 p-4"
        >
          <div className="flex items-center gap-2">
            <span className="rounded bg-red-900/60 px-1.5 py-0.5 font-mono text-xs text-red-300">
              {error.code}
            </span>
            <span className="text-sm font-medium text-red-200">
              Extraction could not run
            </span>
          </div>
          <p className="mt-2 text-sm leading-relaxed text-red-100">
            {error.message}
          </p>
          <button
            type="button"
            onClick={() => {
              setPhase("idle");
              setError(null);
              setFile(null);
            }}
            className="mt-3 rounded border border-red-700 px-3 py-1.5 text-xs text-red-200 hover:bg-red-900/40"
          >
            Choose another file
          </button>
        </div>
      )}

      {phase === "done" && result && <ResultView result={result} />}
    </div>
  );
}
