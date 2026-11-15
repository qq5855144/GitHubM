/// <reference types="vite/client" />
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

export const MAX_PDF_BYTES = 10 * 1024 * 1024;
export const MAX_PDF_PAGES = 80;

export async function extractPdfText(data: ArrayBuffer): Promise<string> {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const doc = await pdfjs.getDocument({ data }).promise;
  const pages = Math.min(doc.numPages, MAX_PDF_PAGES);
  const parts: string[] = [];
  for (let pageNumber = 1; pageNumber <= pages; pageNumber++) {
    const page = await doc.getPage(pageNumber);
    const content = await page.getTextContent();
    const text = content.items
      .map(item => ('str' in item ? item.str : ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (text) parts.push(`[第 ${pageNumber} 页]\n${text}`);
  }
  await doc.destroy();
  return parts.join('\n\n');
}