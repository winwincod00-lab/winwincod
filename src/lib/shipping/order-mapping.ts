import type { ParcelInput } from './livcash/types.js';
import { validParcel } from './livcash/validation.js';

export interface ApprovedOrderSnapshot {
  customerName: string;
  customerPhone: string;
  city: string;
  address: string;
  quantity: number;
  codAmount: string;
  note?: string;
}
// Approval/payment must be verified by the future persistence service.
export function mapApprovedOrder(snapshot: ApprovedOrderSnapshot, stableTracking: string): ParcelInput {
  const parcel: ParcelInput = {
    ville: snapshot.city, phone: snapshot.customerPhone, qty: snapshot.quantity,
    adresse: snapshot.address, note: snapshot.note ?? '', price: snapshot.codAmount,
    name: snapshot.customerName, tracking: stableTracking,
  };
  if (!validParcel(parcel)) throw new Error('Invalid parcel snapshot.');
  return parcel;
}
