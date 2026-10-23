import { createHash } from 'node:crypto';
import prisma from '@/lib/prisma';
import type { DraftInput } from '@/lib/order-input';

const ACTION = 'SELLER_DRAFT_SUBMISSION';
export class OrderSubmissionError extends Error {
  constructor(message: string, public status = 409) { super(message); }
}

// Existing log PK provides the unique submission claim; claim, drafts and history
// commit together. No PII, credentials or full request bodies go into the log.
export async function createDraftSubmission(sellerId: string, key: string | null, source: 'single' | 'bulk' | 'import', orders: DraftInput[]) {
  if (!key || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key)) {
    throw new OrderSubmissionError('مفتاح حفظ الطلب مفقود. حدّث الصفحة قبل الإرسال', 400);
  }
  const canonical = orders.map(o => ({ productId: o.productId, customerName: o.customerName, customerPhone: o.customerPhone,
    address: o.address, city: o.city, quantity: o.quantity, codAmount: o.codAmount ?? null }));
  const fingerprint = createHash('sha256').update(JSON.stringify({ source, orders: canonical })).digest('hex');
  const id = 'seller-submission:' + createHash('sha256').update(JSON.stringify([sellerId, key.toLowerCase()])).digest('hex');
  function recover(log: { userId: string; action: string; details: string | null } | null): string[] | null {
    if (!log) return null;
    if (log.userId !== sellerId || log.action !== ACTION) throw new OrderSubmissionError('تعذر التحقق من عملية الحفظ');
    let saved: { fingerprint?: string; orderIds?: unknown };
    try { saved = JSON.parse(log.details ?? '{}'); } catch { throw new OrderSubmissionError('تعذر التحقق من عملية الحفظ'); }
    if (saved.fingerprint !== fingerprint) throw new OrderSubmissionError('تم استعمال مفتاح الحفظ لبيانات أخرى. راجع المسودات قبل إنشاء طلب جديد');
    if (!Array.isArray(saved.orderIds) || saved.orderIds.length !== orders.length || !saved.orderIds.every(value => typeof value === 'string')) {
      throw new OrderSubmissionError('عملية الحفظ غير مكتملة. راجع المسودات قبل المحاولة');
    }
    return saved.orderIds;
  }
  const previous = recover(await prisma.log.findUnique({ where: { id } }));
  if (previous) return { orderIds: previous, replayed: true };
  try {
    const orderIds = await prisma.$transaction(async tx => {
      await tx.log.create({ data: { id, userId: sellerId, action: ACTION } });
      const products = await tx.product.findMany({ where: { id: { in: [...new Set(orders.map(o => o.productId))] } }, select: { id: true, name: true, stock: true, marketPrice: true } });
      const productMap = new Map(products.map(product => [product.id, product]));
      const demand = new Map<string, number>();
      for (const order of orders) demand.set(order.productId, (demand.get(order.productId) ?? 0) + order.quantity);
      for (const [productId, quantity] of demand) {
        const product = productMap.get(productId);
        if (!product || product.stock < quantity) throw new OrderSubmissionError('المخزون غير كافٍ للمنتج: ' + (product?.name ?? 'غير متاح'));
      }
      const ids: string[] = [];
      for (const order of orders) {
        const product = productMap.get(order.productId)!;
        const created = await tx.order.create({ data: { ...order, productName: product.name, sellerId,
          codAmount: order.codAmount ?? product.marketPrice, shippingFee: 20, status: 'DRAFT' }, select: { id: true } });
        ids.push(created.id);
      }
      await tx.orderStatusHistory.createMany({ data: ids.map(orderId => ({ orderId, status: 'DRAFT' as const, userId: sellerId })) });
      await tx.log.update({ where: { id }, data: { details: JSON.stringify({ fingerprint, orderIds: ids }) } });
      return ids;
    });
    return { orderIds, replayed: false };
  } catch (error) {
    // A concurrent identical submission may have committed, or its response may
    // have been lost. Read the durable result; never blindly create again.
    const saved = recover(await prisma.log.findUnique({ where: { id } }));
    if (saved) return { orderIds: saved, replayed: true };
    if (error instanceof OrderSubmissionError) throw error;
    throw new OrderSubmissionError('تعذر التأكد من الحفظ. أعد المحاولة بنفس البيانات أو راجع المسودات أولاً', 503);
  }
}
