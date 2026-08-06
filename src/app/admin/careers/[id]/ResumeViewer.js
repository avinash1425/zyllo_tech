"use client";

import { useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import { ChevronLeft, ChevronRight, Loader2, AlertCircle } from "lucide-react";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

export default function ResumeViewer({ url }) {
  const [numPages, setNumPages] = useState(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [error, setError] = useState(false);
  const [containerWidth, setContainerWidth] = useState(null);

  function handleContainerRef(node) {
    if (node) setContainerWidth(node.clientWidth);
  }

  return (
    <div>
      <div
        ref={handleContainerRef}
        className="flex min-h-[420px] items-center justify-center overflow-hidden rounded-xl border border-[#e7e9ee] bg-[#f5f6f8] p-3"
      >
        {error ? (
          <div className="flex flex-col items-center gap-2 py-16 text-center">
            <AlertCircle className="h-6 w-6 text-[#676b7a]/50" aria-hidden="true" />
            <p className="text-sm text-[#676b7a]">
              Couldn&apos;t preview this resume. Try downloading it instead.
            </p>
          </div>
        ) : (
          <Document
            file={url}
            onLoadSuccess={({ numPages: total }) => {
              setNumPages(total);
              setPageNumber(1);
            }}
            onLoadError={() => setError(true)}
            loading={
              <div className="flex items-center gap-2 py-16 text-sm text-[#676b7a]">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Loading resume…
              </div>
            }
          >
            <Page
              pageNumber={pageNumber}
              width={containerWidth ? Math.min(containerWidth - 24, 560) : 400}
              renderAnnotationLayer={false}
              renderTextLayer={false}
              className="[&>canvas]:mx-auto [&>canvas]:rounded-lg [&>canvas]:shadow-sm"
            />
          </Document>
        )}
      </div>

      {numPages > 1 && (
        <div className="mt-3 flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => setPageNumber((p) => Math.max(1, p - 1))}
            disabled={pageNumber <= 1}
            aria-label="Previous page"
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#e7e9ee] text-[#676b7a] transition-colors hover:border-[#f7941e]/40 hover:text-[#f7941e] disabled:pointer-events-none disabled:opacity-40"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </button>
          <span className="text-sm font-medium text-[#676b7a]">
            Page {pageNumber} of {numPages}
          </span>
          <button
            type="button"
            onClick={() => setPageNumber((p) => Math.min(numPages, p + 1))}
            disabled={pageNumber >= numPages}
            aria-label="Next page"
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#e7e9ee] text-[#676b7a] transition-colors hover:border-[#f7941e]/40 hover:text-[#f7941e] disabled:pointer-events-none disabled:opacity-40"
          >
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
}
