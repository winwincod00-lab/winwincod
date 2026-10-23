import { NextResponse } from "next/server";
import { getSessionUser, errorResponse } from "@/lib/api-utils";
import { getWalletHistory, getWalletStats } from "@/services/walletService";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const user = await getSessionUser();
    if (!user || user.role !== "SELLER") return errorResponse("غير مصرح", 401);

    const { searchParams } = new URL(req.url);
    const page = Number(searchParams.get("page") ?? 1);
    const limit = Number(searchParams.get("limit") ?? 20);
    if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(limit) || limit < 1 || limit > 50) {
      return errorResponse("رقم الصفحة وحجمها غير صالحين", 400);
    }

    const [history, stats] = await Promise.all([
      getWalletHistory(user.id, page, limit),
      getWalletStats(user.id),
    ]);

    return NextResponse.json({ success: true, ...history, page, stats });
  } catch {
    return errorResponse("فشل جلب سجل الحركات", 500);
  }
}
