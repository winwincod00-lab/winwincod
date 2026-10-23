import 'server-only';
import type { AddResult, LivcashConfig, ParcelInput, TrackInput, TrackResult } from './types.js';
import { classifyAdd, validParcel, validTrack } from './validation.js';

const ENDPOINT = 'https://clients.livcash.ma/api-parcels';
const MAX_RESPONSE_BYTES = 65536;

// Only injected transport is used by offline tests. No persistence or retries here.
export function createLivcashClient(config: LivcashConfig, fetcher: typeof fetch = fetch) {
  const settings = { ...config };
  if (!Number.isInteger(settings.timeoutMs) || settings.timeoutMs < 100 || settings.timeoutMs > 60000 ||
      typeof settings.token !== 'string' || settings.token.length > 4096 || /[\s\u0000-\u001f\u007f]/.test(settings.token)) {
    throw new Error('Invalid LIVCASH server configuration.');
  }
  async function request(action: 'add' | 'track', fields: Record<string, string>) {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const operation = async () => {
      const body = new FormData();
      body.set('action', action); body.set('token', settings.token);
      for (const [key, value] of Object.entries(fields)) body.set(key, value);
      const response = await fetcher(ENDPOINT, {
        method: 'POST', body, signal: controller.signal, redirect: 'error', cache: 'no-store',
      });
      if (response.redirected || (response.status >= 300 && response.status < 400)) {
        await response.body?.cancel();
        return { transport: 'response' as const, code: 'redirect_rejected', httpStatus: response.status };
      }
      const reader = response.body?.getReader();
      const chunks: Uint8Array[] = []; let length = 0;
      if (reader) {
        try {
          while (true) {
            const part = await reader.read(); if (part.done) break;
            length += part.value.byteLength;
            if (length > MAX_RESPONSE_BYTES) {
              await reader.cancel();
              return { transport: 'response' as const, code: 'response_too_large', httpStatus: response.status };
            }
            chunks.push(part.value);
          }
        } finally { reader.releaseLock(); }
      }
      const bytes = new Uint8Array(length); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      let data: unknown;
      try { data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
      catch { return { transport: 'response' as const, code: 'invalid_response', httpStatus: response.status }; }
      if (!response.ok) return { transport: 'response' as const, code: 'http_error', httpStatus: response.status };
      return { transport: 'response' as const, code: 'response', httpStatus: response.status, data };
    };
    try {
      return await Promise.race([
        operation(),
        new Promise<{ transport: 'timeout'; code: string }>(resolve => {
          timer = setTimeout(() => { controller.abort(); resolve({ transport: 'timeout', code: 'timeout' }); }, settings.timeoutMs);
        }),
      ]);
    } catch {
      // Never propagate exceptions containing request bodies, tokens or addresses.
      return { transport: 'network_error' as const, code: 'transport_error' };
    } finally { clearTimeout(timer); }
  }
  return {
    async add(parcel: ParcelInput): Promise<AddResult> {
      if (!settings.submissionEnabled || !settings.token) return { transport: 'not_sent', acceptance: 'not_submitted', code: 'disabled' };
      if (!validParcel(parcel)) return { transport: 'not_sent', acceptance: 'not_submitted', code: 'invalid_input' };
      const result = await request('add', {
        ville: parcel.ville, phone: parcel.phone, qty: String(parcel.qty), adresse: parcel.adresse,
        note: parcel.note, price: parcel.price, name: parcel.name, tracking: parcel.tracking,
      });
      const { data, ...safe } = { data: undefined as unknown, ...result };
      const accepted = result.code === 'response' ? classifyAdd(data) : { kind: 'unknown' as const };
      if (accepted.kind === 'accepted') return { ...safe, acceptance: 'accepted', sku: accepted.sku };
      if (accepted.kind === 'invalid_city') return { ...safe, acceptance: 'rejected', reason: 'invalid_city', code: 'invalid_city' };
      return { ...safe, acceptance: 'unknown', code: accepted.kind === 'duplicate' ? 'duplicate_requires_reconciliation' : safe.code };
    },
    async track(input: TrackInput): Promise<TrackResult> {
      if (!settings.trackingEnabled || !settings.token) return { transport: 'not_sent', observation: 'unavailable', code: 'disabled' };
      if (!validTrack(input)) return { transport: 'not_sent', observation: 'unavailable', code: 'invalid_input' };
      const result = await request('track', { tracking: input.tracking });
      if ('data' in result && result.data !== null && typeof result.data === 'object') {
        // Untrusted server-side evidence only. Never render directly or interpret as status.
        return { ...result, observation: 'json' };
      }
      return {
        transport: result.transport, code: result.code,
        ...('httpStatus' in result ? { httpStatus: result.httpStatus } : {}),
        observation: result.transport === 'response' ? 'unrecognized' : 'unavailable',
      };
    },
  };
}
