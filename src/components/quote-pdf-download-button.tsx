"use client";

import { useState } from "react";

import { generateQuotePdf } from "@/lib/pdf/quote-pdf";
import type { QuotePdfSnapshot } from "@/lib/pdf/quote-pdf-types";

import { primaryButtonClass } from "./ui";

export function QuotePdfDownloadButton({
  snapshot,
  className,
}: {
  snapshot: QuotePdfSnapshot;
  className?: string;
}) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  async function downloadPdf() {
    setErrorMessage("");
    setIsGenerating(true);

    try {
      const bytes = await generateQuotePdf(snapshot);
      const blob = new Blob([new Uint8Array(bytes)], { type: "application/pdf" });
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = `Nahuitech-Cotizacion-${snapshot.folio}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
    } catch {
      setErrorMessage("No se pudo generar el PDF. Intenta nuevamente.");
    } finally {
      setIsGenerating(false);
    }
  }

  return (
    <div className="grid gap-2">
      <button
        className={`${primaryButtonClass} ${className ?? ""}`}
        disabled={isGenerating}
        onClick={downloadPdf}
        type="button"
      >
        <span aria-hidden="true">↓</span>
        {isGenerating ? "Generando PDF..." : "Descargar PDF"}
      </button>
      {errorMessage ? (
        <p aria-live="polite" className="text-center text-sm font-semibold text-danger" role="alert">
          {errorMessage}
        </p>
      ) : null}
    </div>
  );
}
