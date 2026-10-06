// lib/sol-store.js — every Blob read/write for the Said Out Loud funnel.
// All blobs are private. Paths are keyed by a one-way email hash so no raw
// address appears in a pathname; pending records do hold the email and name
// because api/sol-sync-keap.js needs them to write Keap.
import { put, get, list, del } from '@vercel/blob';
import { emailHash } from './email-hash.js';
import { normaliseEmail } from './sol-validate.js';
import { parsePending } from './sol-pending.js';

const key = (dir, email) => `sol/${dir}/${emailHash(normaliseEmail(email))}.json`;

async function readText(pathname) {
  const result = await get(pathname, { access: 'private', useCache: false });
  if (!result || result.statusCode !== 200 || !result.stream) return null;
  return new Response(result.stream).text();
}

async function readJson(pathname) {
  const text = await readText(pathname);
  return text ? JSON.parse(text) : null;
}

async function writeJson(pathname, value) {
  await put(pathname, JSON.stringify(value), {
    access: 'private',
    contentType: 'application/json',
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 60,
  });
}

export async function readOptin(email) {
  return readJson(key('optins', email));
}

export async function writeOptin(email, { firstName, now }) {
  await writeJson(key('optins', email), { firstName, createdAt: new Date(now).toISOString() });
}

export async function readRate(email) {
  const data = await readJson(key('rate', email));
  return Array.isArray(data?.sentAt) ? data.sentAt : [];
}

export async function writeRate(email, sentAt) {
  await writeJson(key('rate', email), { sentAt });
}

export function pendingPath(record) {
  const ms = String(Date.parse(record.createdAt)).padStart(13, '0');
  return `sol/pending/${ms}-${emailHash(record.email)}.json`;
}

export async function writePending(record, pathname = pendingPath(record)) {
  await writeJson(pathname, record);
  return pathname;
}

export async function listPending(limit = 25) {
  const { blobs } = await list({ prefix: 'sol/pending/' });
  return blobs.map((b) => b.pathname).sort().slice(0, limit);
}

export async function readPending(pathname) {
  return parsePending(await readText(pathname));
}

export async function deletePending(pathname) {
  await del(pathname);
}

export async function moveToDead(pathname, record) {
  const name = pathname.split('/').pop();
  await writeJson(`sol/dead/${name}`, record ?? { unreadable: pathname });
  await del(pathname);
}
