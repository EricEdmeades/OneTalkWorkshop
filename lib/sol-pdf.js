// lib/sol-pdf.js — short-lived URL for the private ebook PDF. The project's
// Blob store is private at the store level, so the PDF is private too; a
// download is a 5-minute presigned GET minted per click by api/sol-download.js.
// Streaming through the function is not an option: responses cap at ~4.5 MB
// and the PDF is ~18.6 MB.
import { issueSignedToken, presignUrl } from '@vercel/blob';

// Matches the dashboard upload (2026-10-06). The download saves under this name.
export const SOL_PDF_PATHNAME = 'said-out-loud/Book.SaidOutLoud.EricEdmeades.pdf';
export const PDF_URL_TTL_MS = 5 * 60 * 1000;

export async function presignPdfUrl(now = Date.now()) {
  const validUntil = now + PDF_URL_TTL_MS;
  const token = await issueSignedToken({ pathname: SOL_PDF_PATHNAME, operations: ['get'], validUntil });
  const { presignedUrl } = await presignUrl(token, {
    operation: 'get',
    pathname: SOL_PDF_PATHNAME,
    access: 'private',
    validUntil,
  });
  return presignedUrl;
}
