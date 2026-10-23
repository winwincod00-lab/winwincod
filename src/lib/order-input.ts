import { z } from 'zod';

export function normalizeMoroccanPhone(value: string): string {
  return value.trim().replace(/[\s().-]/g, '').replace(/^(?:\+212|00212)/, '0');
}
export const customerFields = {
  customerName: z.string().trim().min(2, 'أدخل الاسم الكامل للزبون'),
  customerPhone: z.string().transform(normalizeMoroccanPhone).pipe(z.string().regex(/^0[5-7]\d{8}$/, 'أدخل هاتفاً مغربياً صحيحاً: 06/07/05 أو +212')),
  address: z.string().trim().min(3, 'أدخل الحي والشارع وتفاصيل الوصول للزبون'),
  city: z.string().trim().min(1, 'اختر مدينة الزبون'),
};
const numericInput = z.union([z.number(), z.string().trim().min(1, 'أدخل مبلغاً أو كمية؛ لا تترك الحقل فارغاً')]);
export const quantityInput = numericInput.transform(value => Number(value)).pipe(z.number().int('الكمية يجب أن تكون عدداً صحيحاً').positive('الكمية يجب أن تكون 1 على الأقل'));
export const codInput = numericInput.transform(value => Number(value)).pipe(z.number().finite().min(0, 'مبلغ COD لا يمكن أن يكون سالباً'));
export const draftOrderInput = z.object({
  productId: z.string().trim().min(1, 'اختر المنتج'),
  productName: z.string().optional(), // display name is always resolved on the server
  quantity: quantityInput,
  ...customerFields,
  codAmount: codInput,
});
export const importOrdersInput = z.object({ productId: z.string().trim().min(1, 'اختر المنتج'), orders: z.array(z.object({
  name: customerFields.customerName, phone: customerFields.customerPhone,
  address: customerFields.address, city: customerFields.city,
  quantity: quantityInput.default(1), price: codInput.optional(),
})).min(1, 'اختر ملفاً يحتوي على طلبات').max(500, 'الحد الأقصى 500 طلب لكل عملية') });
export type DraftInput = Omit<z.infer<typeof draftOrderInput>, 'productName' | 'codAmount'> & { codAmount?: number };
export function orderInputError(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return 'بيانات الطلب غير صالحة';
  const row = issue.path[0] === 'orders' && typeof issue.path[1] === 'number' ? 'الطلب ' + (issue.path[1] + 1) + ': ' : '';
  const field = String(issue.path.at(-1));
  const labels: Record<string, string> = { customerName: 'اسم الزبون', name: 'اسم الزبون', customerPhone: 'الهاتف', phone: 'الهاتف', address: 'العنوان', city: 'المدينة', quantity: 'الكمية', codAmount: 'مبلغ COD', price: 'مبلغ COD', productId: 'المنتج' };
  return row + (labels[field] ?? 'بيانات الطلب') + ' — ' + issue.message;
}
