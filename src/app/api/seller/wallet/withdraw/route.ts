import { codInput } from '@/lib/order-input';
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSessionUser, errorResponse } from "@/lib/api-utils";
import { z } from "zod";

const withdrawSchema = z.object({
  amount: codInput.refine(amount => amount > 0, 'المبلغ يجب أن يكون موجباً'),
  bankName: z.string().min(2, "اسم البنك مطلوب"),
  bankAccountName: z.string().min(3, "الاسم الكامل مطلوب"),
  rib: z.string().length(24, "يجب أن يتكون الـ RIB من 24 رقماً")
});

export async function POST(req: Request) {
  try {
    const user = await getSessionUser();
    if (!user || user.role !== "SELLER") return errorResponse("غير مصرح", 401);

    const body = await req.json();
    const validation = withdrawSchema.safeParse(body);

    if (!validation.success) {
      return errorResponse(validation.error.issues[0].message, 400);
    }

    const { amount, bankName, bankAccountName, rib } = validation.data;

    // 1. تحديث بيانات البنك للبائع دائمًا
    await prisma.user.update({
      where: { id: user.id },
      data: { bankName, bankAccountName, rib }
    });

    // 2. التحقق من الرصيد المتاح (بدون خصم حتى يتم الموافقة)
    const wallet = await prisma.wallet.findUnique({ where: { userId: user.id } });
    if (!wallet) return errorResponse("المحفظة غير موجودة", 404);

    const pendingWithdrawalsReqs = await prisma.withdrawalrequest.aggregate({
      where: { sellerId: user.id, status: "PENDING" },
      _sum: { amount: true }
    });
    const pendingWithdrawals = Number(pendingWithdrawalsReqs._sum?.amount || 0);
    const availableBalance = Number(wallet.balance) - pendingWithdrawals;

    if (amount > availableBalance) {
      return errorResponse("الرصيد المتاح غير كافٍ لسحب هذا المبلغ", 400);
    }

    // 3. إنشاء طلب السحب للمدير
    await prisma.withdrawalrequest.create({
      data: {
        sellerId: user.id,
        amount: amount,
        status: "PENDING",
      }
    });

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error("WITHDRAW_ERROR:", error);
    return errorResponse("تعذر حفظ الطلب؛ راجع السجل قبل إعادة المحاولة", 500);
  }
}
