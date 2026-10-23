import { NextResponse } from "next/server";
import { getSessionUser, errorResponse } from "@/lib/api-utils";
import { rejectDeposit } from "@/services/walletService";

export async function POST(req: Request) {
  try {
    const user = await getSessionUser();
    if (!user || user.role !== "ADMIN") return errorResponse("صلاحية مدير فقط", 401);

    const { id, reason } = await req.json();
    if (!id) return errorResponse("معرف الطلب مطلوب", 400);

    await rejectDeposit(id, reason ?? "تم الرفض من قِبل الإدارة", user.id);

    return NextResponse.json({ success: true, message: "تم رفض الطلب بنجاح" });
  } catch (error: unknown) {
    return errorResponse((error instanceof Error ? error.message : "Request conflict") || "حدث خطأ أثناء الرفض", 500);
  }
}
