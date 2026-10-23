"use client";
import { useSession } from 'next-auth/react';
import { submissionKey, clearSubmissionKey } from '@/lib/order-submission-client';
import { useState, useEffect, useCallback, useRef } from "react";
import axios from "axios";
import toast from "react-hot-toast";
import { CheckCircle, XCircle, RotateCcw, Bell, CreditCard, DollarSign } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface DepositRequest {
  id: string;
  amount: number;
  status: "PENDING" | "APPROVED" | "REJECTED";
  receiptImage: string | null;
  notes: string | null;
  createdAt: string;
  seller: { name: string; email: string; phone: string };
}

interface SellerRow {
  id: string;
  name: string;
  email: string;
  phone: string;
  balance: number;
  walletId: string | null;
}

interface Counts { pending: number; approved: number; rejected: number; total: number }

type Tab = "deposits" | "balances";
type StatusFilter = "PENDING" | "APPROVED" | "REJECTED" | "ALL";

// ─── Reject Modal ─────────────────────────────────────────────────────────────

function RejectModal({
  deposit,
  onClose,
  onDone,
}: {
  deposit: DepositRequest;
  onClose: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setLoading(true);
    const tid = toast.loading("جاري الرفض...");
    try {
      await axios.post("/api/admin/deposits/reject", {
        id: deposit.id,
        reason: reason || "تم الرفض من قِبل الإدارة",
      });
      toast.success("تم رفض الطلب", { id: tid });
      onDone();
      onClose();
    } catch (err: unknown) {
      toast.error(axios.isAxiosError(err) ? err.response?.data?.error || "حدث خطأ" : "حدث خطأ", { id: tid });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center p-0 md:p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-t-2xl md:rounded-2xl shadow-2xl w-full md:max-w-md">
        <div className="flex items-center justify-between p-5 border-b border-slate-100">
          <h3 className="text-lg font-black text-[#1E293B]">رفض طلب الشحن</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-2xl leading-none">×</button>
        </div>
        <div className="p-5 space-y-4">
          <div className="bg-red-50 rounded-xl p-3.5 border border-red-100">
            <p className="text-sm font-bold text-red-700">{deposit.seller.name}</p>
            <p className="text-xl font-black text-red-600 mt-1">{Number(deposit.amount).toFixed(2)} د.م</p>
          </div>
          <div>
            <label className="text-xs font-bold text-slate-500 block mb-1.5">سبب الرفض</label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder="مثال: الوصل غير واضح، يرجى إرسال وصل أوضح..."
              className="w-full border border-gray-200 focus:border-red-400 p-3 rounded-xl outline-none bg-[#F8FAFC] focus:bg-white text-sm resize-none"
            />
          </div>
          <div className="flex gap-3">
            <button onClick={onClose} className="flex-1 border border-slate-200 text-slate-600 py-3 rounded-xl font-bold hover:bg-slate-50 transition min-h-[48px]">
              إلغاء
            </button>
            <button
              onClick={submit}
              disabled={loading}
              className="flex-1 bg-red-500 hover:bg-red-600 text-white py-3 rounded-xl font-bold transition disabled:opacity-50 min-h-[48px]"
            >
              {loading ? "جاري..." : <span className="flex items-center justify-center gap-1">تأكيد الرفض <XCircle className="w-4 h-4" /></span>}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Topup Modal ──────────────────────────────────────────────────────────────

function TopupModal({
  seller,
  onClose,
  onDone,
}: {
  seller: SellerRow;
  onClose: () => void;
  onDone: () => void;
}) {
  const { data: session } = useSession();
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [completed, setCompleted] = useState(false);
  const lock = useRef(false);
  const pending = useRef<{ targetUserId: string; amount: string; note: string } | null>(null);
  const pendingActor = useRef<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (lock.current || !session?.user?.id) return;
    if (pendingActor.current && pendingActor.current !== session.user.id) { toast.error('تغير الحساب. راجع القيود قبل أي عملية جديدة'); return; }
    pendingActor.current ??= session.user.id;
    lock.current = true; setLoading(true);
    const tid = toast.loading('جاري الشحن...');
    let sent = false;
    let acknowledged = false;
    try {
      const payload = pending.current ?? { targetUserId: seller.id, amount, note };
      pending.current ??= { ...payload };
      const key = await submissionKey(session.user.id, 'admin-topup:' + seller.id, payload);
      sent = true;
      await axios.post('/api/admin/wallet/topup', payload, { headers: { 'Idempotency-Key': key } });
      acknowledged = true; setCompleted(true);
      // A successful save must not be turned into an uncertain retry by local cleanup.
      try { clearSubmissionKey(session.user.id, 'admin-topup:' + seller.id); } catch { /* Receipt remains safe for replay. */ }
      toast.success('تم تأكيد شحن المحفظة', { id: tid });
      onDone(); onClose();
    } catch (error) {
      if (acknowledged) { toast.error('تم الشحن. راجع سجل المحفظة؛ لا ترسل العملية مرة أخرى', { id: tid }); return; }
      const status = axios.isAxiosError(error) ? error.response?.status : undefined;
      const unknown = sent && (!status || status >= 500);
      setUncertain(unknown);
      if (!unknown) { pending.current = null; pendingActor.current = null; }
      lock.current = false;
      toast.error(unknown ? 'نتيجة غير مؤكدة. أعد المحاولة بنفس البيانات؛ لا تنشئ شحناً جديداً قبل مراجعة القيود' : 'تعذر الشحن. راجع البيانات والاتصال', { id: tid });
    } finally { setLoading(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center p-0 md:p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-t-2xl md:rounded-2xl shadow-2xl w-full md:max-w-md">
        <div className="flex items-center justify-between p-5 border-b border-slate-100">
          <h3 className="text-lg font-black text-[#1E293B]">شحن مباشر للمحفظة</h3>
          <button disabled={loading || uncertain} onClick={onClose} className="text-slate-400 hover:text-slate-700 text-2xl leading-none">×</button>
        </div>
        <form onSubmit={submit} className="p-5 space-y-4">
          <div className="bg-[#EEF2FF] rounded-xl p-3.5 border border-blue-100">
            <p className="text-xs font-bold text-slate-400">البائع</p>
            <p className="text-base font-black text-[#1E293B]">{seller.name}</p>
            <p className="text-sm text-slate-400">{seller.email}</p>
            <p className="text-sm font-bold text-[#4361EE] mt-1">الرصيد الحالي: {seller.balance.toFixed(2)} د.م</p>
          </div>
          <div>
            <label className="text-xs font-bold text-slate-500 block mb-1.5">المبلغ (درهم) <span className="text-red-500">*</span></label>
            <input
              required
              type="number"
              step="0.01"
              min="1"
              disabled={loading || uncertain || completed}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className="w-full border border-gray-200 focus:border-[#4361EE] p-3 rounded-xl outline-none bg-[#F8FAFC] font-bold text-xl"
            />
          </div>
          <div>
            <label className="text-xs font-bold text-slate-500 block mb-1.5">ملاحظة (اختياري)</label>
            <input
              type="text"
              disabled={loading || uncertain}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="شحن يدوي من الإدارة..."
              className="w-full border border-gray-200 focus:border-[#4361EE] p-3 rounded-xl outline-none bg-[#F8FAFC] text-sm"
            />
          </div>
          <div className="flex gap-3">
            <button type="button" disabled={loading || uncertain} onClick={onClose} className="flex-1 border border-slate-200 text-slate-600 py-3 rounded-xl font-bold hover:bg-slate-50 transition min-h-[48px]">
              إلغاء
            </button>
            <button
              type="submit"
              disabled={loading || completed || !amount || !session?.user?.id}
              className="flex-1 bg-[#4361EE] hover:bg-[#3254D4] text-white py-3 rounded-xl font-bold transition disabled:opacity-50 min-h-[48px]"
            >
              {loading ? "جاري..." : <span className="flex items-center justify-center gap-1">{completed ? 'تم الشحن' : uncertain ? 'إعادة المحاولة الآمنة' : 'شحن الرصيد'} <CheckCircle className="w-4 h-4" /></span>}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  if (status === "PENDING")  return <span className="bg-amber-100 text-amber-700 border border-amber-200 text-xs font-bold px-2.5 py-1 rounded-full">في الانتظار</span>;
  if (status === "APPROVED") return <span className="bg-green-100 text-green-700 border border-green-200 text-xs font-bold px-2.5 py-1 rounded-full flex items-center gap-1 w-fit">تم الشحن <CheckCircle className="w-3 h-3" /></span>;
  if (status === "REJECTED") return <span className="bg-red-100 text-red-600 border border-red-200 text-xs font-bold px-2.5 py-1 rounded-full flex items-center gap-1 w-fit">مرفوض <XCircle className="w-3 h-3" /></span>;
  return null;
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function AdminDepositsPage() {
  const [tab, setTab] = useState<Tab>("deposits");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("PENDING");
  const [requests, setRequests] = useState<DepositRequest[]>([]);
  const [counts, setCounts] = useState<Counts>({ pending: 0, approved: 0, rejected: 0, total: 0 });
  const [sellers, setSellers] = useState<SellerRow[]>([]);
  const [loadingDeposits, setLoadingDeposits] = useState(true);
  const [loadingSellers, setLoadingSellers] = useState(false);
  const [rejectTarget, setRejectTarget] = useState<DepositRequest | null>(null);
  const [topupTarget, setTopupTarget] = useState<SellerRow | null>(null);

  const fetchDeposits = useCallback(async (filter: StatusFilter = statusFilter) => {
    setLoadingDeposits(true);
    try {
      const params = filter === "ALL" ? "" : `?status=${filter}`;
      const res = await axios.get(`/api/admin/deposits${params}`);
      setRequests(res.data.requests);
      setCounts(res.data.counts);
    } catch {
      toast.error("فشل جلب الطلبات");
    } finally {
      setLoadingDeposits(false);
    }
  }, [statusFilter]);

  const fetchSellers = useCallback(async () => {
    setLoadingSellers(true);
    try {
      const res = await axios.get("/api/admin/wallet/sellers");
      setSellers(res.data.sellers);
    } catch {
      toast.error("فشل جلب الأرصدة");
    } finally {
      setLoadingSellers(false);
    }
  }, []);

  useEffect(() => { fetchDeposits(); }, [fetchDeposits]);

  useEffect(() => {
    if (tab === "balances" && sellers.length === 0) fetchSellers();
  }, [tab, sellers.length, fetchSellers]);

  const handleFilterChange = (f: StatusFilter) => {
    setStatusFilter(f);
    fetchDeposits(f);
  };

  const approveDeposit = async (id: string) => {
    const tid = toast.loading("جاري تنفيذ العملية...");
    try {
      const res = await axios.post("/api/admin/deposits/approve", { id });
      toast.success(`تم شحن الرصيد بنجاح — الرصيد الجديد: ${Number(res.data.newBalance).toFixed(2)} د.م`, { id: tid, duration: 5000 });
      fetchDeposits();
    } catch (err: unknown) {
      toast.error(axios.isAxiosError(err) ? err.response?.data?.error || "حدث خطأ" : "حدث خطأ", { id: tid });
    }
  };

  // ── Deposits tab ────────────────────────────────────────────────────────────
  const depositsContent = (
    <div className="space-y-5">
      {/* Filter tabs */}
      <div className="flex items-center gap-2 overflow-x-auto pb-0.5">
        {(["PENDING", "APPROVED", "REJECTED", "ALL"] as StatusFilter[]).map((f) => {
          const labels: Record<StatusFilter, string> = {
            PENDING:  `في الانتظار (${counts.pending})`,
            APPROVED: `معتمدة (${counts.approved})`,
            REJECTED: `مرفوضة (${counts.rejected})`,
            ALL:      `الكل (${counts.total})`,
          };
          return (
            <button
              key={f}
              onClick={() => handleFilterChange(f)}
              className={`px-4 py-2 rounded-xl text-sm font-bold transition border whitespace-nowrap flex-shrink-0 min-h-[44px] ${
                statusFilter === f
                  ? "bg-[#4361EE] text-white border-[#4361EE] shadow-sm"
                  : "bg-white text-slate-500 border-[#E2E8F0] hover:border-[#4361EE] hover:text-[#4361EE]"
              }`}
            >
              {labels[f]}
            </button>
          );
        })}
        <button
          onClick={() => fetchDeposits()}
          className="mr-auto px-3 py-2 rounded-xl text-sm font-bold text-slate-400 hover:text-[#4361EE] transition flex-shrink-0 flex items-center gap-1"
        >
          <RotateCcw className="w-4 h-4" /> تحديث
        </button>
      </div>

      {/* Deposit cards */}
      {loadingDeposits ? (
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 border-4 border-[#4361EE] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : requests.length === 0 ? (
        <div className="bg-white rounded-2xl border-2 border-dashed border-[#E2E8F0] p-16 text-center">
          <div className="w-14 h-14 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto mb-3">
            <DollarSign className="w-7 h-7 text-slate-400" />
          </div>
          <p className="text-slate-400 font-bold">لا توجد طلبات شحن في هذا التصنيف</p>
        </div>
      ) : (
        <div className="space-y-3">
          {requests.map((req) => (
            <div key={req.id} className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] overflow-hidden flex">
              {/* Left accent */}
              <div className={`w-1.5 flex-shrink-0 ${req.status === "PENDING" ? "bg-amber-400" : req.status === "APPROVED" ? "bg-green-500" : "bg-red-400"}`} />

              <div className="flex flex-col gap-4 p-4 md:p-5 flex-1">
                {/* Info row */}
                <div className="flex gap-4 items-center">
                  {/* Receipt thumbnail */}
                  <div className="w-14 h-14 md:w-16 md:h-16 bg-[#F8FAFC] rounded-xl border border-[#E2E8F0] flex items-center justify-center overflow-hidden flex-shrink-0">
                    {req.receiptImage ? (
                      <a href={req.receiptImage} target="_blank" rel="noreferrer" title="عرض الوصل الكامل">
                        <img src={req.receiptImage} alt="وصل" className="object-cover w-full h-full hover:opacity-80 transition" />
                      </a>
                    ) : (
                      <span className="text-2xl text-slate-300">—</span>
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <p className="text-xl md:text-2xl font-black text-[#1E293B]">
                        {Number(req.amount).toFixed(2)}
                        <span className="text-base font-normal text-slate-400 mr-1">د.م</span>
                      </p>
                      <StatusBadge status={req.status} />
                    </div>
                    <p className="text-sm font-bold text-slate-600 truncate">{req.seller.name}</p>
                    <p className="text-xs text-slate-400 truncate">{req.seller.phone} · {req.seller.email}</p>
                    <p className="text-xs text-slate-300 mt-0.5">{new Date(req.createdAt).toLocaleString("ar-MA")}</p>
                    {req.notes && req.status === "REJECTED" && (
                      <p className="text-xs text-red-500 font-medium mt-1">سبب الرفض: {req.notes}</p>
                    )}
                  </div>
                </div>

                {/* Action buttons (full width on mobile) */}
                {req.status === "PENDING" && (
                  <div className="flex gap-2">
                    <button
                      onClick={() => setRejectTarget(req)}
                      className="flex-1 md:flex-none bg-red-50 text-red-600 px-4 py-2.5 rounded-xl font-bold hover:bg-red-100 transition border border-red-100 text-sm min-h-[44px]"
                    >
                      <span className="flex items-center gap-1">رفض <XCircle className="w-4 h-4" /></span>
                    </button>
                    <button
                      onClick={() => approveDeposit(req.id)}
                      className="flex-1 md:flex-none bg-green-600 text-white px-5 py-2.5 rounded-xl font-bold hover:bg-green-700 transition shadow-sm text-sm min-h-[44px]"
                    >
                      <span className="flex items-center gap-1">تأكيد الشحن <CheckCircle className="w-4 h-4" /></span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  // ── Balances tab ────────────────────────────────────────────────────────────
  const balancesContent = (
    <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm overflow-hidden">
      {loadingSellers ? (
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 border-4 border-[#4361EE] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : sellers.length === 0 ? (
        <div className="text-center py-16">
          <div className="w-14 h-14 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto mb-3">
            <Bell className="w-7 h-7 text-slate-400" />
          </div>
          <p className="text-slate-400 font-bold">لا يوجد بائعون نشطون</p>
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <table className="hidden md:table w-full text-sm" dir="rtl">
            <thead>
              <tr className="bg-[#F8FAFC] text-xs font-bold text-slate-400 border-b border-[#F1F5F9]">
                <th className="py-3 px-5 text-right">البائع</th>
                <th className="py-3 px-5 text-right">البريد / الهاتف</th>
                <th className="py-3 px-5 text-left">الرصيد</th>
                <th className="py-3 px-5 text-center">إجراء</th>
              </tr>
            </thead>
            <tbody>
              {sellers.map((s) => (
                <tr key={s.id} className="border-b border-[#F1F5F9] last:border-0 hover:bg-[#F8FAFC] transition">
                  <td className="py-3.5 px-5">
                    <p className="font-bold text-[#1E293B]">{s.name}</p>
                  </td>
                  <td className="py-3.5 px-5">
                    <p className="text-slate-500 text-xs">{s.email}</p>
                    <p className="text-slate-400 text-xs">{s.phone}</p>
                  </td>
                  <td className="py-3.5 px-5 text-left" dir="ltr">
                    <span className={`font-black text-base ${s.balance > 0 ? "text-green-600" : s.balance < 0 ? "text-red-500" : "text-slate-400"}`}>
                      {s.balance.toFixed(2)}
                    </span>
                    <span className="text-xs text-slate-400 mr-1">د.م</span>
                  </td>
                  <td className="py-3.5 px-5 text-center">
                    <button
                      onClick={() => setTopupTarget(s)}
                      className="bg-[#4361EE]/10 hover:bg-[#4361EE]/20 text-[#4361EE] px-3 py-1.5 rounded-lg font-bold text-xs transition"
                    >
                      + شحن
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Mobile cards */}
          <div className="md:hidden divide-y divide-[#F1F5F9]">
            {sellers.map((s) => (
              <div key={s.id} className="p-4 flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-[#4361EE] text-white font-black text-sm flex items-center justify-center flex-shrink-0">
                  {s.name.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-bold text-[#1E293B] truncate">{s.name}</p>
                    <span className={`font-black text-sm flex-shrink-0 ${s.balance > 0 ? "text-green-600" : s.balance < 0 ? "text-red-500" : "text-slate-400"}`}>
                      {s.balance.toFixed(2)} <span className="text-xs font-normal text-slate-400">د.م</span>
                    </span>
                  </div>
                  <p className="text-slate-400 text-xs truncate">{s.phone}</p>
                </div>
                <button
                  onClick={() => setTopupTarget(s)}
                  className="bg-[#4361EE]/10 hover:bg-[#4361EE]/20 text-[#4361EE] px-3 py-2 rounded-lg font-bold text-xs transition flex-shrink-0 min-h-[44px]"
                >
                  + شحن
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );

  // ── Page render ─────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6" dir="rtl">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl md:text-2xl font-black text-[#1E293B]">إدارة المحافظ المالية</h2>
          <p className="text-slate-400 text-sm mt-0.5">مراجعة طلبات الشحن وإدارة أرصدة البائعين</p>
        </div>

        {/* Summary chips */}
        <div className="flex gap-2 flex-wrap">
          {counts.pending > 0 && (
            <span className="bg-amber-100 text-amber-700 font-bold text-sm px-4 py-2 rounded-xl border border-amber-200">
              <span className="flex items-center gap-1"><Bell className="w-4 h-4" /> {counts.pending} طلب معلق</span>
            </span>
          )}
          <span className="bg-[#EEF2FF] text-[#4361EE] font-bold text-sm px-4 py-2 rounded-xl border border-[#4361EE]/20">
            {counts.total} إجمالي
          </span>
        </div>
      </div>

      {/* Tab switcher — full width on mobile */}
      <div className="flex gap-1 bg-[#F1F5F9] p-1 rounded-xl">
        <button
          onClick={() => setTab("deposits")}
          className={`flex-1 md:flex-none md:px-5 py-2.5 rounded-lg text-sm font-bold transition ${tab === "deposits" ? "bg-white text-[#4361EE] shadow-sm" : "text-slate-400 hover:text-slate-600"}`}
        >
          <span className="flex items-center gap-1"><CreditCard className="w-4 h-4" /> طلبات الشحن</span>
          {counts.pending > 0 && (
            <span className="mr-1.5 bg-[#FB923C] text-white text-xs rounded-full px-1.5 py-0.5">{counts.pending}</span>
          )}
        </button>
        <button
          onClick={() => setTab("balances")}
          className={`flex-1 md:flex-none md:px-5 py-2.5 rounded-lg text-sm font-bold transition ${tab === "balances" ? "bg-white text-[#4361EE] shadow-sm" : "text-slate-400 hover:text-slate-600"}`}
        >
          <span className="flex items-center gap-1"><DollarSign className="w-4 h-4" /> أرصدة البائعين</span>
        </button>
      </div>

      {/* Tab content */}
      {tab === "deposits" ? depositsContent : balancesContent}

      {rejectTarget && (
        <RejectModal
          deposit={rejectTarget}
          onClose={() => setRejectTarget(null)}
          onDone={fetchDeposits}
        />
      )}

      {topupTarget && (
        <TopupModal
          seller={topupTarget}
          onClose={() => setTopupTarget(null)}
          onDone={fetchSellers}
        />
      )}
    </div>
  );
}
