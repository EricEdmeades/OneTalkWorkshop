import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { isBlobConfigured } from './keap-store.js';

// Regression guard. A Blob store connected in the dashboard provisions
// BLOB_STORE_ID and authenticates with the runtime OIDC token; it does not
// necessarily set BLOB_READ_WRITE_TOKEN. An earlier version checked only for
// the read-write token, so a correctly connected store reported "not
// configured" and the whole Keap refresh silently never ran — which looks like
// an operator mistake rather than a bug in here.
describe('isBlobConfigured', () => {
  const saved = {
    token: process.env.BLOB_READ_WRITE_TOKEN,
    storeId: process.env.BLOB_STORE_ID,
  };

  beforeEach(() => {
    delete process.env.BLOB_READ_WRITE_TOKEN;
    delete process.env.BLOB_STORE_ID;
  });

  afterEach(() => {
    if (saved.token === undefined) delete process.env.BLOB_READ_WRITE_TOKEN;
    else process.env.BLOB_READ_WRITE_TOKEN = saved.token;
    if (saved.storeId === undefined) delete process.env.BLOB_STORE_ID;
    else process.env.BLOB_STORE_ID = saved.storeId;
  });

  it('accepts the static read-write token', () => {
    process.env.BLOB_READ_WRITE_TOKEN = 'vercel_blob_rw_test';
    expect(isBlobConfigured()).toBe(true);
  });

  it('accepts an OIDC-authenticated store, which has only BLOB_STORE_ID', () => {
    process.env.BLOB_STORE_ID = 'store_tIFOZ47wzXnW';
    expect(isBlobConfigured()).toBe(true);
  });

  it('accepts both being present', () => {
    process.env.BLOB_READ_WRITE_TOKEN = 'vercel_blob_rw_test';
    process.env.BLOB_STORE_ID = 'store_tIFOZ47wzXnW';
    expect(isBlobConfigured()).toBe(true);
  });

  it('reports unconfigured only when neither credential exists', () => {
    expect(isBlobConfigured()).toBe(false);
  });

  it('treats an empty string as unconfigured', () => {
    process.env.BLOB_READ_WRITE_TOKEN = '';
    process.env.BLOB_STORE_ID = '';
    expect(isBlobConfigured()).toBe(false);
  });
});
