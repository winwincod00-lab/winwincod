import prisma from '@/lib/prisma';

export function canManuallyDispatch(userId: string, grants = process.env.MANUAL_DISPATCH_ADMIN_IDS ?? '') {
  return grants.split(',').map(id => id.trim()).filter(Boolean).includes(userId);
}

// Both manual endpoints share one paid, stock-safe, audited transaction.
export async function dispatchOrders(actorId: string, orderIds: string[], reason: string) {
  if (!canManuallyDispatch(actorId)) throw new Error('صلاحية الإرسال اليدوي غير مفعلة لهذا المسؤول');
  if (!reason.trim() || reason.length > 500 || !orderIds.length || orderIds.length > 500 || new Set(orderIds).size !== orderIds.length) {
    throw new Error('حدد طلبات مختلفة وسبب الإرسال اليدوي');
  }
  return prisma.$transaction(async tx => {
    const orders = await tx.order.findMany({
      where: { id: { in: orderIds }, status: 'PROCESSING', batch: { isPaid: true } },
      select: { id: true, productId: true, quantity: true, sellerId: true, batch: { select: { id: true, sellerId: true } } },
    });
    if (orders.length !== orderIds.length) throw new Error('كل الطلبات يجب أن تكون مدفوعة وقيد التجهيز');
    for (const batchId of new Set(orders.map(order => order.batch?.id))) {
      if (!batchId) throw new Error('Batch identity required');
      const review = await tx.log.findUnique({ where: { id: 'batch-review:' + batchId } });
      if (review?.action !== 'BATCH_APPROVE') throw new Error('Explicit Admin approval required before dispatch');
    }
    for (const order of orders) {
      if (!order.productId || !Number.isSafeInteger(order.quantity) || order.quantity < 1 || order.batch?.sellerId !== order.sellerId) {
        throw new Error('بيانات المنتج أو البائع غير صالحة');
      }
      const stock = await tx.product.updateMany({
        where: { id: order.productId, stock: { gte: order.quantity } },
        data: { stock: { decrement: order.quantity } },
      });
      if (stock.count !== 1) throw new Error('المخزون غير كافٍ. لم يتم إرسال أي طلب');
      const claim = await tx.order.updateMany({
        where: { id: order.id, status: 'PROCESSING', batch: { isPaid: true } },
        data: { status: 'SHIPPED' },
      });
      if (claim.count !== 1) throw new Error('تغيرت حالة الطلب، حدّث الصفحة');
    }
    await tx.orderStatusHistory.createMany({ data: orders.map(order => ({ orderId: order.id, status: 'SHIPPED' as const, userId: actorId })) });
    await tx.log.create({ data: { userId: actorId, action: 'MANUAL_WAREHOUSE_DISPATCH', details: JSON.stringify({ orderIds, reason: reason.trim() }) } });
    return orders;
  }, { isolationLevel: 'Serializable' });
}
