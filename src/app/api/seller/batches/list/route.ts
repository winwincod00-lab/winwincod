import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSessionUser, errorResponse } from "@/lib/api-utils";

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const user = await getSessionUser();
    if (!user || user.role !== "SELLER") return errorResponse("غير مصرح", 401);

    // جلب كل الدفعات الخاصة بهذا البائع
    const batches = await prisma.orderbatch.findMany({
      where: { sellerId: user.id },
      orderBy: { createdAt: 'desc' },
      include: { orders: { select: { id: true, quantity: true, status: true } } }
    });

    const reviews = await prisma.log.findMany({ where: { id: { in: batches.map(batch => 'batch-review:' + batch.id) } }, select: { id: true, action: true } });
    const decisions = new Map(reviews.map(log => [log.id, log.action]));
    return NextResponse.json({ success: true, batches: batches.map(batch => ({ ...batch, units: batch.orders.reduce((sum, order) => sum + order.quantity, 0), reviewStatus: decisions.get('batch-review:' + batch.id) === 'BATCH_APPROVE' ? 'APPROVED' : decisions.get('batch-review:' + batch.id) === 'BATCH_REJECT' ? 'REJECTED' : batch.isPaid ? 'LEGACY_PAID' : 'PENDING_REVIEW' })) });
  } catch {
    return errorResponse("فشل جلب الدفعات", 500);
  }
}