import { UploadPanel } from "@/components/UploadPanel";

export default function Home() {
  return (
    <div className="min-h-full bg-neutral-950 font-sans text-neutral-100">
      <main className="mx-auto w-full max-w-5xl px-6 py-12">
        <header className="mb-10">
          <h1 className="text-2xl font-semibold tracking-tight">
            Packing-list extractor
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-neutral-400">
            Upload a packing-list or delivery-docket PDF file.
          </p>
        </header>

        <UploadPanel />
      </main>
    </div>
  );
}
