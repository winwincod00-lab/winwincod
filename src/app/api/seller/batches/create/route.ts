import { NextResponse } from "next/server";
import { getSessionUser, errorResponse } from "@/lib/api-utils";
import { assertBatchIds } from "@/lib/order-policy";
import { createBatch } from "@/services/orderService";

export async function POST(req: Request) {
  try {
    const user = await getSessionUser();
    if (!user || user.role !== "SELLER") return errorResponse("غير مصرح", 401);

    const { orderIds } = await req.json();

    try { assertBatchIds(orderIds); } catch (error) {
      return errorResponse((error as Error).message, 400);
    }

    // استدعاء الخدمة (Business Logic)
    const batch = await createBatch(user.id, orderIds);

    return NextResponse.json({ success: true, batchId: batch.id });

  } catch (error: unknown) {
    return errorResponse(error instanceof Error ? error.message : "فشل إنشاء الدفعة", 409);
  }
}