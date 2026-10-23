import { createHash } from 'node:crypto';
import prisma from '@/lib/prisma';
import { assertBatchIds } from '@/lib/order-policy';
import { eligibleDraft } from '@/lib/draft-selection';
import { BULK_DRAFT_CONFIRMATION_ENABLED } from '@/lib/checkout-release';

export class DraftConfirmationError extends Error {
  constructor(message: string, public status = 409) { super(message); }
}
// No financial/stock effects. This is DRAFT -> PENDING_CONFIRMATION only.
export async function submitDraftsForConfirmation(sellerId: string, key: string | null, orderIds: string[]) {
  if (!BULK_DRAFT_CONFIRMATION_ENABLED) throw new DraftConfirmationError('Bulk confirmation is not available in this release', 503);
  assertBatchIds(orderIds);
  if (!key || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key)) throw new DraftConfirmationError('Invalid submission key', 400);
  const ids = [...orderIds].sort();
  const fingerprint = createHash('sha256').update(JSON.stringify(ids)).digest('hex');
  const receiptId = 'draft-confirmation:' + createHash('sha256').update(JSON.stringify([sellerId, key.toLowerCase()])).digest('hex');
  async function recover() {
    const receipt = await prisma.log.findUnique({ where: { id: receiptId } });
    if (!receipt) return null;
    if (receipt.userId !== sellerId || receipt.action !== 'DRAFTS_SENT_FOR_CONFIRMATION') throw new DraftConfirmationError('Invalid submission receipt');
    const saved: { fingerprint?: string; orderIds?: unknown } = JSON.parse(receipt.details ?? '{}');
    if (saved.fingerprint !== fingerprint || JSON.stringify(saved.orderIds) !== JSON.stringify(ids)) throw new DraftConfirmationError('Submission key already used for another selection');
    return { orderIds: ids, replayed: true };
  }
  const previous = await recover();
  if (previous) return previous;
  try {
    return await prisma.$transaction(async tx => {
      await tx.log.create({ data: { id: receiptId, userId: sellerId, action: 'DRAFTS_SENT_FOR_CONFIRMATION', details: JSON.stringify({ fingerprint, orderIds: ids }) } });
      const orders = await tx.order.findMany({ where: { id: { in: ids }, sellerId, status: 'DRAFT', batchId: null }, select: { id: true, quantity: true, status: true, batchId: true } });
      if (orders.length !== ids.length || orders.some(order => !eligibleDraft(order))) throw new DraftConfirmationError('Selection changed or contains ineligible orders');
      const changed = await tx.order.updateMany({ where: { id: { in: ids }, sellerId, status: 'DRAFT', batchId: null }, data: { status: 'PENDING_CONFIRMATION' } });
      if (changed.count !== ids.length) throw new DraftConfirmationError('Selection changed; refresh before retry');
      await tx.orderStatusHistory.createMany({ data: ids.map(orderId => ({ orderId, userId: sellerId, status: 'PENDING_CONFIRMATION' as const })) });
      return { orderIds: ids, replayed: false };
    }, { isolationLevel: 'Serializable' });
  } catch (error) {
    const saved = await recover();
    if (saved) return saved;
    if (error instanceof DraftConfirmationError) throw error;
    throw new DraftConfirmationError('Outcome uncertain; retry the same selection or refresh', 503);
  }
}
