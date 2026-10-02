import type { NodeId } from './types';

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

/** Short random ids. They are persisted as `data-pl-id` attributes, so keep them readable. */
export function createId(): NodeId {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  let id = '';
  for (const byte of bytes) id += ALPHABET[byte % ALPHABET.length];
  return id;
}
