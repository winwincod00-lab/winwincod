import type { ParcelInput, TrackInput } from './types.js';

function text(value: unknown, max: number, empty = false): value is string {
  return typeof value === 'string' && value.length <= max &&
    (empty || value.trim().length > 0) && !/[\u0000-\u001f\u007f]/.test(value);
}
export function validTracking(value: unknown): value is string {
  return text(value, 128) && value === value.trim();
}
export function validPrice(value: unknown): value is string {
  // Application safety limit, not a claimed carrier limit. Never round money.
  return typeof value === 'string' && value.length <= 32 &&
    /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value);
}
export function validTrack(input: TrackInput): boolean {
  return !!input && validTracking(input.tracking);
}
export function validParcel(input: ParcelInput): boolean {
  return !!input && text(input.ville, 120) && text(input.name, 200) &&
    text(input.adresse, 1000) && text(input.note, 1000, true) &&
    typeof input.phone === 'string' && /^(?:0[5-7]\d{8}|\+212[5-7]\d{8}|00212[5-7]\d{8})$/.test(input.phone) &&
    Number.isSafeInteger(input.qty) && input.qty > 0 && input.qty <= 10000 &&
    validPrice(input.price) && validTracking(input.tracking);
}
export function classifyAdd(data: unknown):
  { kind: 'accepted'; sku: string } | { kind: 'invalid_city' | 'duplicate' | 'unknown' } {
  if (!data || typeof data !== 'object') return { kind: 'unknown' };
  const value = data as Record<string, unknown>;
  if (value.status === true && value.msg === 'ajouté avec succès' && validTracking(value.sku)) {
    return { kind: 'accepted', sku: value.sku };
  }
  if (value.status === false && value.msg === 'Ville introuvable') return { kind: 'invalid_city' };
  if (value.status === false && value.msg === 'code de suivi déjà utilisé') return { kind: 'duplicate' };
  return { kind: 'unknown' };
}
