// /api/sol-download?t=<token> — verifies the emailed link and redirects to a
// 5-minute presigned URL for the private PDF. Every failure lands the visitor
// on the branded download page in a recoverable state, never on a raw error.
import { verifyToken } from '../lib/sol-token.js';
import { presignPdfUrl } from '../lib/sol-pdf.js';

const PAGE = '/said-out-loud/download';

function redirect(res, location) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Location', location);
  return res.status(302).end();
}

export default async function handler(req, res) {
  const secret = process.env.SOL_LINK_SECRET;
  if (!secret) {
    console.error('[sol-download] SOL_LINK_SECRET is not set');
    return res.status(500).send('Server is not configured.');
  }
  const t = typeof req.query?.t === 'string' ? req.query.t : '';
  if (!verifyToken(t, secret)) return redirect(res, `${PAGE}?expired=1`);
  try {
    return redirect(res, await presignPdfUrl());
  } catch (err) {
    console.error(`[sol-download] Presign failed: ${err?.message || err}`);
    return redirect(res, `${PAGE}?error=1&t=${encodeURIComponent(t)}`);
  }
}
