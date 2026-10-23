import { NextResponse } from "next/server";

import { getSessionUser, errorResponse } from "@/lib/api-utils";
import { z } from "zod";
import { decideWithdrawal } from "@/services/walletApprovalService";

const actionSchema = z.object({
  id: z.string(),
  action: z.enum(["APPROVE", "REJECT"]),
  receiptUrl: z.string().url("رابط الوصل غير صحيح").optional().or(z.literal(""))
});

export async function POST(req: Request) {
  try {
    const admin = await getSessionUser();
    if (!admin || admin.role !== "ADMIN") return errorResponse("غير مصرح", 401);

    const body = await req.json();
    const validation = actionSchema.safeParse(body);
    if (!validation.success) return errorResponse("بيانات غير صالحة", 400);

    const { id, receiptUrl, action } = validation.data;
    const isApprove = action === "APPROVE";

    if (isApprove && !receiptUrl) return errorResponse("Payment receipt required", 400);
    await decideWithdrawal(id, isApprove ? "APPROVED" : "REJECTED", admin.id, receiptUrl);

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    console.error("ADMIN_WITHDRAWAL_ACTION:", err);
    return errorResponse(err instanceof Error ? err.message : "Withdrawal conflict", 409);
  }
}
