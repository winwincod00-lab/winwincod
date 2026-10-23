import { NextRequest, NextResponse } from "next/server";
import { localOrderLookup, orderReference } from "@/lib/order-reference";
import prisma from "@/lib/prisma";
import { getSessionUser, errorResponse } from "@/lib/api-utils";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const user = await getSessionUser();
    if (!user || user.role !== "SELLER") return errorResponse("غير مصرح", 401);

    const q = req.nextUrl.searchParams.get("q")?.trim();
    if (!q) return errorResponse("أدخل رقم الطلب أو رقم الهاتف", 400);

    const lookup = localOrderLookup(q);
    if (!lookup) return errorResponse('استعمل المرجع الكامل الظاهر في تفاصيل الطلب أو هاتف الزبون', 400);
    const where = { sellerId: user.id, ...lookup };

    const order = await prisma.order.findFirst({
      where,
      orderBy: { createdAt: "desc" },
      include: {
        statusHistory: {
          orderBy: { createdAt: "asc" },
          select: { status: true, createdAt: true },
        },
      },
    });

    if (!order) {
      return NextResponse.json({ order: null }, { status: 200 });
    }

    const ref = orderReference(order.id, order.seqId);

    return NextResponse.json({
      order: {
        id:            order.id,
        ref,
        seqId:         order.seqId,
        customerName:  order.customerName,
        customerPhone: order.customerPhone,
        productName:   order.productName,
        quantity:      order.quantity,
        codAmount:     Number(order.codAmount),
        city:          order.city,
        address:       order.address,
        status:        order.status,
        trackingNumber: order.trackingNumber,
        createdAt:     order.createdAt.toISOString(),
        updatedAt:     order.updatedAt.toISOString(),
        statusHistory: order.statusHistory.map((h) => ({
          status:    h.status,
          createdAt: h.createdAt.toISOString(),
        })),
      },
    });
  } catch (err) {
    console.error("[tracking]", err);
    return errorResponse("خطأ في الخادم", 500);
  }
}
