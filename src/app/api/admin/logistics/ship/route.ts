import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getSessionUser, errorResponse } from '@/lib/api-utils';
import { canManuallyDispatch, dispatchOrders } from '@/services/dispatchService';
import { z } from 'zod';
const schema = z.object({ batchId: z.string().min(1), reason: z.string().trim().min(1).max(500) });
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user || user.role !== 'ADMIN') return errorResponse('غير مصرح', 401);
  if (!canManuallyDispatch(user.id)) return errorResponse('الإرسال اليدوي يتطلب صلاحية مستقلة', 403);
  try {
    const body = schema.safeParse(await req.json());
    if (!body.success) return errorResponse('حدد الدفعة وسبب الإرسال اليدوي', 400);
    const orders = await prisma.order.findMany({ where: { batchId: body.data.batchId }, select: { id: true } });
    await dispatchOrders(user.id, orders.map(order => order.id), body.data.reason);
    return NextResponse.json({ success: true, message: 'تم تسجيل الإرسال اليدوي' });
  } catch { return errorResponse('تعذر الإرسال: تحقق من الدفع والمخزون وحدّث الصفحة', 409); }
}
