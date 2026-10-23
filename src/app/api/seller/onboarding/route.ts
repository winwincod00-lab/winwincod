import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getSessionUser, errorResponse } from '@/lib/api-utils';
import { normalizeMoroccanPhone } from '@/lib/order-input';
import { z } from 'zod';
export const dynamic = 'force-dynamic';
const profile = z.object({
  name: z.string().trim().min(1, 'الاسم الكامل مطلوب'),
  phone: z.string().transform(normalizeMoroccanPhone).pipe(z.string().regex(/^0[67]\d{8}$/, 'رقم الهاتف غير صحيح (06 أو 07)')),
  city: z.string().trim().min(1, 'المدينة مطلوبة'),
  storeName: z.string().trim().min(1, 'اسم المتجر مطلوب'),
  storeDescription: z.string().trim().optional(),
  storeLink: z.string().trim().optional(),
});
export async function POST(req: NextRequest) {
  try {
    const user = await getSessionUser();
    if (!user || user.role !== 'SELLER') return errorResponse('غير مصرح', 401);
    const parsed = profile.safeParse(await req.json());
    if (!parsed.success) return errorResponse(parsed.error.issues[0]?.message ?? 'بيانات غير صالحة', 400);
    const { storeDescription, storeLink, ...fields } = parsed.data;
    await prisma.user.update({ where: { id: user.id }, data: { ...fields, storeDescription: storeDescription || null, storeLink: storeLink || null, hasCompletedOnboarding: true } });
    return NextResponse.json({ success: true });
  } catch { return errorResponse('خطأ في الخادم', 500); }
}
