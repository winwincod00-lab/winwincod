import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSessionUser, errorResponse } from "@/lib/api-utils";
import { sellerTransitions } from '@/lib/order-policy';

const VALID_STATUSES = [
  "DRAFT", "PENDING_CONFIRMATION", "CONFIRMED", "WAITING_PAYMENT",
  "PROCESSING", "SHIPPED", "DELIVERED", "CANCELLED", "RETURNED",
];

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getSessionUser();
    if (!user || user.role !== "SELLER") return errorResponse("غير مصرح", 401);

    const { id } = await params;
    const { status } = await req.json();

    if (!VALID_STATUSES.includes(status)) return errorResponse("حالة غير صالحة", 400);

    const order = await prisma.order.findFirst({
      where: { id, sellerId: user.id },
      select: { id: true, status: true, batchId: true },
    });
    if (!order) return errorResponse("الطلب غير موجود", 404);

    if (!sellerTransitions(order.status, order.batchId).includes(status)) {
      return errorResponse("هذا الانتقال غير مسموح. الدفع والشحن والتسوية لها إجراءات مستقلة", 409);
    }
    await prisma.$transaction(async (tx) => {
      const changed = await tx.order.updateMany({
        where: { id, sellerId: user.id, status: order.status, batchId: null },
        data: { status },
      });
      if (changed.count !== 1) throw new Error('تغير الطلب، حدّث الصفحة قبل المحاولة');
      await tx.orderStatusHistory.create({ data: { orderId: id, status, userId: user.id } });
    });

    return NextResponse.json({ success: true, status });
  } catch (err: any) {
    return errorResponse(err.message, 500);
  }
}
