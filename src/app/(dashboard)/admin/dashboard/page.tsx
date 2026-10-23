import { getSessionUser } from '@/lib/api-utils';
import { redirect } from 'next/navigation';
import { Suspense } from "react";
import { cookies } from "next/headers";
import {
  Package, Clock, DollarSign, TrendingUp, CheckCircle,
  Users, RotateCcw, Truck, Wallet,
} from "lucide-react";
import prisma from "@/lib/prisma";
import ActivityTable from "./ActivityTable";
import DateFilter from "./DateFilter";
import { PERIOD_LABELS } from "@/components/ui/DateDropdown";
import ar from "@/messages/ar.json";
import fr from "@/messages/fr.json";

type SearchParams = Promise<{ from?: string; to?: string; period?: string }>;

function fmtRef(id: string, prefix: string) {
  return `${prefix}-${id.replace(/-/g, "").slice(0, 6).toUpperCase()}`;
}

function toYMD(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const AVATAR_COLORS = [
  "bg-yellow-400 text-white",
  "bg-slate-400 text-white",
  "bg-orange-400 text-white",
  "bg-[#4361EE] text-white",
  "bg-purple-400 text-white",
];

export default async function AdminDashboard({ searchParams }: { searchParams: SearchParams }) {
  const user = await getSessionUser();
  if (!user || user.role !== 'ADMIN') redirect('/login');
  const sp = await searchParams;
  const cookieStore = await cookies();
  const lang = cookieStore.get("winwincod_lang")?.value === "fr" ? "fr" : "ar";
  const msgs = lang === "fr" ? fr : ar;
  const now = new Date();
  const period = sp.period ?? "month";
  const periodLabel = PERIOD_LABELS[period] ?? "هذا الشهر";

  const periodFrom = sp.from
    ? new Date(sp.from)
    : new Date(now.getFullYear(), now.getMonth(), 1);
  const periodTo = sp.to ? new Date(sp.to + "T23:59:59") : now;

  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dateFilter = { createdAt: { gte: periodFrom, lte: periodTo } };

  const [
    totalOrders,
    deliveredOrders,
    returnedOrders,
    shippedOrders,
    periodOrders,
    todayOrders,
    periodRevAgg,
    pendingCount,
    walletAgg,
    activeSellers,
    recentOrders,
    ordersBySellerTop,
    deliveredRevBySeller,
    finishedOrders,
  ] = await Promise.all([
    prisma.order.count(),
    prisma.order.count({ where: { status: "DELIVERED", ...dateFilter } }),
    prisma.order.count({ where: { status: "RETURNED", ...dateFilter } }),
    prisma.order.count({ where: { status: "SHIPPED", ...dateFilter } }),
    prisma.order.count({ where: dateFilter }),
    prisma.order.count({ where: { createdAt: { gte: startOfDay } } }),
    prisma.order.aggregate({
      where: { status: "DELIVERED", ...dateFilter },
      _sum: { codAmount: true },
    }),
    prisma.order.count({
      where: { status: { in: ["PENDING_CONFIRMATION", "PROCESSING"] } },
    }),
    prisma.wallet.aggregate({ _sum: { balance: true } }),
    prisma.user.count({ where: { role: "SELLER", isActive: true } }),
    prisma.order.findMany({
      take: 60,
      where: dateFilter,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        productName: true,
        codAmount: true,
        status: true,
        createdAt: true,
        city: true,
        seller: { select: { id: true, name: true } },
      },
    }),
    prisma.order.groupBy({
      by: ["sellerId"],
      _count: { sellerId: true },
      where: dateFilter,
      orderBy: { _count: { sellerId: "desc" } },
      take: 5,
    }),
    prisma.order.groupBy({
      by: ["sellerId"],
      _sum: { codAmount: true },
      where: { status: "DELIVERED", ...dateFilter },
    }),
    prisma.order.findMany({
      where: { status: { in: ["DELIVERED", "SHIPPED", "PROCESSING"] }, ...dateFilter },
      select: {
        quantity: true,
        product: { select: { sellerPrice: true, costPrice: true } },
      },
    }),
  ]);

  const sellerIds = ordersBySellerTop.map((r) => r.sellerId);
  const sellerNames = await prisma.user.findMany({
    where: { id: { in: sellerIds } },
    select: { id: true, name: true },
  });

  const sellerMap = Object.fromEntries(sellerNames.map((s) => [s.id, s.name]));
  const revenueMap = Object.fromEntries(
    deliveredRevBySeller.map((r) => [r.sellerId, Number(r._sum.codAmount ?? 0)])
  );

  const topSellers = ordersBySellerTop
    .filter((r) => sellerMap[r.sellerId])
    .map((r) => ({
      id: r.sellerId,
      name: sellerMap[r.sellerId],
      orderCount: r._count?.sellerId ?? 0,
      revenue: revenueMap[r.sellerId] ?? 0,
    }));

  const deliveryRate =
    deliveredOrders + returnedOrders > 0
      ? ((deliveredOrders / (deliveredOrders + returnedOrders)) * 100).toFixed(1)
      : "0.0";

  const returnRate =
    deliveredOrders + returnedOrders > 0
      ? ((returnedOrders / (deliveredOrders + returnedOrders)) * 100).toFixed(1)
      : "0.0";

  const platformProfit = finishedOrders.reduce((acc, order) => {
    const sp2 = Number(order.product?.sellerPrice ?? 0);
    const cp = Number(order.product?.costPrice ?? 0);
    return acc + (sp2 - cp) * order.quantity;
  }, 0);

  const walletBalance = Number(walletAgg._sum.balance ?? 0);
  const periodRev = Number(periodRevAgg._sum.codAmount ?? 0);
  const fromStr = toYMD(periodFrom);
  const toStr = toYMD(periodTo);

  const serializedOrders = recentOrders.map((o) => ({
    id: o.id,
    ref: fmtRef(o.id, "ORD"),
    productName: o.productName,
    codAmount: Number(o.codAmount),
    status: o.status as string,
    createdAt: o.createdAt.toISOString(),
    city: o.city,
    sellerName: o.seller.name,
    sellerRef: fmtRef(o.seller.id, "SLR"),
  }));

  return (
    <div className="space-y-6">
      {/* ── Hero Banner ──────────────────────────────────── */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#4361EE] via-[#4361EE] to-[#3254D4] p-7 text-white shadow-lg shadow-[#4361EE]/20">
        <div className="absolute -top-5 -right-5 w-36 h-36 bg-white/10 rounded-full pointer-events-none" />
        <div className="absolute -bottom-8 right-1/3 w-28 h-28 bg-white/5 rounded-full pointer-events-none" />
        <div className="absolute top-1/2 -left-6 w-24 h-24 bg-[#FB923C]/20 rounded-full pointer-events-none" />

        <div className="relative flex flex-col sm:flex-row sm:items-center justify-between gap-5">
          <div>
            <p className="text-blue-200 text-sm font-medium">
              {now.toLocaleDateString("ar-MA", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
            </p>
            <h1 className="text-2xl font-black mt-1.5 tracking-tight">{msgs.dashboard.title}</h1>
            <p className="text-blue-100/80 text-sm mt-1 font-medium">{msgs.dashboard.subtitle} · {periodLabel}</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center min-w-[88px] border border-white/10">
              <p className="text-2xl font-black leading-none">{periodOrders.toLocaleString("ar-MA")}</p>
              <p className="text-blue-200 text-[11px] font-semibold mt-1">{msgs.dashboard.periodOrders}</p>
            </div>
            <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center min-w-[88px] border border-white/10">
              <p className="text-2xl font-black leading-none">{activeSellers.toLocaleString("ar-MA")}</p>
              <p className="text-blue-200 text-[11px] font-semibold mt-1">{msgs.dashboard.activeSeller}</p>
            </div>
            <div className="bg-[#FB923C]/20 backdrop-blur-sm rounded-xl px-4 py-3 text-center min-w-[88px] border border-[#FB923C]/30">
              <p className="text-2xl font-black leading-none text-orange-200">{deliveryRate}%</p>
              <p className="text-orange-200 text-[11px] font-semibold mt-1">{msgs.dashboard.deliveryRate}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Date Filter */}
      <div className="flex justify-end">
        <Suspense fallback={<div className="h-10 w-56 bg-white rounded-xl border border-slate-200 animate-pulse" />}>
          <DateFilter period={period} from={fromStr} to={toStr} />
        </Suspense>
      </div>

      {/* ── Row 1 — Period summary ──────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label={`${msgs.dashboard.periodOrdersLabel} ${periodLabel}`}
          value={periodOrders.toLocaleString("ar-MA")}
          icon={<Package className="w-5 h-5" />}
          iconBg="bg-[#EEF2FF]"
          iconColor="text-[#4361EE]"
          accent="border-t-[#4361EE]"
        />
        <StatCard
          label={`${msgs.dashboard.revenueLabel} ${periodLabel}`}
          value={`${periodRev.toLocaleString("ar-MA", { maximumFractionDigits: 0 })} د.م`}
          icon={<DollarSign className="w-5 h-5" />}
          iconBg="bg-[#ECFDF5]"
          iconColor="text-[#10B981]"
          accent="border-t-[#10B981]"
        />
        <StatCard
          label={msgs.dashboard.pendingConfirm}
          value={pendingCount.toLocaleString("ar-MA")}
          icon={<Clock className="w-5 h-5" />}
          iconBg="bg-[#FFF7ED]"
          iconColor="text-[#FB923C]"
          accent="border-t-[#FB923C]"
        />
        <StatCard
          label={`${msgs.dashboard.returnRate} ${periodLabel}`}
          value={`${returnRate}%`}
          icon={<RotateCcw className="w-5 h-5" />}
          iconBg="bg-[#FEF2F2]"
          iconColor="text-[#EF4444]"
          accent="border-t-[#EF4444]"
        />
      </div>

      {/* ── Row 2 — Platform KPIs ───────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">

        <StatCard
          label={`${msgs.dashboard.platformProfit} — ${periodLabel}`}
          value={`${platformProfit.toLocaleString("ar-MA", { maximumFractionDigits: 0 })} د.م`}
          icon={<TrendingUp className="w-5 h-5" />}
          iconBg="bg-[#EEF2FF]"
          iconColor="text-[#4361EE]"
          accent="border-t-[#4361EE]"
          sub={msgs.dashboard.profitFormula}
        />

        {/* Delivery Rate — with progress bar */}
        <div className="bg-white rounded-2xl border border-slate-100 border-t-4 border-t-[#10B981] p-6 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-200 group cursor-default">
          <div className="w-12 h-12 bg-[#ECFDF5] rounded-2xl flex items-center justify-center mb-5 group-hover:scale-110 transition-transform duration-200">
            <CheckCircle className="w-6 h-6 text-[#10B981]" />
          </div>
          <p className="text-4xl font-black text-[#0F172A] leading-none mb-2 tracking-tight">{deliveryRate}%</p>
          <p className="text-sm text-slate-500 font-semibold mb-3">{msgs.dashboard.deliveryRate} — {periodLabel}</p>
          <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
            <div className="bg-[#10B981] h-full rounded-full transition-all" style={{ width: `${deliveryRate}%` }} />
          </div>
          <p className="text-[11px] text-slate-400 mt-2 font-medium">
            {deliveredOrders.toLocaleString("ar-MA")} {msgs.dashboard.ordersFrom} {(deliveredOrders + returnedOrders).toLocaleString("ar-MA")}
          </p>
        </div>

        {/* Today Orders */}
        <div className="bg-white rounded-2xl border border-slate-100 border-t-4 border-t-[#FB923C] p-6 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-200 group cursor-default">
          <div className="w-12 h-12 bg-[#FFF7ED] rounded-2xl flex items-center justify-center mb-5 group-hover:scale-110 transition-transform duration-200">
            <TrendingUp className="w-6 h-6 text-[#FB923C]" />
          </div>
          <p className="text-4xl font-black text-[#0F172A] leading-none mb-2 tracking-tight">{todayOrders.toLocaleString("ar-MA")}</p>
          <p className="text-sm text-slate-500 font-semibold mb-3">{msgs.dashboard.todayOrders}</p>
          <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
            <div
              className="bg-[#FB923C] h-full rounded-full"
              style={{ width: `${totalOrders > 0 ? Math.min((todayOrders / Math.max(periodOrders, 1)) * 30 * 100, 100) : 0}%` }}
            />
          </div>
          <p className="text-[11px] text-slate-400 mt-2 font-medium">
            {msgs.dashboard.ordersOf} {totalOrders.toLocaleString("ar-MA")} {msgs.dashboard.order}
          </p>
        </div>

        <StatCard
          label={msgs.dashboard.activeSellers}
          value={activeSellers.toLocaleString("ar-MA")}
          icon={<Users className="w-5 h-5" />}
          iconBg="bg-[#F5F3FF]"
          iconColor="text-[#8B5CF6]"
          accent="border-t-[#8B5CF6]"
          sub={`${msgs.dashboard.liquidityColon} ${walletBalance.toLocaleString("ar-MA", { maximumFractionDigits: 0 })} د.م`}
        />
      </div>

      {/* ── Row 3 — Status breakdown ─────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          label={msgs.dashboard.delivered}
          value={deliveredOrders.toLocaleString("ar-MA")}
          icon={<CheckCircle className="w-5 h-5" />}
          iconBg="bg-[#ECFDF5]"
          iconColor="text-[#10B981]"
          accent="border-t-[#10B981]"
          sub={periodLabel}
        />
        <StatCard
          label={msgs.dashboard.shipped}
          value={shippedOrders.toLocaleString("ar-MA")}
          icon={<Truck className="w-5 h-5" />}
          iconBg="bg-[#EEF2FF]"
          iconColor="text-[#4361EE]"
          accent="border-t-[#4361EE]"
          sub={periodLabel}
        />
        <StatCard
          label={msgs.dashboard.returned}
          value={returnedOrders.toLocaleString("ar-MA")}
          icon={<RotateCcw className="w-5 h-5" />}
          iconBg="bg-[#FEF2F2]"
          iconColor="text-[#EF4444]"
          accent="border-t-[#EF4444]"
          sub={periodLabel}
        />
        <StatCard
          label={msgs.dashboard.walletLiquidity}
          value={`${walletBalance.toLocaleString("ar-MA", { maximumFractionDigits: 0 })} د.م`}
          icon={<Wallet className="w-5 h-5" />}
          iconBg="bg-[#FFF7ED]"
          iconColor="text-[#FB923C]"
          accent="border-t-[#FB923C]"
          sub={msgs.dashboard.walletBalance}
        />
      </div>

      {/* ── Activity Table + Top Sellers ─────────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2">
          <ActivityTable orders={serializedOrders} />
        </div>

        {/* Top 5 Sellers */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h3 className="font-black text-[#1E293B] text-base">{msgs.dashboard.topSellers}</h3>
              <p className="text-slate-400 text-xs mt-0.5">{periodLabel} — {msgs.sidebar.sortedByOrders}</p>
            </div>
            <div className="w-10 h-10 bg-[#EEF2FF] rounded-2xl flex items-center justify-center">
              <Users className="w-5 h-5 text-[#4361EE]" />
            </div>
          </div>

          {topSellers.length === 0 ? (
            <div className="text-center py-10">
              <div className="w-14 h-14 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto mb-3">
                <Users className="w-7 h-7 text-slate-300" />
              </div>
              <p className="text-slate-400 text-sm font-medium">{msgs.common.noData}</p>
            </div>
          ) : (
            <div className="space-y-1">
              {topSellers.map((seller, idx) => (
                <div key={seller.id} className="flex items-center gap-3 p-3 rounded-xl hover:bg-slate-50 transition group">
                  <div className="w-6 flex-shrink-0 text-center">
                    {idx === 0 ? (
                      <span className="w-6 h-6 inline-flex items-center justify-center rounded-full bg-yellow-400 text-white text-[10px] font-black">1</span>
                    ) : idx === 1 ? (
                      <span className="w-6 h-6 inline-flex items-center justify-center rounded-full bg-slate-300 text-white text-[10px] font-black">2</span>
                    ) : idx === 2 ? (
                      <span className="w-6 h-6 inline-flex items-center justify-center rounded-full bg-orange-400 text-white text-[10px] font-black">3</span>
                    ) : (
                      <span className="w-6 h-6 inline-flex items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-400">
                        {idx + 1}
                      </span>
                    )}
                  </div>
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-sm font-bold flex-shrink-0 ${AVATAR_COLORS[idx]}`}>
                    {seller.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-[#1E293B] text-sm truncate">{seller.name}</p>
                    <p className="text-[10px] text-slate-400 font-mono">{fmtRef(seller.id, "SLR")}</p>
                  </div>
                  <div className="text-left flex-shrink-0">
                    <p className="text-sm font-bold text-[#4361EE]">
                      {seller.orderCount.toLocaleString("ar-MA")} {msgs.dashboard.order}
                    </p>
                    <p className="text-[10px] text-slate-400">
                      {seller.revenue.toLocaleString("ar-MA", { maximumFractionDigits: 0 })} د.م
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Stat Card ─────────────────────────────────────────────────────────────────

function StatCard({
  label, value, icon, iconBg, iconColor, accent, sub,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  iconBg: string;
  iconColor: string;
  accent: string;
  sub?: string;
}) {
  return (
    <div className={`bg-white rounded-2xl border border-slate-100 border-t-4 ${accent} p-6 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-200 group cursor-default`}>
      <div className={`w-12 h-12 ${iconBg} rounded-2xl flex items-center justify-center mb-5 group-hover:scale-110 transition-transform duration-200`}>
        <span className={iconColor}>{icon}</span>
      </div>
      <p className="text-4xl font-black text-[#0F172A] leading-none mb-2 tracking-tight">{value}</p>
      <p className="text-sm text-slate-500 font-semibold">{label}</p>
      {sub && <p className="text-[11px] text-slate-400 mt-2 font-medium">{sub}</p>}
    </div>
  );
}
