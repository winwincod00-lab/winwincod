import { NextResponse } from "next/server";
import { getSessionUser, errorResponse } from "@/lib/api-utils";
import { markAsRead } from "@/services/notificationService";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getSessionUser();
    if (!user) return errorResponse("غير مصرح", 401);

    const { id } = await params;
    await markAsRead(id, user.id);

    return NextResponse.json({ success: true });
  } catch {
    return errorResponse("فشل تحديث الإشعار", 500);
  }
}
