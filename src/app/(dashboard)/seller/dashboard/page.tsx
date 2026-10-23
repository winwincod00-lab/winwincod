"use client";
import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { Package, CheckCircle, DollarSign, Lightbulb, TrendingUp, RotateCcw } from "lucide-react";
import Link from "next/link";
import axios from "axios";
import { useLanguage } from "@/context/LanguageContext";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from "recharts";
import DateDropdown, { PERIOD_LABELS } from "@/components/ui/DateDropdown";

const COLORS = ["#4361EE", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6"];


function getDefaultDates() {
  const now = new Date();
  return {
    period: "month",
    from: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`,
    to: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`,
  };
}

export default function SellerDashboard() {
  const defaults = getDefaultDates();
  const [period, setPeriod] = useState(defaults.period);
  const [from, setFrom] = useState(defaults.from);
  const [to, setTo] = useState(defaults.to);
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const { data: session } = useSession();
  const { t, lang } = useLanguage();
  const sellerName = (session?.user as any)?.name ?? (lang === "fr" ? "Vendeur" : "بائع");

  const STATUS_LABELS: Record<string, string> = {
    DELIVERED:            t("orders.statusDelivered"),
    RETURNED:             t("orders.statusReturned"),
    SHIPPED:              t("orders.statusShipped"),
    PROCESSING:           t("orders.statusProcessing"),
    DRAFT:                t("orders.statusDraft"),
    CONFIRMED:            t("orders.statusConfirmed"),
    CANCELLED:            t("orders.statusCancelled"),
    PENDING_CONFIRMATION: t("orders.statusPending"),
    WAITING_PAYMENT:      t("orders.statusWaitingPayment"),
  };

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(false);
    axios
      .get(`/api/seller/analytics?from=${from}&to=${to}`, { signal: controller.signal })
      .then((res) => { setData(res.data); setLoading(false); })
      .catch(() => { if (!controller.signal.aborted) { setError(true); setLoading(false); } });
    return () => controller.abort();
  }, [from, to, revision]);

  const handleDateChange = (p: string, f: string, t: string) => {
    setPeriod(p);
    setFrom(f);
    setTo(t);
  };

  const periodLabel = PERIOD_LABELS[period] ?? "هذا الشهر";

  return (
    <div className="space-y-6">
      {/* ── Hero Banner ────────────────────────────────────────── */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#10B981] via-[#059669] to-[#047857] p-7 text-white shadow-lg shadow-[#10B981]/20">
        <div className="absolute -top-5 -right-5 w-36 h-36 bg-white/10 rounded-full pointer-events-none" />
        <div className="absolute -bottom-8 right-1/3 w-28 h-28 bg-white/5 rounded-full pointer-events-none" />
        <div className="absolute top-1/2 -left-6 w-24 h-24 bg-[#4361EE]/20 rounded-full pointer-events-none" />

        <div className="relative flex flex-col sm:flex-row sm:items-center justify-between gap-5">
          <div>
            <p className="text-green-200 text-sm font-medium">{t("dashboard.hello")}، {sellerName}</p>
            <h1 className="text-2xl font-black mt-1.5 tracking-tight">{t("nav.dashboard")}</h1>
            <p className="text-green-100/80 text-sm mt-1 font-medium">{t("dashboard.trackPerf")} · {periodLabel}</p>
          </div>
          <div className="flex-shrink-0">
            <DateDropdown period={period} from={from} to={to} onChange={handleDateChange} />
          </div>
        </div>
      </div>

      {error ? <div role="alert" className="rounded-xl border border-red-200 p-4 bg-white">
        {lang === 'fr' ? 'Impossible de charger les données.' : 'تعذر تحميل البيانات.'}
        <button className="p-3 underline" onClick={() => setRevision(n => n + 1)}>{lang === 'fr' ? 'Réessayer' : 'إعادة المحاولة'}</button>
      </div> : loading || !data ? (
        <div className="space-y-4" role="status" aria-label={lang === "fr" ? "Chargement" : "جاري التحميل"}>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-40 bg-white rounded-2xl border border-slate-100 animate-pulse" />
            ))}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="h-80 bg-white rounded-2xl border border-slate-100 animate-pulse" />
            <div className="h-80 bg-white rounded-2xl border border-slate-100 animate-pulse" />
          </div>
        </div>
      ) : (
        <>
          <section className="bg-white border rounded-2xl p-4 space-y-3">
            <h2 className="font-bold">{lang === 'fr' ? 'À traiter · toutes périodes' : 'إجراءات اليوم · جميع الفترات'}</h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {[
                { href: '/seller/orders/drafts', count: data.queues?.DRAFT ?? 0, fr: 'Envoyer pour confirmation', ar: 'إرسال المسودات للتأكيد' },
                { href: '/seller/orders?status=PENDING_CONFIRMATION', count: data.queues?.PENDING_CONFIRMATION ?? 0, fr: 'Confirmer les commandes', ar: 'تأكيد الطلبات' },
                { href: '/seller/batches', count: data.queues?.CONFIRMED ?? 0, fr: 'Vérifier et payer un lot (5 minimum)', ar: 'فحص ودفع دفعة (5 على الأقل)' },
                { href: '/seller/batches', count: data.queues?.WAITING_PAYMENT ?? 0, fr: 'Lots à payer', ar: 'دفعات بانتظار الدفع' },
                { href: '/seller/orders?status=PROCESSING', count: data.queues?.PROCESSING ?? 0, fr: 'En préparation entrepôt', ar: 'قيد تجهيز المستودع' },
                { href: '/seller/orders?status=RETURNED', count: data.queues?.RETURNED ?? 0, fr: 'Retours · inspection requise avant restockage', ar: 'مرتجعات · الفحص مطلوب قبل إعادة التخزين' },
              ].map(q => <Link key={q.href + q.fr} href={q.href} className="border rounded-xl p-3 hover:bg-blue-50"><strong className="block text-2xl">{q.count}</strong>{lang === 'fr' ? q.fr : q.ar}</Link>)}
            </div>
            <Link className="inline-block p-2 text-blue-700 underline" href="/seller/wallet">{lang === 'fr' ? 'Portefeuille et écritures de rapprochement' : 'المحفظة وقيود التسوية'}</Link>
          </section>
          {/* ── Stats Cards ───────────────────────────────────── */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">

            {/* Total Orders */}
            <div className="bg-white border border-slate-100 border-t-4 border-t-[#4361EE] rounded-2xl p-6 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-200 group cursor-default">
              <div className="w-12 h-12 bg-[#EEF2FF] rounded-2xl flex items-center justify-center mb-5 group-hover:scale-110 transition-transform duration-200">
                <Package className="w-6 h-6 text-[#4361EE]" />
              </div>
              <p className="text-4xl font-black text-[#0F172A] leading-none mb-2 tracking-tight">{data.totalOrders}</p>
              <p className="text-sm text-slate-500 font-semibold">{t("dashboard.totalOrdersCard")}</p>
              <p className="text-[11px] text-slate-400 mt-1.5 font-medium">{periodLabel}</p>
            </div>

            {/* Delivered */}
            <div className="bg-white border border-slate-100 border-t-4 border-t-[#10B981] rounded-2xl p-6 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-200 group cursor-default">
              <div className="w-12 h-12 bg-[#ECFDF5] rounded-2xl flex items-center justify-center mb-5 group-hover:scale-110 transition-transform duration-200">
                <CheckCircle className="w-6 h-6 text-[#10B981]" />
              </div>
              <p className="text-4xl font-black text-[#0F172A] leading-none mb-2 tracking-tight">{data.delivered ?? 0}</p>
              <p className="text-sm text-slate-500 font-semibold">{t("dashboard.delivered")}</p>
              <p className="text-[11px] text-[#10B981] mt-1.5 font-bold">{t("dashboard.deliveryRateLabel")} {data.deliveryRate ?? "0"}%</p>
            </div>

            {/* Net Profit */}
            <div className="bg-white border border-slate-100 border-t-4 border-t-[#FB923C] rounded-2xl p-6 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-200 group cursor-default">
              <div className="w-12 h-12 bg-[#FFF7ED] rounded-2xl flex items-center justify-center mb-5 group-hover:scale-110 transition-transform duration-200">
                <DollarSign className="w-6 h-6 text-[#FB923C]" />
              </div>
              <p className="text-4xl font-black text-[#0F172A] leading-none mb-2 tracking-tight">
                {Number(data.totalProfit ?? 0).toLocaleString("ar-MA", { maximumFractionDigits: 0 })}
                <span className="text-lg font-semibold text-slate-400 mr-1">د.م</span>
              </p>
              <p className="text-sm text-slate-500 font-semibold">{t("dashboard.netProfit")}</p>
              <p className="text-[11px] text-slate-400 mt-1.5 font-medium">{t("dashboard.fromDelivered")}</p>
            </div>

            {/* Return Rate */}
            <div className="bg-white border border-slate-100 border-t-4 border-t-[#EF4444] rounded-2xl p-6 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-200 group cursor-default">
              <div className="w-12 h-12 bg-[#FEF2F2] rounded-2xl flex items-center justify-center mb-5 group-hover:scale-110 transition-transform duration-200">
                <RotateCcw className="w-6 h-6 text-[#EF4444]" />
              </div>
              <p className="text-4xl font-black text-[#0F172A] leading-none mb-2 tracking-tight">
                {(data.delivered + data.returned) > 0
                  ? Math.round((data.returned / (data.delivered + data.returned)) * 100)
                  : 0}%
              </p>
              <p className="text-sm text-slate-500 font-semibold">{t("dashboard.returnRate")}</p>
              <p className="text-[11px] text-slate-400 mt-1.5 font-medium">{periodLabel}</p>
            </div>
          </div>

          {/* ── Charts ────────────────────────────────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Bar Chart */}
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 hover:shadow-md transition-shadow">
              <div className="flex items-center justify-between mb-5">
                <div>
                  <h3 className="font-black text-[#1E293B] text-base">{t("dashboard.ordersActivity")}</h3>
                  <p className="text-xs text-slate-400 mt-0.5">{periodLabel}</p>
                </div>
                <div className="w-10 h-10 bg-[#EEF2FF] rounded-2xl flex items-center justify-center">
                  <TrendingUp className="w-5 h-5 text-[#4361EE]" />
                </div>
              </div>
              {data.barData?.length > 0 ? (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={data.barData} barCategoryGap="30%">
                    <XAxis dataKey="date" stroke="#94A3B8" fontSize={11} tickLine={false} axisLine={false} />
                    <YAxis stroke="#94A3B8" fontSize={11} tickLine={false} axisLine={false} />
                    <Tooltip
                      cursor={{ fill: "#F8FAFC", radius: 8 }}
                      contentStyle={{
                        borderRadius: "12px",
                        border: "1px solid #E2E8F0",
                        boxShadow: "0 4px 16px rgba(0,0,0,0.08)",
                        fontFamily: "Cairo, sans-serif",
                        fontSize: "12px",
                      }}
                    />
                    <Bar dataKey="orders" fill="#4361EE" radius={[8, 8, 0, 0]} barSize={22} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[220px] flex items-center justify-center">
                  <p className="text-sm font-medium text-slate-400">{t("common.noData")}</p>
                </div>
              )}
            </div>

            {/* Pie Chart */}
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 hover:shadow-md transition-shadow">
              <div className="flex items-center justify-between mb-5">
                <div>
                  <h3 className="font-black text-[#1E293B] text-base">{t("dashboard.ordersStatus")}</h3>
                  <p className="text-xs text-slate-400 mt-0.5">{t("dashboard.statusDistribution")}</p>
                </div>
                <div className="w-10 h-10 bg-[#ECFDF5] rounded-2xl flex items-center justify-center">
                  <CheckCircle className="w-5 h-5 text-[#10B981]" />
                </div>
              </div>
              {data.pieData?.length > 0 ? (
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie
                      data={data.pieData.map((d: any) => ({
                        ...d,
                        name: STATUS_LABELS[d.name] ?? d.name,
                      }))}
                      cx="50%"
                      cy="50%"
                      innerRadius={55}
                      outerRadius={82}
                      paddingAngle={4}
                      dataKey="value"
                    >
                      {data.pieData.map((_: any, i: number) => (
                        <Cell key={i} fill={COLORS[i % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        borderRadius: "12px",
                        border: "1px solid #E2E8F0",
                        boxShadow: "0 4px 16px rgba(0,0,0,0.08)",
                        fontFamily: "Cairo, sans-serif",
                        fontSize: "12px",
                      }}
                    />
                    <Legend
                      verticalAlign="bottom"
                      height={36}
                      wrapperStyle={{ fontFamily: "Cairo, sans-serif", fontSize: "11px" }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[220px] flex items-center justify-center">
                  <p className="text-sm font-medium text-slate-400">{t("common.noData")}</p>
                </div>
              )}
            </div>
          </div>

          {/* ── Tip Card ──────────────────────────────────────── */}
          <div className="relative overflow-hidden bg-gradient-to-br from-[#4361EE]/8 to-[#4361EE]/12 border border-[#4361EE]/20 rounded-2xl p-5 flex items-start gap-4">
            <div className="absolute -bottom-3 -left-3 w-16 h-16 bg-[#4361EE]/10 rounded-full pointer-events-none" />
            <div className="w-11 h-11 bg-[#4361EE] rounded-2xl flex items-center justify-center flex-shrink-0 shadow-md shadow-[#4361EE]/30">
              <Lightbulb className="w-5 h-5 text-white" />
            </div>
            <div className="relative">
              <p className="font-black text-[#4361EE] text-sm mb-1">{t("dashboard.tipTitle")}</p>
              <p className="text-slate-600 text-sm leading-relaxed">{t("dashboard.tipBody")}</p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
