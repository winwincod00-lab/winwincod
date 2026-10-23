import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSessionUser, errorResponse } from '@/lib/api-utils';
import { reviewBatch } from '@/services/orderService';
const input = z.object({ batchId: z.string().min(1), decision: z.enum(['APPROVE', 'REJECT']), reason: z.string().trim().min(1).max(500) });
export async function POST(req: Request) {
  try {
    const actor = await getSessionUser();
    if (!actor || actor.role !== 'ADMIN') return errorResponse('Admin required', 401);
    const parsed = input.safeParse(await req.json());
    if (!parsed.success) return errorResponse('Batch, decision and review reason required', 400);
    const { batchId, decision, reason } = parsed.data;
    return NextResponse.json({ success: true, ...await reviewBatch(actor.id, batchId, decision, reason) });
  } catch (error) { return errorResponse(error instanceof Error ? error.message : 'Review conflict', 409); }
}
