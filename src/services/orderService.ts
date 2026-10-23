import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import prisma from '@/lib/prisma';
import { assertBatchIds, assertBatchUnits } from '@/lib/order-policy';
import { notifyWalletDeducted } from './notificationService';

export const reviewId = (batchId: string) => 'batch-review:' + batchId;

// Submission is an unpaid review request, never admin acceptance or dispatch.
export async function createBatch(sellerId: string, orderIds: string[]) {
  assertBatchIds(orderIds);
  const receiptId = 'batch-submission:' + createHash('sha256').update(JSON.stringify([sellerId, [...orderIds].sort()])).digest('hex');
  async function recover() {
    const receipt = await prisma.log.findUnique({ where: { id: receiptId } });
    if (!receipt) return null;
    if (receipt.userId !== sellerId || receipt.action !== 'BATCH_SUBMITTED_FOR_REVIEW') throw new Error('Invalid submission receipt');
    const { batchId } = JSON.parse(receipt.details ?? '{}');
    if (typeof batchId !== 'string') throw new Error('Invalid submission receipt');
    return prisma.orderbatch.findUniqueOrThrow({ where: { id: batchId, sellerId } });
  }
  const previous = await recover();
  if (previous) return previous;
  try {
    return await prisma.$transaction(async tx => {
      const orders = await tx.order.findMany({ where: { id: { in: orderIds }, sellerId, batchId: null, status: 'CONFIRMED' }, include: { product: { select: { sellerPrice: true, stock: true } } } });
      if (orders.length !== orderIds.length) throw new Error('Some orders are ineligible or already submitted');
      assertBatchUnits(orders);
      const demand = new Map<string, number>();
      for (const order of orders) {
        if (!order.productId || !order.product) throw new Error('Product unavailable');
        demand.set(order.productId, (demand.get(order.productId) ?? 0) + order.quantity);
      }
      let total = new Prisma.Decimal(0);
      for (const order of orders) {
        if (order.product!.stock < demand.get(order.productId!)!) throw new Error('Insufficient stock');
        const price = new Prisma.Decimal(order.product!.sellerPrice);
        if (!price.isFinite() || price.lt(0)) throw new Error('Invalid product price');
        total = total.plus(price.times(order.quantity)).plus(20); // Existing per-order fee, not per unit.
      }
      const batch = await tx.orderbatch.create({ data: { sellerId, totalAmount: total, isPaid: false } });
      for (const order of orders) {
        const claim = await tx.order.updateMany({ where: { id: order.id, sellerId, batchId: null, status: 'CONFIRMED' }, data: { batchId: batch.id, status: 'WAITING_PAYMENT', shippingFee: 20 } });
        if (claim.count !== 1) throw new Error('Order eligibility changed');
      }
      await tx.orderStatusHistory.createMany({ data: orders.map(order => ({ orderId: order.id, status: 'WAITING_PAYMENT' as const, userId: sellerId })) });
      await tx.log.create({ data: { id: receiptId, userId: sellerId, action: 'BATCH_SUBMITTED_FOR_REVIEW', details: JSON.stringify({ batchId: batch.id, orderIds, units: assertBatchUnits(orders) }) } });
      return batch;
    }, { isolationLevel: 'Serializable' });
  } catch (error) {
    const saved = await recover();
    if (saved) return saved;
    throw error;
  }
}

// The log PK is the durable, mutually exclusive admin decision identity.
// No new enum or implicit approval is inferred from WAITING_PAYMENT.
export async function reviewBatch(actorId: string, batchId: string, decision: 'APPROVE' | 'REJECT', reason: string) {
  if (!reason.trim() || reason.length > 500) throw new Error('Review reason required (max 500 characters)');
  return prisma.$transaction(async tx => {
    const batch = await tx.orderbatch.findUniqueOrThrow({ where: { id: batchId } });
    const previous = await tx.log.findUnique({ where: { id: reviewId(batchId) } });
    if (previous) {
      if (previous.action === 'BATCH_' + decision) return { replayed: true };
      throw new Error('Batch already reviewed');
    }
    if (batch.isPaid) throw new Error('Paid legacy batches require separate reconciliation');
    const orders = await tx.order.findMany({ where: { batchId, sellerId: batch.sellerId } });
    assertBatchIds(orders.map(order => order.id)); assertBatchUnits(orders);
    if (orders.some(order => order.status !== 'WAITING_PAYMENT')) throw new Error('Batch is not awaiting review');
    await tx.log.create({ data: { id: reviewId(batchId), userId: actorId, action: 'BATCH_' + decision, details: JSON.stringify({ batchId, sellerId: batch.sellerId, reason: reason.trim() }) } });
    if (decision === 'REJECT') {
      const claim = await tx.order.updateMany({ where: { batchId, sellerId: batch.sellerId, status: 'WAITING_PAYMENT' }, data: { status: 'CANCELLED' } });
      if (claim.count !== orders.length) throw new Error('Batch changed');
      await tx.orderStatusHistory.createMany({ data: orders.map(order => ({ orderId: order.id, status: 'CANCELLED' as const, userId: actorId })) });
    }
    return { replayed: false };
  }, { isolationLevel: 'Serializable' });
}

export async function payBatchFromWallet(sellerId: string, batchId: string) {
  const result = await prisma.$transaction(async tx => {
    const batch = await tx.orderbatch.findUniqueOrThrow({ where: { id: batchId, sellerId } });
    if (batch.isPaid) return { batch, replayed: true, count: 0 };
    const review = await tx.log.findUnique({ where: { id: reviewId(batchId) } });
    if (review?.action !== 'BATCH_APPROVE') throw new Error('Admin approval required before payment');
    const orders = await tx.order.findMany({ where: { batchId, sellerId }, include: { product: { select: { stock: true } } } });
    assertBatchIds(orders.map(order => order.id)); assertBatchUnits(orders);
    if (orders.some(order => order.status !== 'WAITING_PAYMENT' || !order.productId || !order.product)) throw new Error('Batch not payable');
    const demand = new Map<string, number>();
    for (const order of orders) demand.set(order.productId!, (demand.get(order.productId!) ?? 0) + order.quantity);
    if (orders.some(order => order.product!.stock < demand.get(order.productId!)!)) throw new Error('Insufficient stock');
    const total = new Prisma.Decimal(batch.totalAmount);
    if (!total.isFinite() || !total.gt(0)) throw new Error('Invalid batch amount');
    const claim = await tx.orderbatch.updateMany({ where: { id: batchId, sellerId, isPaid: false }, data: { isPaid: true } });
    if (claim.count !== 1) throw new Error('Payment conflict: refresh');
    const wallet = await tx.wallet.findUniqueOrThrow({ where: { userId: sellerId } });
    const debit = await tx.wallet.updateMany({ where: { userId: sellerId, balance: { gte: total } }, data: { balance: { decrement: total } } });
    if (debit.count !== 1) throw new Error('Insufficient wallet balance');
    await tx.transaction.create({ data: { walletId: wallet.id, amount: total.negated(), type: 'ORDER_PAYMENT', referenceId: batchId } });
    const updated = await tx.order.updateMany({ where: { batchId, sellerId, status: 'WAITING_PAYMENT' }, data: { status: 'PROCESSING' } });
    if (updated.count !== orders.length) throw new Error('Batch changed');
    await tx.orderStatusHistory.createMany({ data: orders.map(order => ({ orderId: order.id, status: 'PROCESSING' as const, userId: sellerId })) });
    return { batch, replayed: false, count: orders.length };
  }, { isolationLevel: 'Serializable' });
  if (!result.replayed) void notifyWalletDeducted(sellerId, batchId, Number(result.batch.totalAmount), result.count).catch(() => console.error('Batch notification failed'));
  return true;
}
