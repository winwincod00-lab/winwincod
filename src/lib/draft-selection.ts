export type SelectableDraft = { id: string; quantity: number; status: string; batchId: string | null };
export function eligibleDraft(order: SelectableDraft): boolean {
  return order.status === 'DRAFT' && order.batchId === null && Number.isSafeInteger(order.quantity) && order.quantity > 0;
}
export function selectedDrafts<T extends SelectableDraft>(visible: readonly T[], ids: readonly string[]) {
  const unique = new Set(ids);
  const orders = visible.filter(order => unique.has(order.id) && eligibleDraft(order));
  return { orders, count: orders.length, units: orders.reduce((sum, order) => sum + order.quantity, 0) };
}
