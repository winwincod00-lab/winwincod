"use client";
import { useSession } from 'next-auth/react';
import { createContext, useContext, useState, useEffect, useRef, useCallback, type ReactNode } from 'react';
import { getCart, saveCart, clearCart, canAddToCart, changeCartQuantity, type CartItem } from '@/lib/cart';
type AddItemInput = Omit<CartItem, 'cartId' | 'quantity'> & { quantity?: number };
type CartCtx = {
  ready: boolean; sellerId: string; items: CartItem[];
  addItem: (product: AddItemInput) => boolean;
  removeItem: (cartId: string) => void; updateQty: (cartId: string, delta: number) => void;
  clearAll: () => void; totalCount: number; drawerOpen: boolean; openDrawer: () => void; closeDrawer: () => void;
};
const CartContext = createContext<CartCtx | null>(null);
function SellerCartProvider({ children, sellerId }: { children: ReactNode; sellerId: string }) {
  const [items, setItems] = useState<CartItem[]>([]);
  const currentItems = useRef<CartItem[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let mounted = true;
    Promise.resolve().then(() => {
      if (mounted) { const stored = getCart(sellerId); currentItems.current = stored; setItems(stored); setReady(true); }
    });
    return () => { mounted = false; };
  }, [sellerId]);
  const commit = useCallback((next: CartItem[]) => {
    saveCart(sellerId, next); currentItems.current = next; setItems(next);
  }, [sellerId]);
  const addItem = useCallback((product: AddItemInput) => {
    const quantity = product.quantity ?? 1;
    if (!sellerId || !ready || !canAddToCart(currentItems.current, product.productId, quantity, product.stock)) return false;
    try { commit([...currentItems.current, { ...product, quantity, cartId: crypto.randomUUID() }]); }
    catch { return false; }
    setDrawerOpen(true); return true;
  }, [sellerId, ready, commit]);
  const removeItem = useCallback((cartId: string) => {
    if (sellerId && ready) commit(currentItems.current.filter(item => item.cartId !== cartId));
  }, [sellerId, ready, commit]);
  const updateQty = useCallback((cartId: string, delta: number) => {
    if (sellerId && ready) commit(changeCartQuantity(currentItems.current, cartId, delta));
  }, [sellerId, ready, commit]);
  const clearAll = useCallback(() => { clearCart(sellerId); currentItems.current = []; setItems([]); }, [sellerId]);
  return <CartContext.Provider value={{ ready, sellerId, items, addItem, removeItem, updateQty, clearAll,
    totalCount: items.reduce((sum, item) => sum + item.quantity, 0), drawerOpen,
    openDrawer: () => setDrawerOpen(true), closeDrawer: () => setDrawerOpen(false) }}>{children}</CartContext.Provider>;
}
// Remount on an account change, before rendering the next seller's cart.
export function CartProvider({ children }: { children: ReactNode }) {
  const { data: session } = useSession();
  const sellerId = session?.user?.role === 'SELLER' ? session.user.id : '';
  return <SellerCartProvider key={sellerId} sellerId={sellerId}>{children}</SellerCartProvider>;
}
export function useCart() {
  const context = useContext(CartContext);
  if (!context) throw new Error('useCart must be inside CartProvider');
  return context;
}
