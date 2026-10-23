import { normalizeMoroccanPhone } from './order-input';
export function orderReference(id: string, seqId: number | null): string {
  return seqId ? 'ORD-' + String(seqId).padStart(4, '0') : 'ORD-' + id.toUpperCase();
}
export function localOrderLookup(query: string) {
  const value = query.trim();
  const reference = value.match(/^ORD[-\s]?(\d+)$/i);
  if (reference || /^\d{1,6}$/.test(value)) {
    const seqId = Number(reference?.[1] ?? value);
    return Number.isSafeInteger(seqId) && seqId > 0 ? { seqId } : null;
  }
  const id = value.replace(/^ORD-/i, '');
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return { id: id.toLowerCase() };
  const phone = normalizeMoroccanPhone(value);
  if (/^0[5-7]\d{8}$/.test(phone)) return { customerPhone: { in: [phone, '+212' + phone.slice(1), '00212' + phone.slice(1)] } };
  return null;
}
