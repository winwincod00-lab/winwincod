export type CartItem = {
  cartId: string; productId: string; productName: string; productImage: string;
  sellerPrice: number; marketPrice: number; quantity: number; stock: number; sku?: string;
};
const cartKey = (sellerId: string) => 'winwin_cart_v4:' + encodeURIComponent(sellerId);
export const getCart = (sellerId: string): CartItem[] => {
  if (typeof window === 'undefined' || !sellerId) return [];
  try {
    const data: unknown = JSON.parse(localStorage.getItem(cartKey(sellerId)) || '[]');
    if (!Array.isArray(data)) return [];
    return data.filter((item): item is CartItem => !!item && typeof item === 'object' &&
      typeof item.cartId === 'string' && typeof item.productId === 'string' && typeof item.productName === 'string' && typeof item.productImage === 'string' && (item.sku === undefined || typeof item.sku === 'string') &&
      Number.isSafeInteger(item.quantity) && item.quantity > 0 && Number.isSafeInteger(item.stock) && item.stock >= 0 &&
      Number.isFinite(item.sellerPrice) && item.sellerPrice >= 0 && Number.isFinite(item.marketPrice) && item.marketPrice >= 0);
  } catch { return []; }
};
export const saveCart = (sellerId: string, items: CartItem[]) => {
  if (sellerId) localStorage.setItem(cartKey(sellerId), JSON.stringify(items));
};
export const clearCart = (sellerId: string) => { if (sellerId) localStorage.removeItem(cartKey(sellerId)); };

export function canAddToCart(items: CartItem[], productId: string, quantity: number, stock: number): boolean {
  const existing = items.filter(item => item.productId === productId).reduce((sum, item) => sum + item.quantity, 0);
  return Number.isSafeInteger(quantity) && quantity > 0 && Number.isSafeInteger(stock) && quantity + existing <= stock;
}
export function changeCartQuantity(items: CartItem[], cartId: string, delta: number): CartItem[] {
  const target = items.find(item => item.cartId === cartId);
  if (!target || !Number.isSafeInteger(delta)) return items;
  const others = items.filter(item => item.cartId !== cartId && item.productId === target.productId).reduce((sum, item) => sum + item.quantity, 0);
  const nextQuantity = target.quantity + delta;
  if (nextQuantity < 1 || nextQuantity + others > target.stock) return items;
  return items.map(item => item.cartId === cartId ? { ...item, quantity: nextQuantity } : item);
}
