"use client";
import { useState, useEffect } from "react";
import axios from "axios";
import Link from "next/link";
import { Package, Truck, FileText } from "lucide-react";

export default function LogisticsPage() {
  const [batches, setBatches] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchReadyBatches = async () => {
    setLoading(true);
    try {
      const res = await axios.get("/api/admin/logistics/ready");
      if (res.data.success) setBatches(res.data.batches);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchReadyBatches(); }, []);

  const markAsShipped = async (batchId: string) => {
    if (!confirm("هل أنت متأكد من خروج هذه الشحنة من المستودع؟")) return;
    const reason = window.prompt("سبب الإرسال اليدوي (يسجل في سجل التدقيق)");
    if (!reason?.trim()) return;
    try {
      const res = await axios.post("/api/admin/logistics/ship", { batchId, reason });
      if (res.data.success) {
        alert("تم تحديث الحالة إلى (مشحون) بنجاح!");
        fetchReadyBatches();
      }
    } catch (error) {
      alert(axios.isAxiosError(error) ? error.response?.data?.error ?? "تعذر الإرسال" : "تعذر الإرسال");
    }
  };

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin rounded-full h-8 w-8 border-2 border-[#4361EE] border-t-transparent"></div>
      <span className="mr-3 text-[#4361EE] font-bold">جاري فحص المستودع...</span>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-black text-[#1E293B]">غرفة تجهيز الشحنات</h2>
          <p className="text-slate-400 text-sm mt-0.5">الدفعات المدفوعة الجاهزة للتغليف والإرسال</p>
        </div>
        <span className="bg-[#4361EE]/10 text-[#4361EE] font-bold text-sm px-4 py-2 rounded-xl border border-[#4361EE]/20">
          {batches.length} دفعة جاهزة
        </span>
      </div>

      {batches.length === 0 ? (
        <div className="bg-white rounded-2xl border-2 border-dashed border-[#E2E8F0] p-20 text-center">
          <div className="w-14 h-14 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto mb-3">
            <Package className="w-7 h-7 text-slate-400" />
          </div>
          <p className="text-slate-400 font-bold">لا توجد شحنات مدفوعة حالياً</p>
          <p className="text-slate-300 text-sm mt-1">بمجرد أن يقوم البائع بالدفع، ستظهر هنا</p>
        </div>
      ) : (
        <div className="grid gap-5">
          {batches.map((batch: any) => (
            <div key={batch.id} className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] overflow-hidden">
              <div className="h-1 bg-[#4361EE]"></div>
              <div className="p-6 flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-3">
                    <span className="bg-[#1E293B] text-white text-xs px-3 py-1 rounded-lg font-mono">
                      #{batch.id.slice(-8).toUpperCase()}
                    </span>
                    <h3 className="font-bold text-[#1E293B]">بواسطة: {batch.seller.name}</h3>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
                    <div className="bg-[#F8FAFC] rounded-xl p-3 border border-[#E2E8F0]">
                      <p className="text-slate-400 text-xs mb-1">عدد الطلبات</p>
                      <p className="font-black text-[#1E293B] text-lg">{batch.orders.length}</p>
                    </div>
                    <div className="bg-[#F8FAFC] rounded-xl p-3 border border-[#E2E8F0]">
                      <p className="text-slate-400 text-xs mb-1">المبلغ المدفوع</p>
                      <p className="font-black text-green-600 text-lg">{Number(batch.totalAmount).toFixed(2)} د.م</p>
                    </div>
                    <div className="bg-[#F8FAFC] rounded-xl p-3 border border-[#E2E8F0]">
                      <p className="text-slate-400 text-xs mb-1">تاريخ الدفع</p>
                      <p className="font-bold text-[#1E293B]">{new Date(batch.createdAt).toLocaleDateString("ar-MA")}</p>
                    </div>
                  </div>
                </div>

                <div className="flex gap-3 w-full md:w-auto">
                  <Link
                    href={`/admin/logistics/manifest/${batch.id}`}
                    target="_blank"
                    className="flex-1 md:flex-none flex items-center justify-center gap-2 bg-[#F8FAFC] border border-[#E2E8F0] text-[#1E293B] px-5 py-3 rounded-xl font-bold hover:bg-gray-100 transition"
                  >
                    <FileText className="w-4 h-4" /> المانيفست
                  </Link>
                  <button
                    onClick={() => markAsShipped(batch.id)}
                    className="flex-1 md:flex-none bg-[#4361EE] hover:bg-[#3254D4] text-white px-7 py-3 rounded-xl font-bold transition shadow-sm flex items-center justify-center gap-2"
                  >
                    <Truck className="w-4 h-4" /> تم الشحن
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
