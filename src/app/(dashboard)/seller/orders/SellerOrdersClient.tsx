"use client";
import { orderReference } from "@/lib/order-reference";
import { sellerTransitions } from "@/lib/order-policy";
import toast from "react-hot-toast";
import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import DateDropdown from "@/components/ui/DateDropdown";
import { Plus, Truck, CheckCircle, RotateCcw, DollarSign, Search, Package } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";

interface Order {
  id: string;
  seqId: number | null;
  customerName: string;
  customerPhone: string;
  productName: string;
  quantity: number;
  codAmount: number;
  netProfit: number;
  status: string;
  batchId: string | null;
  trackingNumber: string | null;
  city: string;
  createdAt: string;
}

interface TodayStats {
  new: number;
  shipped: number;
  delivered: number;
  returned: number;
  profit: number;
}

interface Props {
  orders: Order[];
  todayStats: TodayStats;
  period: string;
  from: string;
  to: string;
  periodLabel: string;
}

// CSS-only styling — no text labels at module level
const STATUS_STYLE: Record<string, { bg: string; dot: string }> = {
  DRAFT:                { bg: "bg-slate-100 text-slate-600",                           dot: "bg-slate-400" },
  PENDING_CONFIRMATION: { bg: "bg-yellow-50 text-yellow-700 border border-yellow-200", dot: "bg-yellow-500" },
  CONFIRMED:            { bg: "bg-[#EEF2FF] text-[#4361EE] border border-blue-100",    dot: "bg-[#4361EE]"  },
  WAITING_PAYMENT:      { bg: "bg-purple-50 text-purple-700 border border-purple-100", dot: "bg-purple-500" },
  PROCESSING:           { bg: "bg-orange-50 text-[#FB923C] border border-orange-100",  dot: "bg-[#FB923C]"  },
  SHIPPED:              { bg: "bg-cyan-50 text-cyan-700 border border-cyan-100",        dot: "bg-cyan-500"   },
  DELIVERED:            { bg: "bg-green-50 text-green-700 border border-green-100",    dot: "bg-green-500"  },
  CANCELLED:            { bg: "bg-slate-100 text-slate-500",                            dot: "bg-slate-400"  },
  RETURNED:             { bg: "bg-red-50 text-red-600 border border-red-100",           dot: "bg-red-500"    },
};

const PER_PAGE = 20;



function fmtDate(iso: string, lang: string) {
  return new Date(iso).toLocaleDateString(lang === "fr" ? "fr-FR" : "ar-MA", { day: "numeric", month: "short" });
}

function StatusBadge({
  order, openId, updatingId, onToggle, onSelect, dropdownSide = "right",
}: {
  order: Order;
  openId: string | null;
  updatingId: string | null;
  onToggle: (id: string) => void;
  onSelect: (id: string, status: string) => void;
  dropdownSide?: "right" | "left";
}) {
  const { t, lang } = useLanguage();

  const STATUS_LABELS: Record<string, string> = {
    DRAFT:                t("orders.statusDraft"),
    PENDING_CONFIRMATION: t("orders.statusPending"),
    CONFIRMED:            t("orders.statusConfirmed"),
    WAITING_PAYMENT:      lang === 'fr' ? 'Revue Admin / paiement' : 'مراجعة الإدارة / الدفع',
    PROCESSING:           t("orders.statusProcessing"),
    SHIPPED:              t("orders.statusShipped"),
    DELIVERED:            t("orders.statusDelivered"),
    CANCELLED:            t("orders.statusCancelled"),
    RETURNED:             t("orders.statusReturned"),
  };

  const style = STATUS_STYLE[order.status] ?? { bg: "bg-gray-100 text-gray-500", dot: "bg-gray-400" };
  const label = STATUS_LABELS[order.status] ?? order.status;
  const isOpen = openId === order.id;
  const isUpdating = updatingId === order.id;

  return (
    <div className="relative inline-block" data-dropdown="">
      <button
        onClick={() => onToggle(order.id)}
        aria-expanded={isOpen}
        disabled={isUpdating || sellerTransitions(order.status, order.batchId).length === 0}
        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold transition hover:opacity-80 active:scale-95 ${style.bg} ${isUpdating ? "opacity-50 cursor-wait" : "cursor-pointer"}`}
      >
        {isUpdating ? (
          <span className="w-3 h-3 rounded-full border-2 border-current border-t-transparent animate-spin" />
        ) : (
          <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${style.dot}`} />
        )}
        {isUpdating ? t("orders.updating") : label}
        {!isUpdating && sellerTransitions(order.status, order.batchId).length > 0 && <span className="opacity-50 text-[9px] leading-none">▾</span>}
      </button>

      {isOpen && (
        <div className={`absolute top-full mt-1 z-50 bg-white border border-[#E2E8F0] rounded-xl shadow-xl overflow-hidden w-48 ${dropdownSide === "left" ? "left-0" : "right-0"}`}>
          {Object.entries(STATUS_STYLE).filter(([key]) => sellerTransitions(order.status, order.batchId).includes(key)).map(([key, cfg]) => (
            <button
              key={key}
              onClick={() => onSelect(order.id, key)}
              className={`w-full text-right px-3 py-2 text-xs font-bold hover:bg-[#F8FAFC] transition flex items-center gap-2 ${
                order.status === key ? "bg-[#EEF2FF] text-[#4361EE]" : "text-[#1E293B]"
              }`}
            >
              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${cfg.dot}`} />
              {STATUS_LABELS[key]}
              {order.status === key && <span className="mr-auto text-[10px] text-[#4361EE]">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function SellerOrdersClient({ orders: initial, todayStats, period, from, to, periodLabel }: Props) {
  const router = useRouter();
  const { t, lang } = useLanguage();
  const [orders, setOrders] = useState<Order[]>(initial);
  useEffect(() => { setOrders(initial); }, [initial]);
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState("all");
  const [page, setPage] = useState(1);
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const TABS = [
    { key: "all",       label: t("orders.tabAll"),       statuses: Object.keys(STATUS_STYLE) },
    { key: "new",       label: t("orders.tabNew"),       statuses: ["DRAFT", "PENDING_CONFIRMATION", "CONFIRMED", "WAITING_PAYMENT", "PROCESSING"] },
    { key: "transit",   label: t("orders.tabTransit"),   statuses: ["SHIPPED"] },
    { key: "delivered", label: t("orders.tabDelivered"), statuses: ["DELIVERED"] },
    { key: "returned",  label: t("orders.tabReturned"),  statuses: ["RETURNED", "CANCELLED"] },
  ];

  const statCards = [
    { tab: "new",       icon: <Plus className="w-4 h-4" />,        label: t("orders.newToday"),       value: todayStats.new,       color: "text-[#4361EE]" },
    { tab: "transit",   icon: <Truck className="w-4 h-4" />,       label: t("orders.inTransit"),      value: todayStats.shipped,   color: "text-cyan-600"  },
    { tab: "delivered", icon: <CheckCircle className="w-4 h-4" />, label: t("orders.todayDelivered"), value: todayStats.delivered, color: "text-green-600" },
    { tab: "returned",  icon: <RotateCcw className="w-4 h-4" />,   label: t("orders.todayReturned"),  value: todayStats.returned,  color: "text-red-500"   },
    { tab: "profit",    icon: <DollarSign className="w-4 h-4" />,  label: t("orders.todayProfit"),    value: `${todayStats.profit.toFixed(0)} د.م`, color: "text-emerald-600", wide: true },
  ];

  useEffect(() => { setPage(1); }, [search, activeTab]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!(e.target as Element).closest("[data-dropdown]")) setOpenDropdown(null);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const updateStatus = async (orderId: string, newStatus: string) => {
    if (updatingId) return;
    if (newStatus === 'CANCELLED' && !window.confirm(lang === 'fr' ? 'Annuler cette commande ?' : 'هل تريد إلغاء هذا الطلب؟')) return;
    setOpenDropdown(null);
    setUpdatingId(orderId);
    try {
      const res = await fetch(`/api/seller/orders/${orderId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error || "تعذر تحديث الطلب");
      }
      if (res.ok) {
        setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status: newStatus } : o));
      }
      toast.success(lang === "fr" ? "Statut mis à jour" : "تم تحديث الحالة");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "تعذر تحديث الطلب");
    } finally {
      setUpdatingId(null);
    }
  };

  const setTab = (tab: string) => { setActiveTab(tab); setPage(1); };

  const tabStatuses = TABS.find(t => t.key === activeTab)?.statuses ?? Object.keys(STATUS_STYLE);
  const filtered = orders.filter(o => {
    if (!tabStatuses.includes(o.status)) return false;
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      o.customerName.toLowerCase().includes(q) ||
      o.customerPhone.includes(q) ||
      o.productName.toLowerCase().includes(q) ||
      o.city.toLowerCase().includes(q)
    );
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const paginated = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  const pageNumbers = (() => {
    const total = totalPages;
    if (total <= 5) return Array.from({ length: total }, (_, i) => i + 1);
    const start = Math.max(1, Math.min(page - 2, total - 4));
    return Array.from({ length: 5 }, (_, i) => start + i);
  })();

  const tableHeaders = [t("orders.orderNumber"), t("orders.customer"), t("orders.product"), "COD", t("orders.status"), t("orders.date"), ""];

  return (
    <div className="space-y-4" dir={lang === "fr" ? "ltr" : "rtl"}>
      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-black text-[#1E293B]">{t("orders.myOrders")}</h2>
          <p className="text-slate-400 text-sm mt-0.5">
            {orders.length} {t("dashboard.order")} · {periodLabel}
          </p>
        </div>
        <Link
          href="/seller/orders/new"
          className="inline-flex items-center gap-2 bg-[#FB923C] hover:bg-orange-500 active:scale-95 text-white px-5 py-3 rounded-xl font-bold transition shadow-sm text-sm w-full sm:w-auto justify-center"
        >
          <span className="text-lg leading-none font-black">+</span>
          {t("orders.addNew")}
        </Link>
      </div>

      <div className="rounded-xl border bg-white p-4 text-sm space-y-2">
        <p>{lang === 'fr' ? 'Brouillon → À confirmer → Confirmée → Revue Admin → Acceptée → Lot payé → Préparation entrepôt. Minimum : 5 PCS confirmées, quel que soit le nombre de commandes. Le paiement ne vaut pas expédition.' : 'مسودة ← بانتظار التأكيد ← مؤكدة ← مراجعة الإدارة ← مقبولة ← دفعة مدفوعة ← تجهيز المستودع. الحد الأدنى 5 وحدات من الطلبات المؤكدة. الدفع لا يعني الشحن.'}</p>
        <Link href="/seller/batches" className="inline-block p-2 text-blue-700 underline">{lang === 'fr' ? 'Créer / payer un lot' : 'إنشاء / دفع دفعة'}</Link>
        <p>{lang === 'fr' ? 'Les retours attendent une inspection physique avant remise en stock. Consultez le portefeuille pour les écritures réelles.' : 'المرتجعات تنتظر الفحص الفعلي قبل إعادة التخزين. راجع المحفظة للقيود المالية الفعلية.'}</p>
      </div>
      {/* ── Today Stats Bar ── */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {statCards.map(card => (
          <button
            key={card.tab}
            onClick={() => card.tab !== "profit" && setTab(card.tab)}
            className={[
              "bg-white rounded-2xl border p-3 text-right transition",
              card.tab !== "profit" ? "hover:shadow-md cursor-pointer" : "cursor-default",
              ('wide' in card && card.wide) ? "col-span-2 sm:col-span-1" : "",
              activeTab === card.tab && card.tab !== "profit"
                ? "border-[#4361EE] ring-2 ring-[#4361EE]/20 shadow-sm"
                : "border-[#E2E8F0] hover:border-slate-300",
            ].join(" ")}
          >
            <div className="flex items-start justify-between mb-1">
              <span className="text-slate-400">{card.icon}</span>
              <span className={`text-xl font-black ${card.color}`}>{card.value}</span>
            </div>
            <p className="text-xs text-slate-400 font-bold">{card.label}</p>
          </button>
        ))}
      </div>

      {/* ── Controls: Date + Search + Tabs ── */}
      <div className="bg-white rounded-2xl border border-[#E2E8F0] p-4 space-y-3 shadow-sm">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex-1">
            <DateDropdown
              period={period}
              from={from}
              to={to}
              onChange={(p, f, t) => router.push(`/seller/orders?period=${p}&from=${f}&to=${t}`)}
            />
          </div>
          <div className="relative flex-1 sm:max-w-sm">
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"><Search className="w-4 h-4" /></span>
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={t("orders.searchPlaceholder")}
              className="w-full pr-9 pl-8 py-2.5 border border-[#E2E8F0] rounded-xl text-sm focus:outline-none focus:border-[#4361EE] bg-[#F8FAFC] focus:bg-white transition"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs leading-none"
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {/* Status Tabs */}
        <div className="flex gap-1 overflow-x-auto pb-0.5 scrollbar-hide">
          {TABS.map(tab => {
            const count = orders.filter(o => tab.statuses.includes(o.status)).length;
            const active = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setTab(tab.key)}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold whitespace-nowrap transition flex-shrink-0 ${
                  active
                    ? "bg-[#4361EE] text-white shadow-sm"
                    : "text-slate-500 hover:bg-[#F8FAFC] hover:text-[#1E293B]"
                }`}
              >
                {tab.label}
                <span className={`text-[11px] px-1.5 py-0.5 rounded-full font-black leading-none ${
                  active ? "bg-white/20 text-white" : "bg-slate-100 text-slate-500"
                }`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Empty State ── */}
      {filtered.length === 0 && (
        <div className="bg-white rounded-2xl border-2 border-dashed border-[#E2E8F0] py-20 text-center">
          <div className="w-14 h-14 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
            {search ? <Search className="w-7 h-7 text-slate-400" /> : <Package className="w-7 h-7 text-slate-400" />}
          </div>
          <p className="text-xl font-black text-[#1E293B] mb-2">
            {search ? t("orders.noResults") : t("orders.noOrders")}
          </p>
          <p className="text-slate-400 text-sm mb-6">
            {search
              ? `${t("orders.noResults")}: "${search}"`
              : (lang === "fr" ? "Aucune commande dans cette période" : "لم تضف أي طلبات في هذه الفترة بعد")}
          </p>
          {!search && (
            <Link
              href="/seller/orders/new"
              className="inline-flex items-center gap-2 bg-[#FB923C] hover:bg-orange-500 text-white px-6 py-3 rounded-xl font-bold transition"
            >
              <span className="text-lg">+</span> {t("orders.addFirst")}
            </Link>
          )}
        </div>
      )}

      {paginated.length > 0 && (
        <>
          {/* ── Desktop Table ── */}
          <div className="hidden md:block bg-white rounded-2xl shadow-sm border border-[#E2E8F0] overflow-hidden">
            <table className="w-full text-right text-sm">
              <thead>
                <tr className="bg-[#F8FAFC] border-b border-[#E2E8F0]">
                  {tableHeaders.map((h, i) => (
                    <th key={i} className="px-4 py-3 text-slate-500 font-bold text-xs">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {paginated.map(order => (
                  <tr key={order.id} className="border-b border-[#E2E8F0] last:border-0 hover:bg-[#F8FAFC]/60 transition">
                    <td className="px-4 py-3.5">
                      <span className="inline-block max-w-40 break-all font-mono text-xs text-slate-500 font-bold bg-slate-50 px-2 py-1 rounded-lg">
                        {orderReference(order.id, order.seqId)}
                      </span>
                    </td>
                    <td className="px-4 py-3.5">
                      <p className="font-bold text-[#1E293B] leading-tight">{order.customerName}</p>
                      <a href={`tel:${order.customerPhone}`} className="text-[#4361EE] text-xs font-mono hover:underline">
                        {order.customerPhone}
                      </a>
                      <p className="text-slate-400 text-xs mt-0.5">{order.city}</p>
                    </td>
                    <td className="px-4 py-3.5">
                      <p className="text-[#1E293B] font-medium leading-tight">{order.productName}</p>
                      <p className="text-slate-400 text-xs">×{order.quantity}</p>
                    </td>
                    <td className="px-4 py-3.5">
                      <span className="font-black text-[#1E293B] text-base">{order.codAmount.toFixed(0)}</span>
                      <span className="text-slate-400 text-xs"> د.م</span>
                    </td>
                    <td className="px-4 py-3.5">
                      <StatusBadge
                        order={order}
                        openId={openDropdown}
                        updatingId={updatingId}
                        onToggle={id => setOpenDropdown(openDropdown === id ? null : id)}
                        onSelect={updateStatus}
                        dropdownSide="right"
                      />
                    </td>
                    <td className="px-4 py-3.5 text-slate-400 text-xs whitespace-nowrap">
                      {fmtDate(order.createdAt, lang)}
                    </td>
                    <td className="px-4 py-3.5">
                      <Link
                        href={`/seller/orders/${order.id}`}
                        className="text-[#4361EE] hover:bg-[#EEF2FF] px-3 py-1.5 rounded-lg text-xs font-bold transition"
                      >
                        {t("orders.view")}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* ── Mobile Cards ── */}
          <div className="md:hidden space-y-3">
            {paginated.map(order => (
              <div key={order.id} className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm overflow-hidden">
                <div className="p-4">
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="font-mono text-xs text-slate-400 bg-slate-50 px-2 py-0.5 rounded-md">
                          {orderReference(order.id, order.seqId)}
                        </span>
                        <span className="text-xs text-slate-400">{fmtDate(order.createdAt, lang)}</span>
                      </div>
                      <p className="font-black text-[#1E293B] text-base leading-tight truncate">{order.customerName}</p>
                      <a href={`tel:${order.customerPhone}`} className="text-[#4361EE] font-mono text-sm hover:underline">
                        {order.customerPhone}
                      </a>
                    </div>
                    <StatusBadge
                      order={order}
                      openId={openDropdown}
                      updatingId={updatingId}
                      onToggle={id => setOpenDropdown(openDropdown === id ? null : id)}
                      onSelect={updateStatus}
                      dropdownSide="left"
                    />
                  </div>

                  <div className="flex items-center justify-between pt-3 border-t border-[#F1F5F9]">
                    <div className="min-w-0">
                      <p className="text-sm text-[#1E293B] font-medium truncate">
                        {order.productName}{" "}
                        <span className="text-slate-400 font-normal">×{order.quantity}</span>
                      </p>
                      <p className="text-xs text-slate-400">{order.city}</p>
                    </div>
                    <div className="text-left flex-shrink-0 mr-3">
                      <p className="font-black text-[#1E293B]">
                        {order.codAmount.toFixed(0)}{" "}
                        <span className="text-slate-400 font-normal text-xs">د.م</span>
                      </p>
                    </div>
                  </div>
                </div>
                <div className="border-t border-[#F1F5F9] bg-[#F8FAFC] px-4 py-2.5 flex justify-end">
                  <Link
                    href={`/seller/orders/${order.id}`}
                    className="text-[#4361EE] text-sm font-bold flex items-center gap-1"
                  >
                    {t("orders.viewDetails")}
                    <span className="text-base leading-none">←</span>
                  </Link>
                </div>
              </div>
            ))}
          </div>

          {/* ── Pagination ── */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 pt-2">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-4 py-2 rounded-xl border border-[#E2E8F0] text-sm font-bold text-slate-500 hover:bg-[#F8FAFC] disabled:opacity-40 transition"
              >
                {t("common.previous")}
              </button>
              {pageNumbers.map(n => (
                <button
                  key={n}
                  onClick={() => setPage(n)}
                  className={`w-10 h-10 rounded-xl text-sm font-bold transition ${
                    page === n
                      ? "bg-[#4361EE] text-white shadow-sm"
                      : "border border-[#E2E8F0] text-slate-500 hover:bg-[#F8FAFC]"
                  }`}
                >
                  {n}
                </button>
              ))}
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="px-4 py-2 rounded-xl border border-[#E2E8F0] text-sm font-bold text-slate-500 hover:bg-[#F8FAFC] disabled:opacity-40 transition"
              >
                {t("common.next")}
              </button>
            </div>
          )}
        </>
      )}

      {filtered.length > 0 && (
        <p className="text-center text-xs text-slate-400 pb-2">
          {lang === "fr"
            ? `Affichage ${Math.min(page * PER_PAGE, filtered.length)} sur ${filtered.length} commandes`
            : `عرض ${Math.min(page * PER_PAGE, filtered.length)} من ${filtered.length} طلب`}
        </p>
      )}
    </div>
  );
}
