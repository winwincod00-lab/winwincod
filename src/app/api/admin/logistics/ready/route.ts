import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSessionUser, errorResponse } from "@/lib/api-utils";

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const user = await getSessionUser();
    if (!user || user.role !== "ADMIN") return errorResponse("غير مصرح", 401);

    // Both payment and explicit Admin approval are required.
    const batches = await prisma.orderbatch.findMany({
      where: {
        isPaid: true,
        orders: {
          some: { status: 'PROCESSING' }
        }
      },
      include: {
        seller: { select: { name: true, phone: true } },
        orders: {
          where: { status: 'PROCESSING' }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    const reviews = await prisma.log.findMany({ where: { id: { in: batches.map(batch => 'batch-review:' + batch.id) }, action: 'BATCH_APPROVE' }, select: { id: true } });
    const approved = new Set(reviews.map(log => log.id));

    return NextResponse.json({ success: true, batches: batches.filter(batch => approved.has('batch-review:' + batch.id)) });
  } catch (error: unknown) {
    console.error("Logistics API Error:", error);
    return errorResponse("فشل جلب الشحنات", 500);
  }
}