import { NextResponse } from 'next/server';
import { getSessionUser, errorResponse } from '@/lib/api-utils';
import { draftOrderInput, orderInputError } from '@/lib/order-input';
import { createDraftSubmission, OrderSubmissionError } from '@/services/orderSubmissionService';
export async function POST(req: Request) {
  try {
    const user = await getSessionUser();
    if (!user || user.role !== 'SELLER') return errorResponse('غير مصرح', 401);
    const parsed = draftOrderInput.safeParse(await req.json());
    if (!parsed.success) return errorResponse(orderInputError(parsed.error), 400);
    const result = await createDraftSubmission(user.id, req.headers.get('Idempotency-Key'), 'single', [parsed.data]);
    return NextResponse.json({ success: true, orderId: result.orderIds[0], replayed: result.replayed });
  } catch (error) {
    return errorResponse(error instanceof OrderSubmissionError ? error.message : 'تعذر حفظ المسودة', error instanceof OrderSubmissionError ? error.status : 500);
  }
}
