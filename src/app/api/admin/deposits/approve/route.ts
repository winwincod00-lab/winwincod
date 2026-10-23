import { NextResponse } from "next/server";
import { getSessionUser, errorResponse } from "@/lib/api-utils";
import { approveDeposit } from "@/services/walletService";

export async function POST(req: Request) {
  try {
    const user = await getSessionUser();
    if (!user || user.role !== "ADMIN") return errorResponse("غير مصرح لك، صلاحية مدير فقط", 401);

    const { id } = await req.json();
    if (!id) return errorResponse("معرف الطلب مطلوب", 400);

    const wallet = await approveDeposit(id, user.id);

    return NextResponse.json({
      success: true,
      message: "تم شحن رصيد البائع وتحديث الحالة بنجاح",
      newBalance: Number(wallet.balance),
    });
  } catch (error: unknown) {
    return errorResponse("حدث خطأ أثناء الموافقة: " + (error instanceof Error ? error.message : "Request conflict"), 500);
  }
}
