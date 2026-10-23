import { NextResponse } from 'next/server';
import { getSessionUser, errorResponse } from '@/lib/api-utils';
import { canManuallyDispatch, dispatchOrders } from '@/services/dispatchService';
import { z } from 'zod';
const schema = z.object({ orderIds: z.array(z.string().min(1)).min(1).max(500), reason: z.string().trim().min(1).max(500) });
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user || user.role !== 'ADMIN') return errorResponse('غير مصرح', 401);
  if (!canManuallyDispatch(user.id)) return errorResponse('الإرسال اليدوي يتطلب صلاحية مستقلة', 403);
  try {
    const body = schema.safeParse(await req.json());
    if (!body.success) return errorResponse('حدد الطلبات وسبب الإرسال اليدوي', 400);
    const orders = await dispatchOrders(user.id, body.data.orderIds, body.data.reason);
    return NextResponse.json({ success: true, dispatched: orders.length, message: "تم تسجيل الإرسال اليدوي" });
  } catch { return errorResponse('تعذر الإرسال: تحقق من الدفع والمخزون وحدّث الصفحة', 409); }
}
