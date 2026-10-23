import { getSessionUser, errorResponse } from '@/lib/api-utils';

// Retired: drafts must be confirmed before the minimum-five-unit review flow.
export async function POST() {
  const user = await getSessionUser();
  if (!user || user.role !== 'SELLER') return errorResponse('غير مصرح', 401);
  return errorResponse('المسودات لا تُشحن مباشرة. أرسلها للتأكيد ثم اختر 5 وحدات من الطلبات المؤكدة على الأقل لإنشاء دفعة مدفوعة', 409);
}
