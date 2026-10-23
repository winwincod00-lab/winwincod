import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSessionUser, errorResponse } from "@/lib/api-utils";

const VALID_STATUSES = ["DRAFT", "PENDING_CONFIRMATION", "CONFIRMED", "WAITING_PAYMENT", "CANCELLED", "PROCESSING", "SHIPPED", "DELIVERED", "RETURNED"] as const;
type Status = typeof VALID_STATUSES[number];

export async function GET(req: Request) {
  try {
    const user = await getSessionUser();
    if (!user || user.role !== "ADMIN") return errorResponse("غير مصرح", 401);

    const { searchParams } = new URL(req.url);
    const status = (searchParams.get("status") || "WAITING_PAYMENT") as Status;

    if (!VALID_STATUSES.includes(status)) return errorResponse("حالة غير صالحة", 400);

    const orders = await prisma.order.findMany({
      where: { status },
      orderBy: { updatedAt: "desc" },
      include: {
        batch: { select: { id: true, isPaid: true } },
        seller: { select: { id: true, name: true, email: true } },
        product: { select: { id: true, name: true, sellerPrice: true } },
      },
    });

    const reviews = await prisma.log.findMany({ where: { id: { in: [...new Set(orders.flatMap(order => order.batchId ? ['batch-review:' + order.batchId] : []))] } }, select: { id: true, action: true } });
    const decisions = new Map(reviews.map(log => [log.id, log.action]));
    return NextResponse.json({ success: true, orders: orders.map(order => ({ ...order, reviewStatus: !order.batchId ? null : decisions.get('batch-review:' + order.batchId) === 'BATCH_APPROVE' ? 'APPROVED' : decisions.get('batch-review:' + order.batchId) === 'BATCH_REJECT' ? 'REJECTED' : order.batch?.isPaid ? 'LEGACY_PAID' : 'PENDING_REVIEW' })) });
  } catch (error: unknown) {
    return errorResponse(error instanceof Error ? error.message : "Load failed", 500);
  }
}
