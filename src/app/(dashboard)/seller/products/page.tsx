"use client";
import { useState, useEffect } from "react";
import axios from "axios";
import Link from "next/link";
import toast from "react-hot-toast";
import { Store, Package, ShoppingCart } from "lucide-react";
import { useCart } from "@/context/CartContext";

interface Product {
  id: string; name: string; sku: string;
  sellerPrice: number; marketPrice: number;
  stock: number; images: string; description: string;
}

function parseFirstImage(images: string): string {
  try {
    const arr = JSON.parse(images);
    return Array.isArray(arr) && arr.length > 0 ? arr[0] : images;
  } catch { return images || ""; }
}

export default function MarketplacePage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const { addItem } = useCart();

  useEffect(() => {
    axios.get("/api/seller/products")
      .then(res => setProducts(res.data.products))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const handleAddToCart = (product: Product) => {
    const added = addItem({
      productId: product.id,
      productName: product.name,
      productImage: parseFirstImage(product.images),
      sellerPrice: Number(product.sellerPrice),
      marketPrice: Number(product.marketPrice),
      stock: product.stock,
      quantity: 1,
    });
    if (!added) { toast.error("تعذر الإضافة. تحقق من المخزون وتوفر السلة"); return; }
    toast.success(`تمت إضافة "${product.name}" للسلة`);
  };

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin rounded-full h-8 w-8 border-2 border-[#4361EE] border-t-transparent" />
      <span className="mr-3 text-[#4361EE] font-bold">جاري تحميل السوق...</span>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-[#1E293B] flex items-center gap-2">سوق المنتجات <Store className="w-5 h-5 text-slate-400" /></h1>
          <p className="text-slate-400 text-sm mt-0.5">تصفح المنتجات المتوفرة وابدأ بيعها الآن</p>
        </div>
        <span className="bg-[#EEF2FF] text-[#4361EE] font-bold text-sm px-4 py-2 rounded-xl border border-blue-100 w-fit">
          {products.length} منتج متوفر
        </span>
      </div>

      {products.length === 0 ? (
        <div className="bg-white rounded-2xl border-2 border-dashed border-[#E2E8F0] p-20 text-center">
          <div className="w-14 h-14 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto mb-3">
            <Store className="w-7 h-7 text-slate-400" />
          </div>
          <p className="text-slate-400 font-bold">لا توجد منتجات متوفرة حالياً</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {products.map(product => {
            const image = parseFirstImage(product.images);
            const profit = Number(product.marketPrice) - Number(product.sellerPrice);
            const outOfStock = product.stock === 0;

            return (
              <div key={product.id}
                className="group bg-white rounded-2xl shadow-sm border border-[#E2E8F0] overflow-hidden hover:shadow-lg hover:-translate-y-1 transition-all duration-300 flex flex-col">
                {/* Image */}
                <div className="relative h-52 bg-[#F8FAFC] overflow-hidden">
                  {image ? (
                    <img src={image} alt={product.name}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                      onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center"><Package className="w-8 h-8 text-slate-200" /></div>
                  )}
                  <div className={`absolute top-2.5 right-2.5 px-2 py-1 rounded-lg text-[10px] font-bold shadow-sm ${
                    outOfStock ? "bg-red-500 text-white" : "bg-green-500 text-white"
                  }`}>
                    {outOfStock ? "نفذت الكمية" : `متوفر: ${product.stock}`}
                  </div>
                </div>

                {/* Details */}
                <div className="p-4 flex flex-col flex-1">
                  <h3 className="font-bold text-[#1E293B] leading-tight line-clamp-2">{product.name}</h3>
                  <span className="text-[10px] font-mono text-slate-400 uppercase mt-0.5">SKU: {product.sku}</span>

                  <p className="text-slate-400 text-xs line-clamp-2 my-3 h-8">
                    {product.description || "لا يوجد وصف لهذا المنتج."}
                  </p>

                  {/* Prices */}
                  <div className="bg-[#F8FAFC] rounded-xl p-3 mb-3 border border-[#E2E8F0]">
                    <div className="flex justify-between items-center">
                      <div className="text-center">
                        <p className="text-[10px] text-slate-400 font-bold">تكلفتك</p>
                        <p className="text-[#4361EE] font-black">
                          {Number(product.sellerPrice).toFixed(0)} <small className="text-[10px] font-normal">د.م</small>
                        </p>
                      </div>
                      <div className="w-px h-8 bg-[#E2E8F0]" />
                      <div className="text-center">
                        <p className="text-[10px] text-slate-400 font-bold">سعر السوق</p>
                        <p className="text-[#1E293B] font-black">
                          {Number(product.marketPrice).toFixed(0)} <small className="text-[10px] font-normal">د.م</small>
                        </p>
                      </div>
                      <div className="w-px h-8 bg-[#E2E8F0]" />
                      <div className="text-center">
                        <p className="text-[10px] text-slate-400 font-bold">ربحك</p>
                        <p className={`font-black text-sm ${profit > 0 ? "text-green-600" : "text-red-500"}`}>
                          {profit.toFixed(0)} <small className="text-[10px] font-normal">د.م</small>
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="mt-auto space-y-2">
                    <Link href={`/seller/products/${product.id}`}
                      className="block w-full text-center py-2 rounded-xl border border-[#E2E8F0] text-slate-600 font-bold text-sm hover:bg-[#F8FAFC] transition">
                      عرض التفاصيل
                    </Link>
                    {outOfStock ? (
                      <button disabled
                        className="w-full py-2.5 rounded-xl bg-gray-100 text-gray-400 font-bold text-sm cursor-not-allowed">
                        غير متوفر
                      </button>
                    ) : (
                      <button
                        onClick={() => handleAddToCart(product)}
                        className="w-full py-2.5 rounded-xl bg-[#4361EE] hover:bg-[#3254D4] text-white font-bold text-sm transition shadow-sm">
                        <span className="flex items-center gap-1">بيع هذا المنتج <ShoppingCart className="w-4 h-4" /></span>
                      </button>
                    )}
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
