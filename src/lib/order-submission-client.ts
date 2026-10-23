// Persist only a digest and random retry key, never customer fields.
export async function submissionKey(sellerId: string, source: string, payload: unknown, storage: Storage = sessionStorage): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(payload)));
  const digest = Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
  const slot = 'winwin-submission:' + encodeURIComponent(sellerId) + ':' + source;
  const raw = storage.getItem(slot);
  if (raw) {
    try {
      const previous = JSON.parse(raw);
      if (previous.digest === digest && typeof previous.key === 'string') return previous.key;
    } catch { /* replace malformed retry metadata */ }
  }
  const key = crypto.randomUUID();
  storage.setItem(slot, JSON.stringify({ digest, key }));
  return key;
}
export function clearSubmissionKey(sellerId: string, source: string, storage: Storage = sessionStorage) {
  storage.removeItem('winwin-submission:' + encodeURIComponent(sellerId) + ':' + source);
}
