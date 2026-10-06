// lib/sol-keap.js — writes one Said Out Loud opt-in into Keap: contact, tag,
// timeline note. Shared by api/sol-optin.js (first try) and
// api/sol-sync-keap.js (retries). Keap does NOT send the delivery email.
import { findOrCreateContact, applyTag, addNote } from './keap-contact.js';

export const OPT_IN_REASON = 'Speaker Nation — Said Out Loud ebook opt-in';

export function buildNote(record, tagId) {
  return {
    title: `Said Out Loud opt-in (${record.createdAt.slice(0, 10)})`,
    text: [
      'Source: onetalkworkshop.com/said-out-loud',
      `Speaks about: ${record.speakAbout || '(not given)'}`,
      `Ref: ${record.ref || '(none)'}`,
      `Tag applied: ${tagId}`,
      `Opted in: ${record.createdAt}`,
    ].join('\n'),
  };
}

export async function syncContactToKeap(record, tagId) {
  const contactId = await findOrCreateContact({
    firstName: record.firstName,
    lastName: '',
    email: record.email,
    optInReason: OPT_IN_REASON,
  });
  await applyTag(contactId, tagId);
  const { title, text } = buildNote(record, tagId);
  await addNote(contactId, title, text);
  return contactId;
}
