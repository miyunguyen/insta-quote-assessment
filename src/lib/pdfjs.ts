// Minimal structural types for the pdf.js API surface we use, plus lazy
// loading with a single-entry document cache. Framework-free apart from the
// dynamic import, which runs client-side (this module is only imported by
// client components).
//
// Types are structural on purpose: the component does not depend on
// pdfjs-dist's exported type names.

export type PdfTextItem = {
  str: string;
  transform: number[];
  width: number;
  height: number;
};

export type PdfViewport = {
  width: number;
  height: number;
  scale: number;
  convertToViewportPoint: (x: number, y: number) => [number, number];
};

export type PdfPage = {
  getViewport: (options: { scale: number }) => PdfViewport;
  render: (options: {
    canvasContext: CanvasRenderingContext2D;
    viewport: PdfViewport;
  }) => { promise: Promise<void>; cancel: () => void };
  getTextContent: () => Promise<{ items: unknown[] }>;
};

export type PdfDocument = {
  numPages: number;
  getPage: (pageNumber: number) => Promise<PdfPage>;
  destroy: () => Promise<void>;
};

export type PdfJsModule = {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument: (options: { url: string }) => {
    promise: Promise<unknown>;
    destroy: () => Promise<void>;
  };
};

// Lazily loaded pdf.js module (client only, split into its own chunk).
let pdfjsPromise: Promise<PdfJsModule> | null = null;
export function loadPdfjs(): Promise<PdfJsModule> {
  if (!pdfjsPromise) {
    pdfjsPromise = import("pdfjs-dist").then((module) => {
      const pdfjs = module as unknown as PdfJsModule;
      pdfjs.GlobalWorkerOptions.workerSrc = new URL(
        "pdfjs-dist/build/pdf.worker.min.mjs",
        import.meta.url,
      ).toString();
      return pdfjs;
    });
  }
  return pdfjsPromise;
}

// Single-entry document cache: destroyed whenever a different PDF is opened.
let cachedUrl: string | null = null;
let cachedDoc: Promise<PdfDocument> | null = null;
export async function getDocument(
  pdfjs: PdfJsModule,
  url: string,
): Promise<PdfDocument> {
  if (cachedDoc && cachedUrl === url) return cachedDoc;
  if (cachedDoc) {
    const old = cachedDoc;
    cachedDoc = null;
    cachedUrl = null;
    old.then((doc) => doc.destroy()).catch(() => {});
  }
  const task = pdfjs.getDocument({ url });
  cachedDoc = task.promise.then((doc) => doc as PdfDocument);
  cachedUrl = url;
  return cachedDoc;
}
