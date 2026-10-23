import { getSessionUser, errorResponse } from '@/lib/api-utils';
export async function POST() {
  const user = await getSessionUser();
  if (!user || user.role !== 'ADMIN') return errorResponse('غير مصرح', 401);
  return errorResponse('تم إيقاف مسار التسوية القديم. استخدم إجراء التسليم أو المرتجع المستقل؛ إعادة التخزين تتطلب فحصاً فعلياً', 409);
}
