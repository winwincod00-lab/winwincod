import type { order_status } from '@prisma/client';
import { NextResponse } from 'next/server';
import { getSessionUser, errorResponse } from '@/lib/api-utils';
import { sellerTransitions } from '@/lib/order-policy';
import prisma from '@/lib/prisma';
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user || !['CALL_CENTER', 'ADMIN'].includes(user.role)) return errorResponse('غير مصرح', 401);
  try {
    const { orderId, status } = await req.json();
    if (typeof orderId !== 'string' || typeof status !== 'string') return errorResponse('بيانات غير صالحة', 400);
    const order = await prisma.order.findUnique({ where: { id: orderId }, select: { status: true, batchId: true } });
    if (!order) return errorResponse('الطلب غير موجود', 404);
    if (!sellerTransitions(order.status, order.batchId).includes(status)) return errorResponse('انتقال غير مسموح؛ الدفع والشحن والتسوية إجراءات مستقلة', 409);
    await prisma.$transaction(async tx => {
      const claim = await tx.order.updateMany({ where: { id: orderId, status: order.status, batchId: null }, data: { status: status as order_status } });
      if (claim.count !== 1) throw new Error('تغيرت الحالة');
      await tx.orderStatusHistory.create({ data: { orderId, status: status as order_status, userId: user.id } });
    });
    return NextResponse.json({ success: true });
  } catch { return errorResponse('تعذر التحديث؛ حدّث الصفحة', 409); }
}
