import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSessionUser, errorResponse } from "@/lib/api-utils";
import { z } from "zod";
import { notifyOrderStatusChanged } from "@/services/notificationService";

const schema = z.object({ orderId: z.string() });

export async function POST(req: Request) {
  try {
    const user = await getSessionUser();
    if (!user || user.role !== "ADMIN") return errorResponse("غير مصرح", 401);

    const body = await req.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) return errorResponse("بيانات غير صالحة", 400);

    const { orderId } = parsed.data;

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, status: true, productId: true, quantity: true, sellerId: true },
    });

    if (!order) return errorResponse("الطلب غير موجود", 404);
    if (order.status !== "SHIPPED") return errorResponse("الطلب ليس في حالة شحن", 400);

    await prisma.$transaction(async (tx) => {
      const claim = await tx.order.updateMany({
        where: { id: orderId, status: "SHIPPED" },
        data: { status: "RETURNED", updatedAt: new Date() },
      });

      if (claim.count !== 1) throw new Error('تغيرت حالة الطلب، حدّث الصفحة');
      await tx.orderStatusHistory.create({ data: { orderId, status: 'RETURNED', userId: user.id } });
      // RETURNED records carrier outcome, not a physical warehouse inspection.
      await tx.log.create({ data: { userId: user.id, action: 'RETURN_AWAITING_INSPECTION', details: JSON.stringify({ orderId }) } });
    });

    // Notification (fire-and-forget)
    notifyOrderStatusChanged(order.sellerId, orderId, "RETURNED");

    return NextResponse.json({ success: true, message: "تم تسجيل المرتجع. لا يُعاد للمخزون قبل الفحص الفعلي" });
  } catch {
    return errorResponse("تعذر تحديث الطلب؛ تحقق من حالته وحدّث الصفحة", 409);
  }
}
