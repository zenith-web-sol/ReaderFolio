// Loads the bundled PDF.js build (vendor/pdfjs) and exposes a single open helper.
import * as pdfjsLib from '../vendor/pdfjs/pdf.min.mjs';

const BASE = new URL('../vendor/pdfjs/', import.meta.url).href;
pdfjsLib.GlobalWorkerOptions.workerSrc = `${BASE}pdf.worker.min.mjs`;

export const pdfjs = pdfjsLib;

/** Open a PDF from an ArrayBuffer. The buffer is copied because PDF.js transfers it to its worker. */
export function openPdf(arrayBuffer) {
  const task = pdfjsLib.getDocument({
    data: new Uint8Array(arrayBuffer.slice(0)),
    cMapUrl: `${BASE}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${BASE}standard_fonts/`,
    wasmUrl: `${BASE}wasm/`,
    iccUrl: `${BASE}iccs/`,
    isEvalSupported: false,
  });
  return task.promise;
}
