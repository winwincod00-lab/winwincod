import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSessionUser, errorResponse } from "@/lib/api-utils";

export const dynamic = 'force-dynamic'; // لضمان عدم تخزين البيانات مؤقتاً

export async function GET() {
  try {
    const user = await getSessionUser();
    if (!user || user.role !== "SELLER") return errorResponse("غير مصرح", 401);

    // جلب الطلبات التي حالتها DRAFT والخاصة بهذا البائع فقط
    const drafts = await prisma.order.findMany({
      where: {
        sellerId: user.id,
        status: "DRAFT",
        batchId: null // تأكد أنها ليست في دفعة بالفعل
      },
      orderBy: { createdAt: 'desc' },
      include: { product: { select: { images: true, sku: true } } },
    });

    return NextResponse.json({ success: true, drafts });

  } catch {
    return errorResponse("فشل جلب المسودات", 500);
  }
}
