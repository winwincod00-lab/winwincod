"use client";
import { useState, useEffect } from "react";
import { productImages } from "@/lib/product-images";
import axios from "axios";
import Link from "next/link";
import { Briefcase, Package, Rocket } from "lucide-react";

export default function MyCatalogPage() {
  const [items, setItems] = useState([]);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    axios.get("/api/seller/catalog")
      .then(res => { setItems(res.data.products); })
      .catch(() => setError(true)).finally(() => setLoading(false));
  }, [revision]);

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin rounded-full h-8 w-8 border-2 border-[#4361EE] border-t-transparent"></div>
      <span className="mr-3 text-[#4361EE] font-bold">جاري تحميل منتجاتك...</span>
    </div>
  );

  if (error) return <div role="alert">تعذر تحميل منتجاتك. <button className="p-3 underline" onClick={() => { setError(false); setLoading(true); setRevision(value => value + 1); }}>إعادة المحاولة</button></div>;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-3 justify-between items-center">
        <div>
          <h2 className="text-2xl font-black text-[#1E293B]">منتجاتي</h2>
          <p className="text-slate-400 text-sm mt-0.5">المنتجات التي أضفتها لقائمة عملك</p>
        </div>
        <Link href="/seller/products" className="bg-[#4361EE] hover:bg-[#3254D4] text-white px-5 py-2.5 rounded-xl font-bold transition shadow-sm text-sm">
          + إضافة منتجات
        </Link>
      </div>

      {items.length === 0 ? (
        <div className="bg-white rounded-2xl border-2 border-dashed border-[#E2E8F0] p-20 text-center">
          <div className="w-14 h-14 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto mb-3">
            <Briefcase className="w-7 h-7 text-slate-400" />
          </div>
          <p className="text-slate-400 font-bold mb-4">لم تضف أي منتج لقائمتك بعد</p>
          <Link href="/seller/products" className="bg-[#4361EE] text-white px-6 py-2.5 rounded-xl font-bold hover:bg-[#3254D4] transition">
            تصفح السوق
          </Link>
        </div>
      ) : (
        <div className="grid gap-4">
          {items.map((item: any) => (
            <div key={item.id} className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] p-5 flex flex-col md:flex-row gap-5 items-center hover:shadow-md transition">
              {/* Thumbnail */}
              <div className="w-20 h-20 bg-[#F8FAFC] rounded-xl border border-[#E2E8F0] overflow-hidden flex-shrink-0">
                {productImages(item.product.images).length > 0 ? (
                  <img src={productImages(item.product.images)[0]} className="w-full h-full object-cover" alt={item.product.name} />
                ) : (
                  <div className="flex items-center justify-center h-full"><Package className="w-5 h-5 text-slate-300" /></div>
                )}
              </div>

              {/* Info */}
              <div className="flex-1">
                <h3 className="font-bold text-[#1E293B]">{item.product.name}</h3>
                <div className="flex flex-wrap gap-4 mt-2 text-sm">
                  <span className="text-slate-500">التكلفة: <strong className="text-[#4361EE]">{Number(item.product.sellerPrice).toFixed(0)} د.م</strong></span>
                  <span className="text-slate-500">سعر السوق: <strong className="text-green-600">{Number(item.product.marketPrice).toFixed(0)} د.م</strong></span>
                  <span className="text-slate-500">المخزون: <strong className={item.product.stock > 0 ? "text-[#1E293B]" : "text-red-500"}>{item.product.stock}</strong></span>
                </div>
              </div>

              {/* Actions */}
              <div className="flex gap-3 w-full md:w-auto flex-shrink-0">
                <Link href={`/seller/products/${item.product.id}`} className="flex items-center gap-1 px-4 py-2 border rounded-xl font-bold text-sm">عرض الصور والتفاصيل</Link>
                <Link
                  href={`/seller/orders/new?productId=${item.product.id}`}
                  className="flex items-center gap-1 px-6 py-2 bg-[#4361EE] hover:bg-[#3254D4] text-white rounded-xl font-bold text-sm transition shadow-sm"
                >
                  <Rocket className="w-4 h-4" /> بيع الآن
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
