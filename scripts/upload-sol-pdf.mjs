#!/usr/bin/env node
// Uploads the Said Out Loud PDF to the project's private Blob store at the
// fixed pathname lib/sol-pdf.js presigns. Re-run to replace the book.
//
//   vercel env pull .env.local --environment=production   # BLOB_READ_WRITE_TOKEN
//   node --env-file=.env.local scripts/upload-sol-pdf.mjs <path-to-pdf>
import { readFile } from 'node:fs/promises';
import { put } from '@vercel/blob';
import { SOL_PDF_PATHNAME } from '../lib/sol-pdf.js';

const path = process.argv[2];
if (!path) {
  console.error('Usage: node scripts/upload-sol-pdf.mjs <path-to-pdf>');
  process.exit(1);
}
const bytes = await readFile(path);
if (bytes.subarray(0, 5).toString() !== '%PDF-') {
  console.error(`${path} is not a PDF (missing %PDF- header)`);
  process.exit(1);
}
const blob = await put(SOL_PDF_PATHNAME, bytes, {
  access: 'private',
  contentType: 'application/pdf',
  addRandomSuffix: false,
  allowOverwrite: true,
  multipart: true,
});
console.log(`Uploaded ${(bytes.length / 1e6).toFixed(1)} MB → ${blob.pathname}`);
