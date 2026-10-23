import { codInput } from '@/lib/order-input';
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma"; // تأكد من وجود @ أو المسار الصحيح
import { getSessionUser, errorResponse } from "@/lib/api-utils";
import { z } from "zod";

const depositSchema = z.object({
  amount: codInput.refine(amount => amount > 0, 'المبلغ يجب أن يكون موجباً'),
  receiptImage: z.string().url("رابط الوصل غير صالح"),
});

export async function POST(req: Request) {
  try {
    const user = await getSessionUser();
    if (!user || user.role !== "SELLER") return errorResponse("غير مصرح", 401);

    const body = await req.json();
    const validation = depositSchema.safeParse(body);

    if (!validation.success) return errorResponse(validation.error.issues[0].message, 400);

    await prisma.depositrequest.create({
      data: {
        sellerId: user.id,
        amount: validation.data.amount,
        receiptImage: validation.data.receiptImage,
        status: "PENDING",
      }
    });

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error("Deposit error:", error);
    return errorResponse("تعذر حفظ الطلب؛ راجع السجل قبل إعادة المحاولة", 500);
  }
}
