import { z } from 'zod';
import { customerFields, codInput, quantityInput } from './order-input';

export const allocationInput = z.object({
  cart: z.array(z.object({ productId: z.string().min(1), quantity: quantityInput })).min(1).max(500),
  customers: z.array(z.object({ ...customerFields, codAmount: codInput,
    allocations: z.array(z.object({ productId: z.string().min(1), quantity: quantityInput })).min(1).max(500),
  })).min(1).max(500),
});
export type AllocationInput = z.input<typeof allocationInput>;

export function allocationTotals(cart: { productId: string; quantity: number }[], customers: { allocations: { productId: string; quantity: number | string }[] }[]) {
  const totals = new Map<string, { total: number; allocated: number }>();
  for (const item of cart) {
    const row = totals.get(item.productId) ?? { total: 0, allocated: 0 };
    row.total += item.quantity; totals.set(item.productId, row);
  }
  for (const customer of customers) for (const line of customer.allocations) {
    const row = totals.get(line.productId);
    if (row) row.allocated += Number(line.quantity) || 0;
  }
  return [...totals].map(([productId, row]) => ({ productId, ...row, remaining: row.total - row.allocated }));
}

// The current order model supports one SKU. Never split a customer's COD or
// create phantom multi-line orders with missing inventory/cost relationships.
export function allocationOrders(raw: unknown) {
  const parsed = allocationInput.safeParse(raw);
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'Client incomplet');
  const { cart, customers } = parsed.data;
  const products = new Set(cart.map(item => item.productId));
  for (const customer of customers) {
    if (customer.allocations.length !== 1) throw new Error('Un seul SKU par client est pris en charge. Les commandes multi-SKU nécessitent une évolution du modèle.');
    if (customer.allocations.some(line => !products.has(line.productId))) throw new Error('SKU absent du panier');
  }
  if (allocationTotals(cart, customers).some(row => row.remaining !== 0)) throw new Error('Répartissez exactement toutes les unités de chaque SKU');
  return customers.map(({ allocations, ...customer }) => ({ ...customer, ...allocations[0] }));
}
