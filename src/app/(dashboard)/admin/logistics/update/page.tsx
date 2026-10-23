import { redirect } from 'next/navigation';
// Reconciliation uses the canonical, guarded delivery/return actions.
export default function DeliveryUpdatePage() { redirect('/admin/orders'); }
