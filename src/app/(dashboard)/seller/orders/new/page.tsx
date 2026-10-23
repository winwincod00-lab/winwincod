"use client";
import { useState, useEffect } from "react";
import axios from "axios";
import toast from "react-hot-toast";
import { useCart } from "@/context/CartContext";
import { ShoppingCart, Package } from "lucide-react";

function parseFirstImage(images: string): string {
  try {
    const arr = JSON.parse(images);
    return Array.isArray(arr) && arr.length > 0 ? arr[0] : "";
  } catch { return images || ""; }
}

type CatalogProduct = { id: string; name: string; images: string; sku?: string; sellerPrice: number | string; marketPrice: number | string; stock: number };

export default function ProductSelectionPage() {
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const { items: cart, addItem, openDrawer, totalCount } = useCart();

  useEffect(() => {
    axios.get("/api/seller/products")
      .then(res => {
        const preferred = new URLSearchParams(window.location.search).get('productId');
        const products: CatalogProduct[] = res.data.products || [];
        setProducts(preferred ? [...products].sort((a, b) => Number(b.id === preferred) - Number(a.id === preferred)) : products);
      })
      .catch(() => { setError(true); toast.error("فشل تحميل المنتجات"); })
      .finally(() => setLoading(false));
  }, [revision]);

  const getQty = (id: string) => quantities[id] || 1;

  const handleAdd = (product: CatalogProduct) => {
    const qty = getQty(product.id);
    const inCart = cart.filter(item => item.productId === product.id).reduce((sum, item) => sum + item.quantity, 0);
    if (!Number.isSafeInteger(qty) || qty < 1 || qty + inCart > product.stock) {
      toast.error('المخزون لا يكفي الكمية المختارة مع السلة'); return;
    }
    const added = addItem({
      productId: product.id,
      productName: product.name,
      sku: typeof product.sku === 'string' ? product.sku : undefined,
      productImage: parseFirstImage(product.images),
      sellerPrice: Number(product.sellerPrice),
      marketPrice: Number(product.marketPrice),
      stock: product.stock,
      quantity: qty,
    });
    if (!added) { toast.error("تعذر الإضافة. تحقق من المخزون وتوفر السلة"); return; }
    setQuantities(q => ({ ...q, [product.id]: 1 }));
    toast.success("تمت الإضافة للسلة");
  };

  return (
    <div className="space-y-6 pb-8">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-black text-[#1E293B]">إضافة طلب</h2>
          <p className="text-slate-400 text-sm mt-0.5">أضف المنتجات للسلة ثم أكمل بيانات الزبائن</p>
        </div>
        {totalCount > 0 && (
          <button onClick={openDrawer}
            className="flex items-center gap-2 bg-[#4361EE] text-white px-5 py-2.5 rounded-xl font-bold shadow hover:bg-[#3254D4] transition">
            <ShoppingCart className="w-4 h-4" /> السلة ({totalCount})
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64 gap-3">
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-[#4361EE] border-t-transparent" />
          <span className="text-[#4361EE] font-bold">جاري التحميل...</span>
        </div>
      ) : error ? <div role="alert">فشل تحميل المنتجات. <button className="p-3 underline" onClick={() => { setLoading(true); setError(false); setRevision(n => n + 1); }}>إعادة المحاولة</button></div> : products.length === 0 ? (
        <div className="bg-white rounded-2xl border-2 border-dashed border-[#E2E8F0] p-16 text-center">
          <div className="w-14 h-14 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto mb-3">
            <Package className="w-7 h-7 text-slate-400" />
          </div>
          <p className="text-slate-400 font-bold">لا توجد منتجات متاحة</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {products.map(product => {
            const image = parseFirstImage(product.images);
            const qty = getQty(product.id);
            const profit = Number(product.marketPrice) - Number(product.sellerPrice);
            const inCartCount = cart.filter(i => i.productId === product.id).length;
            const outOfStock = product.stock <= 0;

            return (
              <div key={product.id}
                className={`bg-white rounded-2xl border shadow-sm overflow-hidden flex flex-col transition ${
                  outOfStock
                    ? "opacity-60 border-[#E2E8F0]"
                    : "border-[#E2E8F0] hover:border-[#4361EE]/40 hover:shadow-md"
                }`}>
                {/* Image */}
                <div className="relative bg-[#F8FAFC] h-44 flex items-center justify-center overflow-hidden">
                  {image ? (
                    <img src={image} alt={product.name}
                      className="h-full w-full object-contain p-3"
                      onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
                  ) : (
                    <Package className="w-10 h-10 text-slate-200" />
                  )}
                  {inCartCount > 0 && (
                    <span className="absolute top-2 right-2 bg-[#4361EE] text-white text-xs font-black px-2.5 py-1 rounded-lg shadow">
                      {inCartCount} في السلة
                    </span>
                  )}
                  {outOfStock && (
                    <div className="absolute inset-0 bg-white/80 flex items-center justify-center">
                      <span className="bg-red-500 text-white text-sm font-black px-4 py-2 rounded-xl">نفذ المخزون</span>
                    </div>
                  )}
                </div>

                {/* Info */}
                <div className="p-4 flex flex-col gap-3 flex-1">
                  <div>
                    <h3 className="font-black text-[#1E293B] text-sm leading-snug line-clamp-2">{product.name}</h3>
                    <p className="text-xs text-slate-400 mt-0.5">المخزون الفعلي (غير محجوز): {product.stock}</p>
                  </div>

                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs text-slate-400">سعر البيع المقترح</p>
                      <p className="text-lg font-black text-[#1E293B]">
                        {Number(product.marketPrice).toFixed(0)}
                        <span className="text-xs font-normal text-slate-400 mr-1">د.م</span>
                      </p>
                    </div>
                    <span className={`px-3 py-1.5 rounded-xl text-xs font-black ${
                      profit > 0 ? "bg-green-50 text-green-700" : "bg-slate-50 text-slate-400"
                    }`}>
                      هامش قبل الرسوم {profit.toFixed(2)} د.م
                    </span>
                  </div>

                  {/* Qty + Add */}
                  <div className="flex items-center gap-2 mt-auto">
                    <div className="flex items-center border border-[#E2E8F0] rounded-xl overflow-hidden">
                      <button type="button" disabled={outOfStock || qty <= 1}
                        onClick={() => setQuantities(q => ({ ...q, [product.id]: Math.max(1, (q[product.id] || 1) - 1) }))}
                        className="px-3 py-2 text-[#4361EE] font-black hover:bg-[#EEF2FF] transition text-sm disabled:opacity-30">−</button>
                      <span className="px-2 font-black text-[#1E293B] text-sm min-w-[1.5rem] text-center">{qty}</span>
                      <button type="button" disabled={outOfStock || qty >= product.stock}
                        onClick={() => setQuantities(q => ({ ...q, [product.id]: Math.min(product.stock, (q[product.id] || 1) + 1) }))}
                        className="px-3 py-2 text-[#4361EE] font-black hover:bg-[#EEF2FF] transition text-sm disabled:opacity-30">+</button>
                    </div>
                    <button type="button" disabled={outOfStock}
                      onClick={() => handleAdd(product)}
                      className="flex-1 bg-[#4361EE] hover:bg-[#3254D4] disabled:bg-[#E2E8F0] disabled:text-slate-400 text-white py-2 rounded-xl font-bold text-sm transition">
                      إضافة للسلة
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
