import { describe, it, expect, vi } from 'vitest';

vi.mock('@vercel/blob', () => ({
  issueSignedToken: vi.fn(async () => ({ clientSigningToken: 'c', delegationToken: 'd' })),
  presignUrl: vi.fn(async () => ({ presignedUrl: 'https://store.private.blob/x?sig=1' })),
}));

const { presignPdfUrl, SOL_PDF_PATHNAME, PDF_URL_TTL_MS } = await import('./sol-pdf.js');
const blob = await import('@vercel/blob');

describe('presignPdfUrl', () => {
  it('signs a private GET for the fixed pathname, valid for 5 minutes', async () => {
    const now = 1_800_000_000_000;
    expect(await presignPdfUrl(now)).toBe('https://store.private.blob/x?sig=1');
    expect(blob.issueSignedToken).toHaveBeenCalledWith({
      pathname: SOL_PDF_PATHNAME, operations: ['get'], validUntil: now + PDF_URL_TTL_MS,
    });
    expect(blob.presignUrl).toHaveBeenCalledWith(
      { clientSigningToken: 'c', delegationToken: 'd' },
      { operation: 'get', pathname: SOL_PDF_PATHNAME, access: 'private', validUntil: now + PDF_URL_TTL_MS },
    );
    expect(PDF_URL_TTL_MS).toBe(300_000);
  });
});
