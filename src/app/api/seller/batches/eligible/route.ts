import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getSessionUser, errorResponse } from '@/lib/api-utils';
export async function GET() {
  const user = await getSessionUser();
  if (!user || user.role !== 'SELLER') return errorResponse('غير مصرح', 401);
  try {
    const orders = await prisma.order.findMany({
      where: { sellerId: user.id, status: 'CONFIRMED', batchId: null },
      select: { id: true, customerName: true, productName: true, productId: true, quantity: true, product: { select: { stock: true, sellerPrice: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return NextResponse.json({ orders: orders.map(o => ({
      id: o.id, customerName: o.customerName, productName: o.productName, productId: o.productId,
      quantity: o.quantity, stock: o.product?.stock ?? 0,
      cost: o.product ? Number(o.product.sellerPrice) * o.quantity + 20 : null,
      eligible: !!o.product && Number.isSafeInteger(o.quantity) && o.quantity > 0 && o.product.stock >= o.quantity,
    })) });
  } catch { return errorResponse('فشل تحميل الطلبات المؤهلة', 500); }
}
