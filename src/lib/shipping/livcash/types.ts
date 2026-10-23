export interface ParcelInput {
  ville: string;
  phone: string;
  qty: number;
  adresse: string;
  note: string;
  price: string;
  name: string;
  tracking: string;
}
export interface TrackInput { tracking: string }
export type TransportOutcome = 'not_sent' | 'response' | 'timeout' | 'network_error';
export interface RequestResult {
  transport: TransportOutcome;
  httpStatus?: number;
  code: string;
}
export type AddResult = RequestResult & (
  | { acceptance: 'accepted'; sku: string }
  | { acceptance: 'rejected'; reason: 'invalid_city' }
  | { acceptance: 'unknown' | 'not_submitted' }
);
// No carrier status interpretation is attached to an observation.
export type TrackResult = RequestResult & {
  observation: 'json' | 'unrecognized' | 'unavailable';
  data?: unknown;
};
export interface LivcashConfig {
  token: string;
  submissionEnabled: boolean;
  trackingEnabled: boolean;
  timeoutMs: number;
}
