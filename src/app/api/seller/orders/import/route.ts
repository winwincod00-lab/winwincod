import { NextResponse } from 'next/server';
import { getSessionUser, errorResponse } from '@/lib/api-utils';
import { importOrdersInput, orderInputError } from '@/lib/order-input';
import { createDraftSubmission, OrderSubmissionError } from '@/services/orderSubmissionService';
export async function POST(req: Request) {
  try {
    const user = await getSessionUser();
    if (!user || user.role !== 'SELLER') return errorResponse('غير مصرح', 401);
    const parsed = importOrdersInput.safeParse(await req.json());
    if (!parsed.success) return errorResponse(orderInputError(parsed.error), 400);
    const orders = parsed.data.orders.map(row => ({ productId: parsed.data.productId, customerName: row.name,
      customerPhone: row.phone, address: row.address, city: row.city, quantity: row.quantity, codAmount: row.price }));
    const result = await createDraftSubmission(user.id, req.headers.get('Idempotency-Key'), 'import', orders);
    return NextResponse.json({ success: true, ...result, count: result.orderIds.length, message: 'تم حفظ ' + result.orderIds.length + ' مسودة. لم يتم خصم أي مبلغ' });
  } catch (error) {
    return errorResponse(error instanceof OrderSubmissionError ? error.message : 'تعذر الاستيراد', error instanceof OrderSubmissionError ? error.status : 500);
  }
}
