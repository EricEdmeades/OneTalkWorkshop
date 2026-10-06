// Pure copy/state helpers for the Said Out Loud pages (unit-tested).
export const STORAGE_KEY = 'sol_email';
const RETRY_COPY = 'Something went wrong on our side. Try again in a minute.';

export function resendFeedback(status, body) {
  if (status === 200) return 'Sent again. Give it a minute.';
  return (body && typeof body.error === 'string' && body.error) || RETRY_COPY;
}

export function downloadState(search) {
  const q = new URLSearchParams(search);
  const t = q.get('t') || '';
  if (q.get('expired') === '1' || !t) return { mode: 'expired' };
  if (q.get('error') === '1') return { mode: 'error', t };
  return { mode: 'download', t };
}
