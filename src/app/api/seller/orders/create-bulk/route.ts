import { allocationOrders } from '@/lib/customer-allocation';
import { NextResponse } from 'next/server';
import { getSessionUser, errorResponse } from '@/lib/api-utils';
import { z } from 'zod';
import { draftOrderInput, orderInputError } from '@/lib/order-input';
import { createDraftSubmission, OrderSubmissionError } from '@/services/orderSubmissionService';
export async function POST(req: Request) {
  try {
    const user = await getSessionUser();
    if (!user || user.role !== 'SELLER') return errorResponse('غير مصرح', 401);
    const body = await req.json();
    let payload = body;
    if (body.checkout !== undefined) {
      try { payload = { orders: allocationOrders(body.checkout) }; }
      catch (error) { return errorResponse(error instanceof Error ? error.message : 'Allocation invalide', 400); }
    }
    const parsed = z.object({ orders: z.array(draftOrderInput).min(1).max(500) }).safeParse(payload);
    if (!parsed.success) return errorResponse(orderInputError(parsed.error), 400);
    const result = await createDraftSubmission(user.id, req.headers.get('Idempotency-Key'), 'bulk', parsed.data.orders);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return errorResponse(error instanceof OrderSubmissionError ? error.message : 'تعذر حفظ المسودات', error instanceof OrderSubmissionError ? error.status : 500);
  }
}
