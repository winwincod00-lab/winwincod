"use client";
import { useEffect, useState } from "react";
import BatchBuilder from "@/components/seller/BatchBuilder";
import axios from "axios";
import { Package, CheckCircle } from "lucide-react";

export default function SellerBatches() {
  type Batch = { id: string; createdAt: string; totalAmount: string; isPaid: boolean; units: number; reviewStatus: string; orders: { id: string; quantity: number; status: string }[] };
  const [batches, setBatches] = useState<Batch[]>([]);
  const [error, setError] = useState(false);
  const [paying, setPaying] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true); setError(false);
    axios.get("/api/seller/batches/list").then(res => {
      setBatches(res.data.batches);
      setLoading(false);
    }).catch(() => setError(true)).finally(() => setLoading(false));
  }, [revision]);

  const handlePay = async (batchId: string) => {
    if (paying) return;
    if (!confirm("هل تريد دفع تكلفة هذه الدفعة من محفظتك؟")) return;
    setPaying(batchId);
    try {
      await axios.post("/api/seller/batches/pay", { batchId });
      alert("تم الدفع بنجاح! طلباتك قيد التجهيز الآن.");
      setRevision(n => n + 1);
    } catch (err: unknown) {
      alert(axios.isAxiosError(err) ? err.response?.data?.error || "فشل الدفع" : "فشل الدفع");
    } finally { setPaying(null); }
  };

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin rounded-full h-8 w-8 border-2 border-[#4361EE] border-t-transparent"></div>
      <span className="mr-3 text-[#4361EE] font-bold">جاري تحميل الدفعات...</span>
    </div>
  );

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-black text-[#1E293B]">دفعاتي</h2>
        <p className="text-slate-400 text-sm mt-0.5">متابعة حالة الدفعات المُرسلة للمعالجة</p>
      </div>

      <BatchBuilder onCreated={() => setRevision(n => n + 1)} />
      {error ? <div role="alert">فشل تحميل الدفعات. <button className="p-3 underline" onClick={() => setRevision(n => n + 1)}>إعادة المحاولة</button></div> : batches.length === 0 ? (
        <div className="bg-white rounded-2xl border-2 border-dashed border-[#E2E8F0] p-16 text-center">
          <div className="w-14 h-14 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto mb-3">
            <Package className="w-7 h-7 text-slate-400" />
          </div>
          <p className="text-slate-400 font-bold">لا توجد دفعات حتى الآن</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] overflow-x-auto">
          <table className="w-full text-right text-sm">
            <thead>
              <tr className="bg-[#F8FAFC] border-b border-[#E2E8F0] text-slate-500 font-bold">
                <th className="p-4">رقم الدفعة</th>
                <th className="p-4">تاريخ الإنشاء</th>
                <th className="p-4">عدد الطلبات</th>
                <th className="p-4">المبلغ</th>
                <th className="p-4">الحالة</th>
                <th className="p-4">الإجراء</th>
              </tr>
            </thead>
            <tbody>
              {batches.map((batch) => (
                <tr key={batch.id} className="border-b border-[#E2E8F0] hover:bg-[#F8FAFC] transition">
                  <td className="p-4 font-mono text-xs text-slate-400">#{batch.id.slice(-8).toUpperCase()}</td>
                  <td className="p-4 text-slate-500">{new Date(batch.createdAt).toLocaleDateString("ar-MA")}</td>
                  <td className="p-4 font-bold text-[#1E293B]">{batch.orders.length} · {batch.units} PCS</td>
                  <td className="p-4 font-bold text-[#4361EE]">{Number(batch.totalAmount).toFixed(2)} <span className="text-slate-400 font-normal">د.م</span></td>
                  <td className="p-4">
                    {batch.isPaid ? (
                      <span className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-green-50 text-green-700 border border-green-100">تم الدفع <CheckCircle className="w-3.5 h-3.5" /></span>
                    ) : (
                      <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-[#FB923C]/10 text-[#FB923C] border border-[#FB923C]/20">{batch.reviewStatus === 'APPROVED' ? 'Approuvé — paiement requis' : batch.reviewStatus === 'REJECTED' ? 'Rejeté par Admin' : 'En attente de revue Admin'}</span>
                    )}
                  </td>
                  <td className="p-4">
                    {!batch.isPaid && batch.reviewStatus === 'APPROVED' && Number(batch.totalAmount) > 0 && (
                      <button
                        disabled={paying !== null}
                        onClick={() => handlePay(batch.id)}
                        className="bg-[#4361EE] hover:bg-[#3254D4] text-white px-4 py-1.5 rounded-lg text-xs font-bold transition shadow-sm"
                      >
                        دفع الآن
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
