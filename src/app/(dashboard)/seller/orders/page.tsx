import { getSessionUser } from '@/lib/api-utils';
import { order_status } from "@prisma/client";
import prisma from "@/lib/prisma";
import { redirect } from "next/navigation";
import SellerOrdersClient from "./SellerOrdersClient";
import { PERIOD_LABELS } from "@/components/ui/DateDropdown";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{ period?: string; from?: string; to?: string; status?: string }>;

export default async function SellerOrdersPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await getSessionUser();
  if (!user || user.role !== "SELLER") redirect("/login");

  const params = await searchParams;
  const status = Object.values(order_status).find(value => value === params.status);
  const period = params.period ?? "month";

  const now = new Date();
  const defaultFrom = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const defaultTo = now.toISOString().slice(0, 10);
  const fromStr = params.from ?? defaultFrom;
  const toStr = params.to ?? defaultTo;

  const periodFrom = new Date(`${fromStr}T00:00:00.000Z`);
  const periodTo = new Date(`${toStr}T23:59:59.999Z`);

  if (Number.isNaN(periodFrom.getTime()) || Number.isNaN(periodTo.getTime()) || periodFrom > periodTo) redirect("/seller/orders");

  const todayStr = now.toISOString().slice(0, 10);
  const todayStart = new Date(`${todayStr}T00:00:00.000Z`);
  const todayEnd = new Date(`${todayStr}T23:59:59.999Z`);

  const sellerId = user.id;

  const [orders, todayGroups] = await Promise.all([
    prisma.order.findMany({
      where: { sellerId, status, createdAt: status ? undefined : { gte: periodFrom, lte: periodTo } },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        seqId: true,
        customerName: true,
        customerPhone: true,
        productName: true,
        quantity: true,
        codAmount: true,
        netProfit: true,
        status: true,
        batchId: true,
        trackingNumber: true,
        city: true,
        createdAt: true,
      },
    }),
    prisma.order.groupBy({
      by: ["status"],
      where: { sellerId, createdAt: { gte: todayStart, lte: todayEnd } },
      _count: { id: true },
      _sum: { netProfit: true },
    }),
  ]);

  const todayNew = todayGroups
    .filter(g => ["DRAFT", "PENDING_CONFIRMATION", "CONFIRMED", "WAITING_PAYMENT", "PROCESSING"].includes(g.status))
    .reduce((a, g) => a + g._count.id, 0);
  const todayShipped  = todayGroups.find(g => g.status === "SHIPPED")?._count.id ?? 0;
  const todayDelivered = todayGroups.find(g => g.status === "DELIVERED")?._count.id ?? 0;
  const todayReturned  = todayGroups.find(g => g.status === "RETURNED")?._count.id ?? 0;
  const todayProfit    = todayGroups
    .filter(g => g.status === "DELIVERED")
    .reduce((a, g) => a + Number(g._sum.netProfit ?? 0), 0);

  const serialized = orders.map(o => ({
    ...o,
    codAmount: Number(o.codAmount),
    netProfit: Number(o.netProfit),
    createdAt: o.createdAt.toISOString(),
  }));

  return (
    <SellerOrdersClient
      orders={serialized}
      todayStats={{ new: todayNew, shipped: todayShipped, delivered: todayDelivered, returned: todayReturned, profit: todayProfit }}
      period={period}
      from={fromStr}
      to={toStr}
      periodLabel={status ? `${status} · جميع الفترات / Toutes périodes` : PERIOD_LABELS[period] ?? "هذا الشهر"}
    />
  );
}
