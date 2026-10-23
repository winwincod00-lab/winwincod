import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSessionUser, errorResponse } from "@/lib/api-utils";
import { z } from "zod";
import { notifyOrderStatusChanged, notifyProfitCredited } from "@/services/notificationService";

const COMMISSION = 20; // MAD flat fee WinWinCOD keeps per delivered order

const schema = z.object({
  orderId: z.string(),
  codReceived: z.number().positive("مبلغ COD غير صالح"),
});

export async function POST(req: Request) {
  try {
    const user = await getSessionUser();
    if (!user || user.role !== "ADMIN") return errorResponse("غير مصرح", 401);

    const body = await req.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) return errorResponse(parsed.error.issues[0]?.message ?? "بيانات غير صالحة", 400);

    const { orderId, codReceived } = parsed.data;

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { product: { select: { sellerPrice: true } } },
    });

    if (!order) return errorResponse("الطلب غير موجود", 404);
    if (order.status !== "SHIPPED") return errorResponse("الطلب ليس في حالة شحن", 400);

    // Missing cost evidence must never become a zero-cost wallet credit.
    if (!order.product || !Number.isSafeInteger(order.quantity) || order.quantity < 1 ||
        !Number.isFinite(Number(order.product.sellerPrice)) || Number(order.product.sellerPrice) < 0) {
      return errorResponse('تعذر التحقق من تكلفة المنتج؛ يلزم مراجعة مالية قبل التسليم', 409);
    }
    const productCost = Number(order.product.sellerPrice) * order.quantity;
    if (!Number.isFinite(productCost)) return errorResponse('تكلفة المنتج غير صالحة؛ يلزم مراجعة مالية', 409);
    const sellerProfit = Math.max(0, codReceived - productCost - COMMISSION);

    await prisma.$transaction(async (tx) => {
      const claim = await tx.order.updateMany({
        where: { id: orderId, status: "SHIPPED" },
        data: {
          status: "DELIVERED",
          codReceived,
          netProfit: sellerProfit,
          systemFee: COMMISSION,
          updatedAt: new Date(),
        },
      });

      if (claim.count !== 1) throw new Error('تغيرت حالة الطلب، حدّث الصفحة');
      await tx.orderStatusHistory.create({ data: { orderId, status: 'DELIVERED', userId: user.id } });
      const wallet = await tx.wallet.upsert({
        where: { userId: order.sellerId },
        update: { balance: { increment: sellerProfit } },
        create: { userId: order.sellerId, balance: sellerProfit },
      });

      if (sellerProfit > 0) {
        await tx.transaction.create({
          data: {
            walletId: wallet.id,
            amount: sellerProfit,
            type: "DELIVERY_PROFIT",
            referenceId: orderId,
            description: `ربح تسليم الطلب — COD: ${codReceived} د.م`,
          },
        });
      }
    });

    // Notifications (fire-and-forget)
    notifyOrderStatusChanged(order.sellerId, orderId, "DELIVERED");
    if (sellerProfit > 0) {
      notifyProfitCredited(order.sellerId, orderId, sellerProfit);
    }

    return NextResponse.json({
      success: true,
      sellerProfit,
      message: `تم تسجيل التسليم — ربح البائع: ${sellerProfit.toFixed(2)} د.م`,
    });
  } catch {
    return errorResponse("تعذر تحديث الطلب؛ تحقق من حالته وحدّث الصفحة", 409);
  }
}
