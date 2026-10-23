// Seller actions stop before payment, warehouse dispatch and reconciliation.
export function sellerTransitions(status: string, batchId: string | null = null): string[] {
  if (batchId) return [];
  if (status === 'DRAFT') return ['PENDING_CONFIRMATION', 'CANCELLED'];
  if (status === 'PENDING_CONFIRMATION') return ['CONFIRMED', 'CANCELLED'];
  if (status === 'CONFIRMED') return ['CANCELLED'];
  return [];
}

export function assertBatchIds(ids: unknown): asserts ids is string[] {
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 500 ||
      ids.some(id => typeof id !== 'string' || !id.trim()) || new Set(ids).size !== ids.length) {
    throw new Error('اختر طلبات مختلفة وصالحة (500 كحد أقصى)');
  }
}

// Call only after tenant, confirmation and unbatched eligibility are verified.
export function assertBatchUnits(lines: { quantity: number }[]) {
  if (lines.some(line => !Number.isSafeInteger(line.quantity) || line.quantity < 1)) throw new Error('Invalid product quantity');
  const units = lines.reduce((sum, line) => sum + line.quantity, 0);
  if (!Number.isSafeInteger(units) || units < 5) throw new Error('Minimum 5 PCS / خمس وحدات على الأقل');
  return units;
}
