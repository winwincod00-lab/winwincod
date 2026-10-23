import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSessionUser, errorResponse } from '@/lib/api-utils';
import { DraftConfirmationError, submitDraftsForConfirmation } from '@/services/draftConfirmationService';

export async function POST(req: Request) {
  try {
    const user = await getSessionUser();
    if (!user || user.role !== 'SELLER') return errorResponse('Unauthorized', 401);
    const parsed = z.object({ orderIds: z.array(z.string().trim().min(1)).min(1).max(500) }).safeParse(await req.json());
    if (!parsed.success || new Set(parsed.data.orderIds).size !== parsed.data.orderIds.length) return errorResponse('Invalid selection', 400);
    return NextResponse.json({ success: true, ...await submitDraftsForConfirmation(user.id, req.headers.get('Idempotency-Key'), parsed.data.orderIds) });
  } catch (error) {
    return errorResponse(error instanceof DraftConfirmationError ? error.message : 'Unable to submit drafts', error instanceof DraftConfirmationError ? error.status : 503);
  }
}
