import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSessionUser, errorResponse } from '@/lib/api-utils';
import { codInput } from '@/lib/order-input';
import { manualTopup } from '@/services/manualTopupService';
const input = z.object({ targetUserId: z.string().trim().min(1), amount: codInput.refine(value => value > 0), note: z.string().trim().max(500).optional().default('') });
export async function POST(req: Request) {
  try {
    const actor = await getSessionUser();
    if (!actor || actor.role !== 'ADMIN') return errorResponse('Admin required', 401);
    const parsed = input.safeParse(await req.json());
    if (!parsed.success) return errorResponse('Invalid seller, amount or note', 400);
    const key = req.headers.get('Idempotency-Key');
    if (!key || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key)) return errorResponse('Valid Idempotency-Key required', 400);
    const { targetUserId, amount, note } = parsed.data;
    const result = await manualTopup(actor.id, key, targetUserId, amount, note);
    return NextResponse.json({ success: true, replayed: result.replayed });
  } catch { return errorResponse('تعذر تأكيد الشحن. أعد المحاولة بنفس المفتاح والبيانات أو راجع القيود', 503); }
}
