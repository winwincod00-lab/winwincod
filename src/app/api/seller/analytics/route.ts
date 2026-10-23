import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSessionUser, errorResponse } from "@/lib/api-utils";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const user = await getSessionUser();
    if (!user || user.role !== "SELLER") return errorResponse("غير مصرح", 401);

    const { searchParams } = new URL(request.url);
    const fromParam = searchParams.get("from");
    const toParam = searchParams.get("to");

    const now = new Date();
    const defaultFrom = new Date(now.getFullYear(), now.getMonth(), 1);

    const dateFilter = {
      gte: fromParam ? new Date(`${fromParam}T00:00:00.000Z`) : defaultFrom,
      lte: toParam ? new Date(`${toParam}T23:59:59.999Z`) : now,
    };

    if (Number.isNaN(dateFilter.gte.getTime()) || Number.isNaN(dateFilter.lte.getTime()) || dateFilter.gte > dateFilter.lte) {
      return errorResponse('فترة غير صالحة', 400);
    }
    const where = { sellerId: user.id, createdAt: dateFilter };

    const [totalOrders, statusGroups, deliveredAgg, recentOrders, queueGroups] = await Promise.all([
      prisma.order.count({ where }),
      prisma.order.groupBy({
        by: ["status"],
        where,
        _count: { id: true },
      }),
      prisma.order.aggregate({
        where: { sellerId: user.id, status: "DELIVERED", createdAt: dateFilter },
        _count: { id: true },
        _sum: { netProfit: true },
      }),
      prisma.order.findMany({
        where,
        select: { createdAt: true },
        orderBy: { createdAt: "asc" },
      }),
      prisma.order.groupBy({ by: ['status'], where: { sellerId: user.id }, _count: { id: true } }),
    ]);

    const delivered = deliveredAgg._count.id;
    const returned = statusGroups.find((g) => g.status === "RETURNED")?._count?.id ?? 0;
    const totalProfit = Number(deliveredAgg._sum.netProfit ?? 0);
    const deliveryRate =
      delivered + returned > 0
        ? Math.round((delivered / (delivered + returned)) * 100)
        : 0;

    // Bar chart: group orders by day within the range
    const salesByDay: Record<string, number> = {};
    recentOrders.forEach((order) => {
      const date = order.createdAt.toISOString().split("T")[0];
      salesByDay[date] = (salesByDay[date] || 0) + 1;
    });

    const barData = Object.entries(salesByDay)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, orders]) => ({
        date: new Date(date).toLocaleDateString("ar-MA", {
          month: "short",
          day: "numeric",
        }),
        orders,
      }))
      .slice(-14); // show max 14 bars

    // Pie chart: status distribution
    const pieData = statusGroups
      .filter((g) => g._count.id > 0)
      .map((g) => ({ name: g.status, value: g._count.id }));

    return NextResponse.json({
      success: true,
      totalOrders,
      delivered,
      returned,
      deliveryRate,
      totalProfit,
      pieData,
      barData,
      queues: Object.fromEntries(queueGroups.map(g => [g.status, g._count.id])),
    });
  } catch {
    return errorResponse("فشل جلب الإحصائيات", 500);
  }
}
