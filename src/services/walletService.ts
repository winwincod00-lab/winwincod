import { Prisma } from "@prisma/client";
import { decideDeposit } from "./walletApprovalService";
import prisma from "@/lib/prisma";
import {
  notifyDepositApproved,
  notifyDepositRejected,
  notifyProfitCredited,
} from "./notificationService";

function requireMoney(amount: number, allowZero = false) {
  if (!Number.isFinite(amount) || (allowZero ? amount < 0 : amount <= 0)) {
    throw new Error('Invalid wallet amount');
  }
}

export async function creditWallet(
  userId: string,
  amount: number,
  type: Prisma.transactionCreateInput['type'],
  refId?: string,
  description?: string
) {
  requireMoney(amount);
  return await prisma.$transaction(async (tx) => {
    const wallet = await tx.wallet.update({
      where: { userId },
      data: { balance: { increment: amount } },
    });

    await tx.transaction.create({
      data: { walletId: wallet.id, amount, type, referenceId: refId, description },
    });

    return wallet;
  });
}

export async function chargeWallet(
  userId: string,
  amount: number,
  type: Prisma.transactionCreateInput['type'],
  refId?: string,
  description?: string
) {
  requireMoney(amount);
  return await prisma.$transaction(async (tx) => {
    const wallet = await tx.wallet.findUniqueOrThrow({ where: { userId } });

    if (!Number.isFinite(amount) || amount <= 0 || new Prisma.Decimal(wallet.balance).lt(amount)) {
      throw new Error("رصيد المحفظة غير كافٍ");
    }

    const debit = await tx.wallet.updateMany({ where: { userId, balance: { gte: new Prisma.Decimal(amount) } }, data: { balance: { decrement: new Prisma.Decimal(amount) } } });
    if (debit.count !== 1) throw new Error("Insufficient balance");
    const updatedWallet = await tx.wallet.findUniqueOrThrow({ where: { userId } });

    await tx.transaction.create({
      data: {
        walletId: wallet.id,
        amount: new Prisma.Decimal(amount).negated(),
        type,
        referenceId: refId,
        description,
      },
    });

    return updatedWallet;
  });
}

// ─── Deposit flow ────────────────────────────────────────────────────────────

export async function createDepositRequest(
  sellerId: string,
  amount: number,
  receiptUrl: string
) {
  requireMoney(amount);
  return prisma.depositrequest.create({
    data: { sellerId, amount, receiptImage: receiptUrl, status: "PENDING" },
  });
}

export async function approveDeposit(depositId: string, actorId: string) {
  const result = await decideDeposit(depositId, "APPROVED", actorId);
  if (!result.replayed) void notifyDepositApproved(result.sellerId, Number(result.amount)).catch(() => console.error("Deposit notification failed"));
  return result.wallet;
}

export async function rejectDeposit(depositId: string, reason: string, actorId: string) {
  const result = await decideDeposit(depositId, "REJECTED", actorId, reason);
  if (!result.replayed) void notifyDepositRejected(result.sellerId, Number(result.amount), reason).catch(() => console.error("Deposit notification failed"));
  return result;
}

// ─── Order deduction ─────────────────────────────────────────────────────────

export async function deductForOrder(
  sellerId: string,
  orderId: string,
  shippingFee: number,
  productCost: number
) {
  requireMoney(shippingFee, true);
  requireMoney(productCost, true);
  const total = shippingFee + productCost;
  requireMoney(total);

  return prisma.$transaction(async (tx) => {
    const wallet = await tx.wallet.findUniqueOrThrow({ where: { userId: sellerId } });

    if (Number(wallet.balance) < total) {
      throw new Error("رصيد غير كافٍ، يرجى شحن محفظتك");
    }

    const debit = await tx.wallet.updateMany({
      where: { userId: sellerId, balance: { gte: new Prisma.Decimal(total) } },
      data: { balance: { decrement: total } },
    });
    if (debit.count !== 1) throw new Error('Insufficient balance');
    const updatedWallet = await tx.wallet.findUniqueOrThrow({ where: { userId: sellerId } });

    await tx.transaction.create({
      data: {
        walletId: wallet.id,
        amount: -total,
        type: "ORDER_PAYMENT",
        referenceId: orderId,
        description: `خصم الطلب - تكلفة ${productCost} د.م + شحن ${shippingFee} د.م`,
      },
    });

    return updatedWallet;
  });
}

// ─── Profit credit (on delivery) ─────────────────────────────────────────────

export async function creditProfit(
  sellerId: string,
  orderId: string,
  sellingPrice: number,
  productCost: number,
  shippingFee: number
) {
  requireMoney(sellingPrice, true);
  requireMoney(productCost, true);
  requireMoney(shippingFee, true);
  const profit = sellingPrice - productCost - shippingFee;
  if (!Number.isFinite(profit)) throw new Error('Invalid wallet amount');

  if (profit <= 0) return null;

  const wallet = await prisma.$transaction(async (tx) => {
    const w = await tx.wallet.update({
      where: { userId: sellerId },
      data: { balance: { increment: profit } },
    });

    await tx.transaction.create({
      data: {
        walletId: w.id,
        amount: profit,
        type: "DELIVERY_PROFIT",
        referenceId: orderId,
        description: `ربح التوصيل - بيع ${sellingPrice} - تكلفة ${productCost} - شحن ${shippingFee} = ${profit} د.م`,
      },
    });

    return w;
  });

  notifyProfitCredited(sellerId, orderId, profit);

  return wallet;
}

// ─── Wallet history (merged deposits + transactions, paginated) ───────────────

export type WalletHistoryItem = {
  id: string;
  type: "DEPOSIT" | "DEDUCTION" | "PROFIT" | "REFUND" | "WITHDRAWAL";
  amount: number;
  status: "PENDING" | "APPROVED" | "REJECTED" | "AUTO";
  note: string | null;
  receiptUrl: string | null;
  orderId: string | null;
  createdAt: Date;
};

const DEPOSIT_TYPE_MAP: Record<string, WalletHistoryItem["type"]> = {
  DEPOSIT: "DEPOSIT",
  ORDER_PAYMENT: "DEDUCTION",
  SHIPPING_PAYMENT: "DEDUCTION",
  DELIVERY_PROFIT: "PROFIT",
  REFUND_RETURN: "REFUND",
  WITHDRAWAL: "WITHDRAWAL",
};

export async function getWalletHistory(
  sellerId: string,
  page = 1,
  limit = 20
): Promise<{ items: WalletHistoryItem[]; total: number; totalPages: number }> {
  const wallet = await prisma.wallet.findUnique({ where: { userId: sellerId } });

  const [deposits, txns] = await Promise.all([
    prisma.depositrequest.findMany({
      where: { sellerId },
      orderBy: { createdAt: "desc" },
    }),
    wallet
      ? prisma.transaction.findMany({
          where: {
            walletId: wallet.id,
          },
          orderBy: { createdAt: "desc" },
        })
      : [],
  ]);

  const depositItems: WalletHistoryItem[] = deposits.map((d) => ({
    id: d.id,
    type: "DEPOSIT",
    amount: Number(d.amount),
    status: d.status as WalletHistoryItem["status"],
    note: d.notes,
    receiptUrl: d.receiptImage,
    orderId: null,
    createdAt: d.createdAt,
  }));

  const approvedRequests = new Map(deposits.filter(deposit => deposit.status === 'APPROVED').map(deposit => [deposit.id, deposit.amount]));
  const depositEntryCounts = new Map<string, number>();
  for (const entry of txns) if (entry.type === 'DEPOSIT' && entry.referenceId) depositEntryCounts.set(entry.referenceId, (depositEntryCounts.get(entry.referenceId) ?? 0) + 1);
  // Approved request deposits are already displayed above. Manual credits have
  // real ledger entries but no depositrequest and must not disappear from history.
  const txnItems: WalletHistoryItem[] = txns.filter(t => {
    const matched = t.referenceId ? approvedRequests.get(t.referenceId) : undefined;
    return t.type !== 'DEPOSIT' || matched === undefined || depositEntryCounts.get(t.referenceId!) !== 1 || !new Prisma.Decimal(t.amount).eq(matched);
  }).map((t) => ({
    id: t.id,
    type: DEPOSIT_TYPE_MAP[t.type] ?? "DEDUCTION",
    amount: Number(t.amount),
    status: "AUTO",
    note: t.description,
    receiptUrl: null,
    orderId: t.type === 'DEPOSIT' ? null : t.referenceId ?? null,
    createdAt: t.createdAt,
  }));

  const all = [...depositItems, ...txnItems].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  const total = all.length;
  const items = all.slice((page - 1) * limit, page * limit);

  return { items, total, totalPages: Math.ceil(total / limit) };
}

// ─── Stats helper ─────────────────────────────────────────────────────────────

export async function getWalletStats(sellerId: string) {
  const wallet = await prisma.wallet.findUnique({ where: { userId: sellerId } });

  const [depositSum, deductionSum, profitSum] = await Promise.all([
    // Total approved deposits
    prisma.depositrequest.aggregate({
      where: { sellerId, status: "APPROVED" },
      _sum: { amount: true },
    }),
    // Total deductions (negative amounts from order transactions)
    wallet
      ? prisma.transaction.aggregate({
          where: {
            walletId: wallet.id,
            type: { in: ["ORDER_PAYMENT", "SHIPPING_PAYMENT"] },
          },
          _sum: { amount: true },
        })
      : { _sum: { amount: null } },
    // Total profits
    wallet
      ? prisma.transaction.aggregate({
          where: { walletId: wallet.id, type: "DELIVERY_PROFIT" },
          _sum: { amount: true },
        })
      : { _sum: { amount: null } },
  ]);

  return {
    totalDeposits: Number(depositSum._sum.amount ?? 0),
    totalDeductions: Math.abs(Number(deductionSum._sum.amount ?? 0)),
    totalProfits: Number(profitSum._sum.amount ?? 0),
  };
}
