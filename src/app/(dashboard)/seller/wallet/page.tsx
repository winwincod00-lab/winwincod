"use client";
import { useState, useEffect, useCallback, type ReactNode } from "react";
import axios from "axios";
import toast from "react-hot-toast";
import { CreditCard, Package, DollarSign, RotateCcw, Banknote, Paperclip, CheckCircle } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";

// ─── Types ────────────────────────────────────────────────────────────────────

type TxType = "DEPOSIT" | "DEDUCTION" | "PROFIT" | "REFUND" | "WITHDRAWAL";
type TxStatus = "PENDING" | "APPROVED" | "REJECTED" | "AUTO";

interface WalletItem {
  id: string;
  type: TxType;
  amount: number;
  status: TxStatus;
  note: string | null;
  receiptUrl: string | null;
  orderId: string | null;
  createdAt: string;
}

interface Stats {
  totalDeposits: number;
  totalDeductions: number;
  totalProfits: number;
}

// ─── CSS-only constants (no text labels) ──────────────────────────────────────

const TYPE_ICON: Record<TxType, ReactNode> = {
  DEPOSIT:    <CreditCard className="w-5 h-5" />,
  DEDUCTION:  <Package className="w-5 h-5" />,
  PROFIT:     <DollarSign className="w-5 h-5" />,
  REFUND:     <RotateCcw className="w-5 h-5" />,
  WITHDRAWAL: <Banknote className="w-5 h-5" />,
};

const STATUS_CLS: Record<TxStatus, string> = {
  PENDING:  "bg-amber-100 text-amber-700 border border-amber-200",
  APPROVED: "bg-green-100 text-green-700 border border-green-200",
  REJECTED: "bg-red-100 text-red-600 border border-red-200",
  AUTO:     "bg-slate-100 text-slate-600 border border-slate-200",
};

function fmt(n: number) {
  return n.toLocaleString("ar-MA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(d: string, lang: string) {
  return new Date(d).toLocaleDateString(lang === "fr" ? "fr-FR" : "ar-MA", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

// ─── Deposit Modal ────────────────────────────────────────────────────────────

function DepositModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const { t, lang } = useLanguage();
  const [amount, setAmount]       = useState("");
  const [receiptUrl, setReceiptUrl] = useState("");
  const [preview, setPreview]     = useState("");
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await axios.post("/api/upload", fd);
      setReceiptUrl(res.data.url);
      setPreview(URL.createObjectURL(file));
      toast.success(t("wallet.receiptUploaded"));
    } catch {
      toast.error(lang === "fr" ? "Échec du téléchargement" : "فشل رفع الصورة");
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!receiptUrl) {
      toast.error(lang === "fr" ? "Téléchargez le reçu d'abord" : "يرجى رفع وصل الدفع أولاً");
      return;
    }
    if (!amount || Number(amount) <= 0) {
      toast.error(lang === "fr" ? "Entrez un montant valide" : "أدخل مبلغاً صحيحاً");
      return;
    }
    setSubmitting(true);
    try {
      await axios.post("/api/seller/wallet/deposit", {
        amount: Number(amount),
        receiptImage: receiptUrl,
      });
      toast.success(lang === "fr" ? "Demande envoyée ! En attente de validation." : "تم إرسال طلب الشحن! بانتظار مراجعة الإدارة.");
      onSuccess();
      onClose();
    } catch (err: any) {
      toast.error(err.response?.data?.error || (lang === "fr" ? "Une erreur s'est produite" : "حدث خطأ"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center p-0 md:p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-t-2xl md:rounded-2xl shadow-2xl w-full md:max-w-md max-h-[95vh] overflow-y-auto" dir={lang === "fr" ? "ltr" : "rtl"}>
        <div className="flex items-center justify-between p-5 border-b border-slate-100">
          <h3 className="text-lg font-black text-[#1E293B]">{t("wallet.chargeWallet")}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-2xl leading-none transition">×</button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div className="bg-[#EEF2FF] rounded-xl p-3.5 border border-blue-100">
            <p className="text-sm text-[#4361EE] font-medium leading-relaxed">{t("wallet.chargeInfo")}</p>
          </div>

          <div>
            <label className="text-xs font-bold text-slate-500 block mb-1.5">{t("wallet.amountLabel")} <span className="text-red-500">*</span></label>
            <input
              required
              type="number"
              step="0.01"
              min="1"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              placeholder="0.00"
              className="w-full border border-gray-200 focus:border-[#4361EE] p-3 rounded-xl outline-none bg-[#F8FAFC] focus:bg-white text-[#1E293B] font-bold text-xl"
            />
          </div>

          <div>
            <label className="text-xs font-bold text-slate-500 block mb-1.5">{t("wallet.upload")} <span className="text-red-500">*</span></label>
            <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-[#4361EE]/40 rounded-xl cursor-pointer bg-[#F8FAFC] hover:bg-[#EEF2FF] transition overflow-hidden">
              {uploading ? (
                <div className="flex flex-col items-center gap-2">
                  <div className="w-6 h-6 border-2 border-[#4361EE] border-t-transparent rounded-full animate-spin" />
                  <span className="text-sm text-[#4361EE] font-bold">{t("wallet.uploading")}</span>
                </div>
              ) : preview ? (
                <img src={preview} alt={t("wallet.receipt")} className="h-full w-full object-contain p-1" />
              ) : (
                <div className="text-center">
                  <Paperclip className="w-8 h-8 text-slate-300 mx-auto mb-1" />
                  <p className="text-sm text-slate-400 font-medium">{t("wallet.clickToUpload")}</p>
                  <p className="text-xs text-slate-300 mt-0.5">JPG, PNG, PDF</p>
                </div>
              )}
              <input type="file" accept="image/*,application/pdf" className="hidden" onChange={handleFile} disabled={uploading} />
            </label>
            {receiptUrl && (
              <p className="text-xs text-green-600 font-bold mt-1.5 flex items-center gap-1">
                <CheckCircle className="w-3.5 h-3.5" /> {t("wallet.receiptUploaded")}
              </p>
            )}
          </div>

          <p className="text-xs text-slate-400 text-center">{t("wallet.notice")}</p>

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 border border-slate-200 text-slate-600 py-3 rounded-xl font-bold hover:bg-slate-50 transition min-h-[48px]"
            >
              {t("common.cancel")}
            </button>
            <button
              type="submit"
              disabled={submitting || uploading || !receiptUrl}
              className="flex-1 bg-[#FB923C] hover:bg-orange-500 text-white py-3 rounded-xl font-bold shadow-sm transition disabled:opacity-50 min-h-[48px]"
            >
              {submitting ? t("wallet.sending") : t("wallet.sendRequest")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Stats card ───────────────────────────────────────────────────────────────

function StatCard({ icon, label, value, color }: { icon: ReactNode; label: string; value: number; color: string }) {
  return (
    <div className={`bg-white border border-[#E2E8F0] rounded-xl p-3 md:p-5 shadow-sm flex flex-col md:flex-row items-center md:items-start gap-2 md:gap-4 ${color}`}>
      <div className={`w-8 h-8 md:w-12 md:h-12 rounded-lg md:rounded-xl flex items-center justify-center flex-shrink-0 ${color}`}>
        {icon}
      </div>
      <div className="text-center md:text-right">
        <p className="text-[10px] md:text-xs font-bold text-slate-400 leading-tight">{label}</p>
        <p className="text-sm md:text-xl font-black text-[#1E293B] mt-0.5">
          {fmt(value)}{" "}
          <span className="text-[10px] md:text-sm font-normal text-slate-400">د.م</span>
        </p>
      </div>
    </div>
  );
}

// ─── Desktop transaction row ──────────────────────────────────────────────────

function TxRow({ item }: { item: WalletItem }) {
  const { t, lang } = useLanguage();

  const TYPE_LABELS: Record<TxType, string> = {
    DEPOSIT:    t("wallet.depositType"),
    DEDUCTION:  t("wallet.deduction"),
    PROFIT:     t("wallet.profitType"),
    REFUND:     t("wallet.refund"),
    WITHDRAWAL: t("wallet.withdrawal"),
  };

  const STATUS_LABEL: Record<TxStatus, string> = {
    PENDING:  t("wallet.pending"),
    APPROVED: t("wallet.approved"),
    REJECTED: t("wallet.rejected"),
    AUTO:     t("wallet.auto"),
  };

  const isCredit = item.type === "DEPOSIT" || item.type === "PROFIT" || item.type === "REFUND";
  const isDebit  = item.type === "DEDUCTION" || item.type === "WITHDRAWAL";
  const badgeCls = item.type === "DEPOSIT" ? STATUS_CLS[item.status] : STATUS_CLS.AUTO;
  const badgeLabel = item.type === "DEPOSIT" ? STATUS_LABEL[item.status] : STATUS_LABEL.AUTO;

  return (
    <tr className="border-b border-[#F1F5F9] last:border-0 hover:bg-[#F8FAFC] transition">
      <td className="py-3.5 px-4">
        <div className="flex items-center gap-2">
          <span className="text-slate-400">{TYPE_ICON[item.type]}</span>
          <span className="font-bold text-sm text-[#1E293B]">{TYPE_LABELS[item.type]}</span>
        </div>
        {item.orderId && (
          <p className="text-xs text-slate-400 mt-0.5 mr-6">#{item.orderId.slice(-8)}</p>
        )}
      </td>
      <td className="py-3.5 px-4 text-left" dir="ltr">
        <span className={`font-black text-base ${isCredit ? "text-green-600" : isDebit ? "text-red-500" : "text-slate-600"}`}>
          {isCredit ? "+" : isDebit ? "-" : ""}{fmt(Math.abs(item.amount))}
        </span>
        <span className="text-xs text-slate-400 font-normal mr-1">د.م</span>
      </td>
      <td className="py-3.5 px-4">
        <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${badgeCls}`}>{badgeLabel}</span>
      </td>
      <td className="py-3.5 px-4">
        <span className="text-xs text-slate-400">{fmtDate(item.createdAt, lang)}</span>
      </td>
      <td className="py-3.5 px-4 max-w-[200px]">
        {item.status === "REJECTED" && item.note ? (
          <span className="text-xs text-red-500 font-medium">{item.note}</span>
        ) : item.note ? (
          <span className="text-xs text-slate-400 truncate block">{item.note}</span>
        ) : null}
        {item.receiptUrl && item.type === "DEPOSIT" && (
          <a href={item.receiptUrl} target="_blank" rel="noreferrer" className="text-xs text-[#4361EE] font-bold hover:underline block mt-0.5">
            {t("wallet.viewReceipt")}
          </a>
        )}
      </td>
    </tr>
  );
}

// ─── Mobile transaction card ──────────────────────────────────────────────────

function TxCard({ item }: { item: WalletItem }) {
  const { t, lang } = useLanguage();

  const TYPE_LABELS: Record<TxType, string> = {
    DEPOSIT:    t("wallet.depositType"),
    DEDUCTION:  t("wallet.deduction"),
    PROFIT:     t("wallet.profitType"),
    REFUND:     t("wallet.refund"),
    WITHDRAWAL: t("wallet.withdrawal"),
  };

  const STATUS_LABEL: Record<TxStatus, string> = {
    PENDING:  t("wallet.pending"),
    APPROVED: t("wallet.approved"),
    REJECTED: t("wallet.rejected"),
    AUTO:     t("wallet.auto"),
  };

  const isCredit = item.type === "DEPOSIT" || item.type === "PROFIT" || item.type === "REFUND";
  const isDebit  = item.type === "DEDUCTION" || item.type === "WITHDRAWAL";
  const badgeCls = item.type === "DEPOSIT" ? STATUS_CLS[item.status] : STATUS_CLS.AUTO;
  const badgeLabel = item.type === "DEPOSIT" ? STATUS_LABEL[item.status] : STATUS_LABEL.AUTO;

  return (
    <div className="p-4 flex items-start gap-3 border-b border-[#F1F5F9] last:border-0">
      <span className="text-slate-400 flex-shrink-0 mt-0.5">{TYPE_ICON[item.type]}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <p className="font-bold text-sm text-[#1E293B]">{TYPE_LABELS[item.type]}</p>
          <p className={`font-black text-sm flex-shrink-0 ${isCredit ? "text-green-600" : isDebit ? "text-red-500" : "text-slate-600"}`}>
            {isCredit ? "+" : isDebit ? "-" : ""}{fmt(Math.abs(item.amount))}
            <span className="text-xs font-normal text-slate-400 mr-0.5"> د.م</span>
          </p>
        </div>
        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
          <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${badgeCls}`}>{badgeLabel}</span>
          <span className="text-[11px] text-slate-400">{fmtDate(item.createdAt, lang)}</span>
        </div>
        {item.receiptUrl && item.type === "DEPOSIT" && (
          <a href={item.receiptUrl} target="_blank" rel="noreferrer" className="text-xs text-[#4361EE] font-bold hover:underline mt-1 block">
            {t("wallet.viewReceipt")}
          </a>
        )}
        {item.status === "REJECTED" && item.note && (
          <p className="text-xs text-red-500 mt-1">{item.note}</p>
        )}
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function SellerWalletPage() {
  const { t, lang } = useLanguage();
  const [balance, setBalance]       = useState<number | null>(null);
  const [items, setItems]           = useState<WalletItem[]>([]);
  const [stats, setStats]           = useState<Stats | null>(null);
  const [page, setPage]             = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal]           = useState(0);
  const [loading, setLoading]       = useState(true);
  const [balanceError, setBalanceError] = useState(false);
  const [balanceLoading, setBalanceLoading] = useState(true);
  const [historyError, setHistoryError] = useState(false);
  const [showModal, setShowModal]   = useState(false);

  const fetchBalance = useCallback(async () => {
    setBalanceLoading(true); setBalanceError(false);
    try {
      const res = await axios.get("/api/seller/wallet/balance");
      if (typeof res.data.balance !== 'number' || !Number.isFinite(res.data.balance)) throw new Error('Invalid balance');
      setBalance(res.data.balance);
    } catch { setBalance(null); setBalanceError(true); }
    finally { setBalanceLoading(false); }
  }, []);

  const fetchHistory = useCallback(async (p = 1) => {
    setLoading(true); setHistoryError(false);
    try {
      const res = await axios.get(`/api/seller/wallet/history?page=${p}&limit=20`);
      setItems(res.data.items);
      setStats(res.data.stats);
      setPage(p);
      setTotalPages(res.data.totalPages);
      setTotal(res.data.total);
    } catch {
      setHistoryError(true); setStats(null);
      toast.error(lang === "fr" ? "Erreur de chargement" : "فشل جلب السجل");
    } finally {
      setLoading(false);
    }
  }, [lang]);

  useEffect(() => {
    fetchBalance();
    fetchHistory(1);
  }, [fetchBalance, fetchHistory]);

  const handleDepositSuccess = () => {
    fetchBalance();
    fetchHistory(1);
  };

  return (
    <div className="space-y-4 md:space-y-6" dir={lang === "fr" ? "ltr" : "rtl"}>
      <div>
        <h2 className="text-xl md:text-2xl font-black text-[#1E293B]">{t("wallet.title")}</h2>
        <p className="text-slate-400 text-sm mt-0.5">
          {lang === "fr" ? "Gérez votre solde et suivez vos transactions" : "إدارة رصيدك وتتبع حركاتك المالية"}
        </p>
      </div>

      {/* ── Balance card ── */}
      <div className="bg-gradient-to-br from-[#4361EE] to-[#3A56D4] rounded-2xl p-5 md:p-7 shadow-lg shadow-blue-200">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <p className="text-blue-100 text-sm font-bold mb-1">{t("wallet.currentBalance")}</p>
            <div className="flex items-end gap-2">
              <span className="text-3xl md:text-5xl font-black text-white">{balanceLoading ? "…" : balance === null ? "—" : fmt(balance)}</span>
              <span className="text-base md:text-xl text-blue-200 font-bold mb-1">
                {lang === "fr" ? "MAD" : "درهم"}
              </span>
            </div>
            <p className="text-blue-200 text-xs mt-2 font-medium hidden md:block">
              {lang === "fr" ? "Vous pouvez recharger votre portefeuille par virement" : "يمكنك شحن محفظتك في أي وقت عبر التحويل البنكي"}
            </p>
          </div>
          <button
            onClick={() => setShowModal(true)}
            className="w-full md:w-auto bg-[#FB923C] hover:bg-orange-500 text-white px-6 py-3.5 rounded-xl font-black text-base shadow-lg transition flex items-center justify-center gap-2 min-h-[48px]"
          >
            <span className="text-xl">+</span> {t("wallet.deposit")}
          </button>
        </div>
      </div>

      {balanceError && <div role="alert" className="rounded-xl border border-red-300 bg-white p-3">{lang === 'fr' ? 'Solde indisponible.' : 'تعذر تحميل الرصيد.'}<button className="p-3 underline" onClick={fetchBalance}>{lang === 'fr' ? 'Réessayer' : 'إعادة المحاولة'}</button></div>}
      <p className="text-sm text-slate-600">{lang === 'fr' ? 'Le bénéfice affiché correspond aux écritures enregistrées, pas à une prévision. Le solde comprend aussi les dépôts et déductions ; consultez les mouvements pour le rapprochement.' : 'الأرباح المعروضة قيود مسجلة وليست توقعات. الرصيد يشمل أيضاً الشحن والخصم؛ راجع الحركات للتسوية.'}</p>
      {/* ── Stats row ── */}
      {!loading && stats && <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 md:gap-4">
        <StatCard icon={<CheckCircle className="w-5 h-5 text-green-500" />} label={t("wallet.totalDeposits")}   value={stats.totalDeposits}   color="bg-green-50" />
        <StatCard icon={<Package className="w-5 h-5 text-red-400" />}       label={t("wallet.totalDeductions")} value={stats.totalDeductions} color="bg-red-50" />
        <StatCard icon={<DollarSign className="w-5 h-5 text-amber-500" />}  label={t("wallet.totalProfits")}    value={stats.totalProfits}    color="bg-amber-50" />
      </div>}

      {/* ── Transaction history ── */}
      <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-4 md:px-6 py-4 border-b border-[#F1F5F9]">
          <h3 className="font-black text-[#1E293B] text-base">{t("wallet.historyTitle")}</h3>
          {total > 0 && (
            <span className="text-xs text-slate-400">
              {total} {lang === "fr" ? "transaction(s)" : "حركة"}
            </span>
          )}
        </div>

        {historyError ? <div role="alert" className="p-4">{lang === 'fr' ? 'Historique indisponible.' : 'تعذر تحميل الحركات.'}<button className="p-3 underline" onClick={() => fetchHistory(page)}>{lang === 'fr' ? 'Réessayer' : 'إعادة المحاولة'}</button></div> : loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-8 h-8 border-4 border-[#4361EE] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : items.length === 0 ? (
          <div className="text-center py-16">
            <div className="w-14 h-14 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto mb-3">
              <CreditCard className="w-7 h-7 text-slate-400" />
            </div>
            <p className="text-slate-400 font-medium">{t("wallet.noHistory")}</p>
            <p className="text-slate-300 text-sm mt-1">{t("wallet.noHistorySub")}</p>
          </div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm" dir={lang === "fr" ? "ltr" : "rtl"}>
                <thead>
                  <tr className="bg-[#F8FAFC] text-xs font-bold text-slate-400 uppercase border-b border-[#F1F5F9]">
                    <th className="py-3 px-4 text-right">{t("wallet.typeLabel")}</th>
                    <th className="py-3 px-4 text-left">{t("wallet.amount")}</th>
                    <th className="py-3 px-4 text-right">{t("common.status")}</th>
                    <th className="py-3 px-4 text-right">{t("common.date")}</th>
                    <th className="py-3 px-4 text-right">{t("wallet.noteLabel")}</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map(item => <TxRow key={item.id} item={item} />)}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="md:hidden">
              {items.map(item => <TxCard key={item.id} item={item} />)}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-2 py-4 border-t border-[#F1F5F9]">
                <button
                  onClick={() => fetchHistory(page - 1)}
                  disabled={page <= 1}
                  className="px-4 py-2 rounded-lg border border-[#E2E8F0] text-sm font-bold text-slate-600 hover:bg-[#F8FAFC] disabled:opacity-40 disabled:cursor-not-allowed transition min-h-[44px]"
                >
                  {t("common.previous")}
                </button>
                <span className="text-sm text-slate-500 font-medium px-3">
                  {page} / {totalPages}
                </span>
                <button
                  onClick={() => fetchHistory(page + 1)}
                  disabled={page >= totalPages}
                  className="px-4 py-2 rounded-lg border border-[#E2E8F0] text-sm font-bold text-slate-600 hover:bg-[#F8FAFC] disabled:opacity-40 disabled:cursor-not-allowed transition min-h-[44px]"
                >
                  {t("common.next")}
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {showModal && (
        <DepositModal onClose={() => setShowModal(false)} onSuccess={handleDepositSuccess} />
      )}
    </div>
  );
}
