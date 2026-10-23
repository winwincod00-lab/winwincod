import { codInput } from './order-input';
export type CheckoutForm = { customerName: string; customerPhone: string; address: string; city: string; codAmount: string };
export function initialCheckoutForm(unitPrice: number, quantity = 1): CheckoutForm {
  return { customerName: '', customerPhone: '', address: '', city: '', codAmount: String(unitPrice * quantity) };
}
export function checkoutAmounts(cod: string, unitCost: number, quantity: number) {
  const parsed = codInput.safeParse(cod);
  return { cod: parsed.success ? parsed.data : null, margin: parsed.success ? parsed.data - unitCost * quantity : null };
}
