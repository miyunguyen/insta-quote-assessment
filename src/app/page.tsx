import { UploadPanel } from "@/components/UploadPanel";

export default function Home() {
  return (
    <div className="min-h-screen bg-white font-sans text-neutral-900">
      <main className="mx-auto w-full max-w-5xl px-6 py-12">
        <header className="mb-10">
          <h1 className="text-3xl font-semibold tracking-tight">
            Line items extractor
          </h1>
          <p className="mt-3 max-w-2xl text-base leading-relaxed text-neutral-600">
            Upload a PDF to extract the data.
          </p>
        </header>

        <UploadPanel />
      </main>
    </div>
  );
}
