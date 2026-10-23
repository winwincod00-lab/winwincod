import 'server-only';
import type { LivcashConfig } from './livcash/types.js';

export function readLivcashConfig(env: Record<string, string | undefined> = process.env): LivcashConfig {
  const timeout = env.LIVCASH_TIMEOUT_MS === undefined ? 15000 : Number(env.LIVCASH_TIMEOUT_MS);
  const token = env.LIVCASH_API_TOKEN ?? '';
  if (!Number.isInteger(timeout) || timeout < 100 || timeout > 60000 ||
      token.length > 4096 || /[\s\u0000-\u001f\u007f]/.test(token)) {
    throw new Error('Invalid LIVCASH server configuration.');
  }
  return {
    token,
    submissionEnabled: env.LIVCASH_SUBMISSION_ENABLED === 'true' && token.length > 0,
    trackingEnabled: env.LIVCASH_TRACKING_ENABLED === 'true' && token.length > 0,
    timeoutMs: timeout,
  };
}
